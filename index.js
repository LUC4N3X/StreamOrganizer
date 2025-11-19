const express = require('express');
// Usa fetch nativo se disponibile (Node 18+), altrimenti usa il pacchetto
const fetch = global.fetch || require('node-fetch');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const sanitizeHtml = require('sanitize-html');
const dns = require('dns').promises;
const net = require('net');

// Polyfill per AbortController su vecchie versioni di Node
if (!global.AbortController) {
  global.AbortController = require('abort-controller').AbortController;
}

const app = express();
const PORT = process.env.PORT || 7860;

app.set('trust proxy', 1);
app.disable('x-powered-by');

// --- CONFIGURAZIONE E COSTANTI ---
const MONITOR_KEY_SECRET = process.env.MONITOR_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const STREMIO_API_BASE = 'https://api.strem.io/api/';
const LOGIN_API_URL = `${STREMIO_API_BASE}login`;
const ADDONS_GET_URL = `${STREMIO_API_BASE}addonCollectionGet`;
const ADDONS_SET_URL = `${STREMIO_API_BASE}addonCollectionSet`;

const FETCH_TIMEOUT = 10000;

// Limiti di sicurezza
const MAX_JSON_PAYLOAD = '250kb';
const MAX_MANIFEST_SIZE_BYTES = 250 * 1024; // 250KB
const MAX_API_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_LOGIN_RESPONSE_BYTES = 1 * 1024 * 1024; // 1MB
const SANITIZE_MAX_DEPTH = 6;
const SANITIZE_MAX_STRING = 2000;
const SANITIZE_MAX_ARRAY = 200;

// --- HELMET & CSP ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": [
        "'self'",
        "https://unpkg.com",
        "https://cdnjs.cloudflare.com"
      ],
      "style-src": [
        "'self'",
        "https://fonts.googleapis.com",
        "https://cdnjs.cloudflare.com"
      ],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "connect-src": [
        "'self'",
        "https://api.strem.io",
        "https://api.github.com",
        "https://fonts.googleapis.com",
        "https://fonts.gstatic.com",
        "https://unpkg.com",
        "https://cdnjs.cloudflare.com",
        "https://stream-organizer.vercel.app",
        "https://*.vercel.app",
        process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''
      ].filter(Boolean),
      "img-src": ["'self'", "data:", "https:"]
    }
  }
}));

// --- MIDDLEWARE BASE ---
app.use(express.json({ limit: MAX_JSON_PAYLOAD }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- WAF MINIMALE ---
const badPatterns = [
  /<script[\s\S]*?>[\s\S]*?<\/script>/i,
  /<\s*iframe/i,
  /onerror\s*=/i,
  /onload\s*=/i,
  /document\.cookie/i,
  /javascript:/i,
  /<\s*img/i,
  /<\s*svg/i,
  /eval\(/i,
  /base64,/i,
  /union\s+select/i,
  /select\s+.*\s+from/i,
  /insert\s+into/i,
  /drop\s+table/i,
  /alter\s+table/i,
  /--\s*$/i,
  /\/\*/i,
  /sleep\(\s*\d+\s*\)/i,
  /benchmark\(/i,
  /load_file\(/i,
  /xp_cmdshell/i
];

function miniWAF(req, res, next) {
  try {
    // Ottimizzazione: se non c'è body o query, salta controlli pesanti
    if (!req.body && !req.query) return next();

    let bodyStr = '';
    try {
      bodyStr = JSON.stringify(req.body || '');
      if (bodyStr.length > 10000) bodyStr = bodyStr.slice(0, 10000);
    } catch (e) { bodyStr = ''; }

    let queryStr = '';
    try {
      queryStr = JSON.stringify(req.query || '');
      if (queryStr.length > 2000) queryStr = queryStr.slice(0, 2000);
    } catch (e) { queryStr = ''; }

    const raw = `${req.path} ${req.method} ${req.headers['user-agent'] || ''} ${bodyStr} ${queryStr}`.toLowerCase();

    for (const p of badPatterns) {
      if (p.test(raw)) {
        console.warn(`WAF: bloccata richiesta sospetta - path: ${req.path}`);
        return res.status(403).json({ error: { message: "Richiesta bloccata (policy di sicurezza)." } });
      }
    }

    const ua = (req.headers['user-agent'] || '').toLowerCase();
    if (!ua || ua.length < 5) {
      return res.status(403).json({ error: { message: "User-Agent non valido." } });
    }

    next();
  } catch (err) {
    console.error('WAF ERROR:', err.message);
    next();
  }
}

app.use('/api/', miniWAF);

// --- RATE LIMIT ---
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX || 100,
  message: { error: { message: 'Troppe richieste. Riprova fra 15 minuti.' } }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.LOGIN_RATE_LIMIT_MAX || 20,
  message: { error: { message: 'Troppi tentativi di login. Riprova fra 15 minuti.' } }
});

app.use('/api/', apiLimiter);
app.use('/api/login', loginLimiter);

// --- CORS & CSRF HARDENING ---
const allowedOrigins = [
  'http://localhost:7860',
  'https://stream-organizer.vercel.app'
];
if (process.env.VERCEL_URL) allowedOrigins.push(`https://${process.env.VERCEL_URL}`);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || (process.env.VERCEL_ENV === 'preview' && origin.endsWith('.vercel.app'))) {
      return callback(null, true);
    }
    return callback(new Error('Origine non autorizzata (CORS)'), false);
  },
  credentials: true
}));

