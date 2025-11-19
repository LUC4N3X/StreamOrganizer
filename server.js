const express = require('express');
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

if (!global.AbortController) {
  global.AbortController = require('abort-controller').AbortController;
}

const app = express();
const PORT = process.env.PORT || 7860;

app.set('trust proxy', 1);
app.disable('x-powered-by');

// --- COSTANTI ---
const STREMIO_API_BASE = 'https://api.strem.io/api/';
const LOGIN_API_URL = `${STREMIO_API_BASE}login`;
const ADDONS_GET_URL = `${STREMIO_API_BASE}addonCollectionGet`;
const ADDONS_SET_URL = `${STREMIO_API_BASE}addonCollectionSet`;
const FETCH_TIMEOUT = 10000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// Limiti
const MAX_JSON_PAYLOAD = '250kb';
const MAX_MANIFEST_SIZE_BYTES = 250 * 1024;
const MAX_API_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_LOGIN_RESPONSE_BYTES = 1 * 1024 * 1024;
const SANITIZE_MAX_DEPTH = 6;
const SANITIZE_MAX_STRING = 2000;
const SANITIZE_MAX_ARRAY = 200;

// --- HELMET (OTTIMIZZATO PER SELF-HOSTING) ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-eval'", "https://unpkg.com", "https://cdnjs.cloudflare.com"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      "connect-src": ["'self'", "https://api.strem.io", "https://api.github.com", "https://unpkg.com", "https://cdnjs.cloudflare.com"],
      "img-src": ["'self'", "data:", "https:"]
    }
  },
  hsts: false, // Disabilitato per evitare problemi con HTTP/Proxy
  crossOriginOpenerPolicy: false,
  originAgentCluster: false
}));

app.use(express.json({ limit: MAX_JSON_PAYLOAD }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- CORS CONFIGURATION ---
const allowedOrigins = [
  'http://localhost:7860',
  'http://localhost:8080',
  'http://localhost:8081',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:7860',
  'https://omg-luca.ydns.eu' // Il tuo dominio
];

if (process.env.APP_URL) allowedOrigins.push(process.env.APP_URL);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    // Accetta origini nella lista o se contengono l'IP della VPS (per sicurezza)
    if (allowedOrigins.includes(origin) || origin.includes('185.229.239.195')) {
      return callback(null, true);
    }
    return callback(new Error('CORS non consentito'), false);
  },
  credentials: true
}));

// --- HELPERS SICUREZZA ---
function isPrivateIp(ip) {
  if (net.isIPv6(ip) && ip.startsWith('::ffff:')) { ip = ip.substring(7); }
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 ||
           (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
           (parts[0] === 192 && parts[1] === 168) ||
           (parts[0] === 169 && parts[1] === 254) || parts[0] === 0;
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

function sanitizeObject(data, currentDepth = 0, seen = new WeakSet()) {
  if (currentDepth > SANITIZE_MAX_DEPTH) return "[Depth Limit]";
  if (data === null || typeof data !== 'object') {
    if (typeof data === 'string') {
        if (data.length > SANITIZE_MAX_STRING) return sanitize(data.substring(0, SANITIZE_MAX_STRING)) + "...";
        return sanitize(data);
    }
    return data;
  }
  if (seen.has(data)) return "[Circular Reference]";
  seen.add(data);
  if (Array.isArray(data)) {
    if (data.length > SANITIZE_MAX_ARRAY) data = data.slice(0, SANITIZE_MAX_ARRAY);
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
  if (!contentType || !contentType.includes('application/json')) throw new Error('Risposta API non valida (Content-Type non JSON).');
  const contentLength = res.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxSize) throw new Error('Risposta API troppo grande.');
}

// --- SCHEMAS JOI ---
const schemas = {
  authKey: Joi.object({ authKey: Joi.string().min(1).required() }),
  login: Joi.object({ email: Joi.string().email().required(), password: Joi.string().min(6).required() }),
  manifestUrl: Joi.object({ manifestUrl: Joi.string().uri().required() }),
  setAddons: Joi.object({ addons: Joi.array().min(1).required(), email: Joi.string().email().allow(null) }),
  manifestCore: Joi.object({
    id: Joi.string().max(100).required(),
    version: Joi.string().max(50).required(),
    name: Joi.string().max(250).required(),
    description: Joi.string().max(5000).allow('').optional(),
    resources: Joi.array().max(50),
    types: Joi.array().max(50),
  }).unknown(true)
};

const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- ENDPOINTS API ---

// LOGIN
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
  // Cookie non-secure per permettere il funzionamento anche su HTTP
  res.cookie('authKey', data.authKey, { httpOnly: true, secure: false, sameSite: 'lax' });
  res.json({ addons: data.addons });
}));

// GET ADDONS
app.post('/api/get-addons', asyncHandler(async (req, res) => {
  const { authKey } = req.cookies;
  const { email } = req.body;
  if (!authKey || !email) return res.status(400).json({ error: { message: "Dati mancanti." } });
  res.json({ addons: await getAddonsByAuthKey(authKey) });
}));

// SET ADDONS
app.post('/api/set-addons', asyncHandler(async (req, res) => {
  const { authKey } = req.cookies;
  if (!authKey) return res.status(401).json({ error: { message: "Non autorizzato." } });
  const { error } = schemas.setAddons.validate(req.body);
  if (error) return res.status(400).json({ error: { message: error.details[0].message } });

  const addonsToSave = req.body.addons.map(a => {
    let clean = JSON.parse(JSON.stringify(a));
    delete clean.isEditing; delete clean.newLocalName;
    if (clean.manifest) { delete clean.manifest.isEditing; delete clean.manifest.newLocalName; }
    clean = sanitizeObject(clean);
    if (clean.manifest && !clean.manifest.id) clean.manifest.id = `external-${Math.random().toString(36).substring(2, 9)}`;
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

// FETCH MANIFEST
app.post('/api/fetch-manifest', asyncHandler(async (req, res) => {
  const { error } = schemas.manifestUrl.validate(req.body);
  if (error) return res.status(400).json({ error: { message: "URL non valido." } });
  const { manifestUrl } = req.body;
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
  const { error: manifestError } = schemas.manifestCore.validate(manifest);
  if (manifestError) throw new Error(`Manifesto non conforme: ${manifestError.details[0].message}`);
  res.json(manifest);
}));

app.post('/api/admin/monitor', asyncHandler(async (req, res) => {
  return res.status(403).json({ error: { message: "Accesso negato." } });
}));

app.post('/api/logout', (req, res) => {
  res.cookie('authKey', '', { httpOnly: true, secure: false, sameSite: 'lax', maxAge: 0 });
  res.json({ success: true });
});

app.use('/api/*', (req, res) => res.status(404).json({ error: { message: 'Endpoint inesistente.' } }));

// ERROR HANDLER
app.use((err, req, res, next) => {
  console.error(`[ERROR] ${req.method} ${req.path}: ${err.message}`);
  res.status(err.status || 500).json({ error: { message: err.message || 'Errore interno.' } });
});

// LOGICA BUSINESS
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

// AVVIO
app.listen(PORT, () => console.log(`Docker Server running on ${PORT}`));