const enforceOrigin = (req, res, next) => {
  if (req.method === 'POST') {
    const origin = req.header('Origin');
    const referer = req.header('Referer');
    let requestOrigin = origin;

    if (!requestOrigin && referer) {
      try { requestOrigin = new URL(referer).origin; } catch (e) { requestOrigin = undefined; }
    }

    if (requestOrigin) {
      const isAllowed = allowedOrigins.includes(requestOrigin) ||
                        (process.env.VERCEL_ENV === 'preview' && requestOrigin.endsWith('.vercel.app'));
      if (!isAllowed) {
        return res.status(403).json({ error: { message: 'Origine richiesta non valida (CSRF check).' } });
      }
    }
  }
  return next();
};
app.use('/api/', enforceOrigin);

// --- HELPERS SICUREZZA (SSRF & Sanitizzazione) ---
function isPrivateIp(ip) {
  if (net.isIPv6(ip) && ip.startsWith('::ffff:')) { ip = ip.substring(7); }
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 ||
           (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
           (parts[0] === 192 && parts[1] === 168) ||
           (parts[0] === 169 && parts[1] === 254) || parts[0] === 0;
  }
  if (net.isIPv6(ip)) {
    const lowerIp = ip.toLowerCase();
    return lowerIp === '::1' || lowerIp.startsWith('fc') || lowerIp.startsWith('fd') || lowerIp.startsWith('fe80');
  }
  return false;
}

async function isSafeUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const hostname = parsed.hostname;
    if (hostname.toLowerCase() === 'localhost') return false;
    if (net.isIP(hostname)) return !isPrivateIp(hostname);
    
    const addressesInfo = await dns.lookup(hostname, { all: true });
    const ips = addressesInfo.map(info => info.address);
    if (ips.length === 0 || ips.some(isPrivateIp)) return false;
    
    return true;
  } catch (err) { return false; }
}

const sanitizeOptions = { allowedTags: [], allowedAttributes: {} };
const sanitize = (text) => text ? sanitizeHtml(text.trim(), sanitizeOptions) : '';

// --- FIX: Aggiunto 'seen' WeakSet per prevenire crash da loop infiniti ---
function sanitizeObject(data, currentDepth = 0, seen = new WeakSet()) {
  if (currentDepth > SANITIZE_MAX_DEPTH) return "[Depth Limit]";

  // Controllo tipi primitivi
  if (data === null || typeof data !== 'object') {
    if (typeof data === 'string') {
        if (data.length > SANITIZE_MAX_STRING) {
            return sanitize(data.substring(0, SANITIZE_MAX_STRING)) + "...";
        }
        return sanitize(data);
    }
    return data;
  }

  // Protezione Riferimenti Circolari
  if (seen.has(data)) return "[Circular Reference]";
  seen.add(data);

  if (Array.isArray(data)) {
    if (data.length > SANITIZE_MAX_ARRAY) {
       data = data.slice(0, SANITIZE_MAX_ARRAY);
    }
    return data.map(item => sanitizeObject(item, currentDepth + 1, seen));
  }

  if (data.constructor === Object) {
    const newObj = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        newObj[key] = sanitizeObject(data[key], currentDepth + 1, seen);
      }
    }
    return newObj;
  }

  return data;
}

// --- UTILS FETCH ---
async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') throw new Error('Richiesta al server scaduta (timeout).');
    throw err;
  }
}

function validateApiResponse(res, maxSize = MAX_API_RESPONSE_BYTES) {
  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error('Risposta API non valida (Content-Type non JSON).');
  }
  const contentLength = res.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxSize) {
    throw new Error('Risposta API troppo grande.');
  }
}

// --- VALIDAZIONE SCHEMA (JOI) ---
const schemas = {
  authKey: Joi.object({ authKey: Joi.string().min(1).required() }),
  login: Joi.object({ email: Joi.string().email().required(), password: Joi.string().min(6).required() }),
  manifestUrl: Joi.object({ manifestUrl: Joi.string().uri().required() }),
  setAddons: Joi.object({
    addons: Joi.array().min(1).required(),
    email: Joi.string().email().allow(null)
  }),
  manifestCore: Joi.object({
    id: Joi.string().max(100).required(),
    version: Joi.string().max(50).required(),
    name: Joi.string().max(250).required(),
    description: Joi.string().max(5000).allow('').optional(),
    resources: Joi.array().max(50),
    types: Joi.array().max(50),
  }).unknown(true)
};

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60 * 1000
};

// --- WRAPPER ---
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- LOGICA STREMIO ---
async function getAddonsByAuthKey(authKey) {
  const { error } = schemas.authKey.validate({ authKey });
  if (error) throw new Error("AuthKey non valida.");
  
  const res = await fetchWithTimeout(ADDONS_GET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey: authKey.trim() })
  });
  validateApiResponse(res, MAX_API_RESPONSE_BYTES);
  
  const data = await res.json();
  if (!data.result || data.error) throw new Error(data.error?.message || "Errore recupero addon.");
  return data.result.addons || [];
}

async function getStremioData(email, password) {
  const { error } = schemas.login.validate({ email, password });
  if (error) throw new Error("Email o password non valide.");
  
  const res = await fetchWithTimeout(LOGIN_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password })
  });
  validateApiResponse(res, MAX_LOGIN_RESPONSE_BYTES);
  
  const data = await res.json();
  if (!data.result?.authKey || data.error) throw new Error(data.error?.message || "Credenziali non valide.");
  
  const addons = await getAddonsByAuthKey(data.result.authKey);
  return { addons, authKey: data.result.authKey };
}

// --- ENDPOINTS ---

// Login
app.post('/api/login', asyncHandler(async (req, res) => {
  const { email, password, authKey: providedAuthKey } = req.body;
  let data;
  if (email && password) data = await getStremioData(email, password);
  else if (providedAuthKey) {
    const trimmed = providedAuthKey.trim();
    data = { addons: await getAddonsByAuthKey(trimmed), authKey: trimmed };
  } else {
    return res.status(400).json({ error: { message: "Email/password o authKey richiesti." } });
  }
  res.cookie('authKey', data.authKey, cookieOptions);
  res.json({ addons: data.addons });
}));

// Get Addons
app.post('/api/get-addons', asyncHandler(async (req, res) => {
  const { authKey } = req.cookies;
  const { email } = req.body;
  if (!authKey || !email) return res.status(400).json({ error: { message: "Dati mancanti." } });
  res.json({ addons: await getAddonsByAuthKey(authKey) });
}));

// Set Addons
app.post('/api/set-addons', asyncHandler(async (req, res) => {
  const { authKey } = req.cookies;
  if (!authKey) return res.status(401).json({ error: { message: "Non autorizzato." } });
  
  const { error } = schemas.setAddons.validate(req.body);
  if (error) return res.status(400).json({ error: { message: error.details[0].message } });

  const addonsToSave = req.body.addons.map(a => {
    // Copia profonda
    let clean = JSON.parse(JSON.stringify(a));
    delete clean.isEditing;
    delete clean.newLocalName;
    if (clean.manifest) {
      delete clean.manifest.isEditing;
      delete clean.manifest.newLocalName;
    }
    // Sanitizzazione con protezione loop
    clean = sanitizeObject(clean);

    if (clean.manifest && !clean.manifest.id) {
      clean.manifest.id = `external-${Math.random().toString(36).substring(2, 9)}`;
    }
    return clean;
  });

  const resSet = await fetchWithTimeout(ADDONS_SET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey: authKey.trim(), addons: addonsToSave })
  });
  validateApiResponse(resSet, MAX_LOGIN_RESPONSE_BYTES);

  const dataSet = await resSet.json();
  if (dataSet.error) throw new Error(dataSet.error.message || "Errore salvataggio.");
  
  res.json({ success: true, message: "Salvataggio riuscito." });
}));

// Fetch Manifest
app.post('/api/fetch-manifest', asyncHandler(async (req, res) => {
  const { error } = schemas.manifestUrl.validate(req.body);
  if (error) return res.status(400).json({ error: { message: "URL non valido." } });
  
  const { manifestUrl } = req.body;
  
  // Controllo SSRF Asincrono
  const isSafe = await isSafeUrl(manifestUrl);
  if (!isSafe) return res.status(400).json({ error: { message: "URL non consentito (SSRF/Private IP)." } });

  const headers = {};
  const parsedUrl = new URL(manifestUrl);
  if (GITHUB_TOKEN && ['api.github.com', 'raw.githubusercontent.com'].includes(parsedUrl.hostname)) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`;
  }

  const resp = await fetchWithTimeout(manifestUrl, { headers, redirect: 'error' });
  if (!resp.ok) throw new Error(`Errore fetch: ${resp.status}`);
  
  validateApiResponse(resp, MAX_MANIFEST_SIZE_BYTES);
  const manifest = await resp.json();

  // Validazione Contenuto
  const { error: manifestError } = schemas.manifestCore.validate(manifest);
  if (manifestError) throw new Error(`Manifesto non conforme: ${manifestError.details[0].message}`);

  res.json(manifest);
}));

// Monitor (Disabilitato)
app.post('/api/admin/monitor', asyncHandler(async (req, res) => {
  return res.status(403).json({ error: { message: "Accesso negato." } });
}));

// Logout
app.post('/api/logout', (req, res) => {
  res.cookie('authKey', '', { ...cookieOptions, maxAge: 0 });
  res.json({ success: true });
});

// 404
app.use('/api/*', (req, res) => res.status(404).json({ error: { message: 'Endpoint inesistente.' } }));

// Redirect HTTPS in Prod
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(301, `https://${req.hostname}${req.url}`);
    }
    next();
  });
}

// Error Handler
app.use((err, req, res, next) => {
  // Log sicuro: niente stack trace in produzione
  console.error(`[ERROR] ${req.method} ${req.path}: ${err.message}`);
  if (process.env.NODE_ENV !== 'production' && err.stack) {
    console.error(err.stack);
  }

  const status = err.status || 500;
  let message = 'Errore interno del server.';
  
  if (err.message.includes('redirect')) message = 'Redirect non consentiti.';
  else if (err.message.includes('timeout')) message = 'Timeout richiesta.';
  else if (status < 500) message = err.message;

  res.status(status).json({ error: { message } });
});

// Avvio
if (!process.env.VERCEL_ENV) {
  app.listen(PORT, () => console.log(`Server attivo su porta ${PORT}`));
}

module.exports = app;
