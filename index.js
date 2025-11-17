const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

// --- FIX: Aggiunta libreria per sanificare input (prevenire Stored XSS) ---
const sanitizeHtml = require('sanitize-html');

// ---  FIX SSRF: Aggiunti moduli 'dns' e 'net'  ---
const dns = require('dns').promises;
const net = require('net');

const app = express();
const PORT = process.env.PORT || 7860;

app.set('trust proxy', 1);

const MONITOR_KEY_SECRET = process.env.MONITOR_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const STREMIO_API_BASE = 'https://api.strem.io/api/';
const LOGIN_API_URL = `${STREMIO_API_BASE}login`;
const ADDONS_GET_URL = `${STREMIO_API_BASE}addonCollectionGet`;
const ADDONS_SET_URL = `${STREMIO_API_BASE}addonCollectionSet`;

const FETCH_TIMEOUT = 10000;


// Helmet + CSP 

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
        "https://*.vercel.app", // Per le preview di Vercel
        process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''
      ].filter(Boolean), 
      "img-src": ["'self'", "data:", "https:"]
    }
  }
}));

// ---------------------------------------------------------------------
// MIDDLEWARE GENERALI
// ---------------------------------------------------------------------

// --- ★★★ FIX: Limita la dimensione del payload JSON per prevenire DoS ★★★ ---
app.use(express.json({ limit: '250kb' }));
// --- FINE FIX ---

app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------
// RATE LIMIT
// ---------------------------------------------------------------------
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

// ---------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------
const allowedOrigins = [
  'http://localhost:7860',
  'https://stream-organizer.vercel.app'
];

if (process.env.VERCEL_URL)
  allowedOrigins.push(`https://${process.env.VERCEL_URL}`);

app.use(cors({
  origin: (origin, callback) => {
    // La logica CORS permette !origin (per server-to-server o test locali)
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      (process.env.VERCEL_ENV === 'preview' && origin.endsWith('.vercel.app'))
    ) {
      return callback(null, true);
    }
    return callback(new Error('Origine non autorizzata dalla policy CORS'), false);
  },
  credentials: true
}));

// ---  FIX: Middleware per CSRF Hardening  ---

const enforceOrigin = (req, res, next) => {
  // Applichiamo solo a metodi che modificano lo stato
  if (req.method === 'POST') {
    const origin = req.header('Origin');
    const referer = req.header('Referer');
    let requestOrigin = origin;

    // Se Origin è assente (es. form POST tradizionale), usa Referer
    if (!requestOrigin && referer) {
      try {
        requestOrigin = new URL(referer).origin;
      } catch (e) {
        requestOrigin = undefined;
      }
    }

    // Se l'origine esiste (ovvero, è una richiesta cross-site)
    if (requestOrigin) {
      const isAllowed = allowedOrigins.includes(requestOrigin) ||
                      (process.env.VERCEL_ENV === 'preview' && requestOrigin.endsWith('.vercel.app'));

      // Se l'origine è presente ma non è nella whitelist, blocca.
      if (!isAllowed) {
        return res.status(403).json({ error: { message: 'Origine richiesta non valida (CSRF check).' } });
      }
    }
    
  }
  
  return next();
};

// Applica il controllo CSRF a TUTTI gli endpoint /api/
// Questo è più semplice che applicarlo a ogni singola rotta POST
app.use('/api/', enforceOrigin);
// --- FINE FIX ---


// ---------------------------------------------------------------------
// FETCH CON TIMEOUT
// ---------------------------------------------------------------------
if (!global.AbortController)
  global.AbortController = require('abort-controller').AbortController;

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

// ---------------------------------------------------------------------
// COOKIE OPTIONS
// ---------------------------------------------------------------------
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60 * 1000
};

// ---------------------------------------------------------------------
// JOI SCHEMAS
// ---------------------------------------------------------------------
const schemas = {
  authKey: Joi.object({ authKey: Joi.string().min(1).required() }),
  login: Joi.object({ email: Joi.string().email().required(), password: Joi.string().min(6).required() }),
  manifestUrl: Joi.object({ manifestUrl: Joi.string().uri().required() }),
  setAddons: Joi.object({
    addons: Joi.array().min(1).required(),
    email: Joi.string().email().allow(null)
  })
};

// ---------------------------------------------------------------------
// --- FIX SSRF: Funzioni helper per controllo IP ---
// ---------------------------------------------------------------------


function isPrivateIp(ip) {
  // Se è un indirizzo IPv6 mappato IPv4 (es. ::ffff:127.0.0.1)
  if (net.isIPv6(ip) && ip.startsWith('::ffff:')) {
    ip = ip.substring(7); // Estrai l'IPv4
  }

  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return parts[0] === 10 || // 10.0.0.0/8
           parts[0] === 127 || // 127.0.0.0/8 (Loopback)
           (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || // 172.16.0.0/12
           (parts[0] === 192 && parts[1] === 168) || // 192.168.0.0/16
           (parts[0] === 169 && parts[1] === 254) || // 169.254.0.0/16 (Link-local)
           parts[0] === 0; // 0.0.0.0/8
  }

  if (net.isIPv6(ip)) {
    const lowerIp = ip.toLowerCase();
    return lowerIp === '::1' || // Loopback IPv6
           lowerIp.startsWith('fc') || lowerIp.startsWith('fd') || // Unique Local (fc00::/7)
           lowerIp.startsWith('fe80'); // Link-local (fe80::/10)
  }
  
  return false; // Non un formato IP valido
}


async function isSafeUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    
    // 1. Controllo protocollo
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    
    const hostname = parsed.hostname;

    // 2. Controllo stringa hostname
    if (hostname.toLowerCase() === 'localhost') {
      return false;
    }
    
    // Se l'hostname è esso stesso un IP, controllalo
    if (net.isIP(hostname)) {
      return !isPrivateIp(hostname);
    }

    // 3. Controllo risoluzione DNS
    let ips = [];
    try {
      // Usiamo lookup per ottenere sia IPv4 che IPv6
      const addressesInfo = await dns.lookup(hostname, { all: true });
      ips = addressesInfo.map(info => info.address);
    } catch (dnsErr) {
      // Se il DNS non risolve, consideralo non sicuro
      console.error(`Errore DNS per ${hostname}:`, dnsErr.message);
      return false;
    }

    if (ips.length === 0) {
      return false; // Nessun IP trovato
    }
    
    // Se *uno qualsiasi* degli IP risolti è privato, blocca.
    if (ips.some(isPrivateIp)) {
      return false;
    }

    // Se supera tutti i controlli, è sicuro
    return true;

  } catch (err) {
    return false; // URL non valido o altro errore
  }
}

// ---------------------------------------------------------------------
// --- FIX XSS: Funzioni helper per sanificazione ricorsiva ---
// ---------------------------------------------------------------------

/**
 * Opzioni di sanificazione: ammetti solo testo puro, nessun tag HTML.
 */
const sanitizeOptions = {
  allowedTags: [],
  allowedAttributes: {}
};

/**
 * Sanifica una singola stringa, rimuovendo tutti i tag HTML.
 * @param {string} text La stringa da sanificare.
 * @returns {string} La stringa sanificata.
 */
const sanitize = (text) => text ? sanitizeHtml(text.trim(), sanitizeOptions) : '';

/**
 * Sanifica ricorsivamente tutte le proprietà stringa di un oggetto o array.
 * @param {any} data L'entità (oggetto, array, stringa, ecc.) da sanificare.
 * @returns {any} L'entità con tutte le stringhe sanificate.
 */
function sanitizeObject(data) {
  if (typeof data === 'string') {
    return sanitize(data); // Caso base: sanifica la stringa
  }

  if (Array.isArray(data)) {
    // Se è un array, itera e sanifica ogni elemento
    return data.map(item => sanitizeObject(item));
  }
  
  if (data && typeof data === 'object' && data.constructor === Object) {
    // Se è un oggetto letterale, itera su ogni chiave
    const newObj = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        // Chiamata ricorsiva per il valore
        newObj[key] = sanitizeObject(data[key]);
      }
    }
    return newObj;
  }
  
  // Se è un numero, booleano, null, undefined, ecc., restituiscilo com'è
  return data; 
}


// ---------------------------------------------------------------------
// WRAPPER ASYNC
// ---------------------------------------------------------------------
const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// ---------------------------------------------------------------------
// FUNZIONI STREMIO
// ---------------------------------------------------------------------
async function getAddonsByAuthKey(authKey) {
  const { error } = schemas.authKey.validate({ authKey });
  if (error) throw new Error("AuthKey non valida.");
  const res = await fetchWithTimeout(ADDONS_GET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey: authKey.trim() })
  });
  const data = await res.json();
  if (!data.result || data.error)
    throw new Error(data.error?.message || "Errore recupero addon.");
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
  const data = await res.json();
  if (!data.result?.authKey || data.error)
    throw new Error(data.error?.message || "Credenziali non valide.");
  const addons = await getAddonsByAuthKey(data.result.authKey);
  return { addons, authKey: data.result.authKey };
}

// ---------------------------------------------------------------------
// ENDPOINTS
// ---------------------------------------------------------------------

// LOGIN
app.post('/api/login', asyncHandler(async (req, res) => {
  const { email, password, authKey: providedAuthKey } = req.body;
  let data;
  if (email && password) data = await getStremioData(email, password);
  // --- FIX: Aggiunto trim() per coerenza ---
  else if (providedAuthKey) {
    const trimmedAuthKey = providedAuthKey.trim();
    data = { addons: await getAddonsByAuthKey(trimmedAuthKey), authKey: trimmedAuthKey };
  }
  else return res.status(400).json({ error: { message: "Email/password o authKey richiesti." } });

  res.cookie('authKey', data.authKey, cookieOptions);
  res.json({ addons: data.addons });
}));

// GET ADDONS
app.post('/api/get-addons', asyncHandler(async (req, res) => {
  const { authKey } = req.cookies;
  const { email } = req.body;
  if (!authKey || !email)
    return res.status(400).json({ error: { message: "Cookie authKey mancante o email mancante." } });
  res.json({ addons: await getAddonsByAuthKey(authKey) });
}));


// SET ADDONS
app.post('/api/set-addons', asyncHandler(async (req, res) => {
  const { authKey } = req.cookies;
  if (!authKey)
    return res.status(401).json({ error: { message: "Cookie authKey mancante." } });

  const { error } = schemas.setAddons.validate(req.body);
  if (error)
    return res.status(400).json({ error: { message: error.details[0].message } });

  const addonsToSave = req.body.addons.map(a => {
    // 1. Clona l'oggetto per evitare di modificare l'originale
    let clean = JSON.parse(JSON.stringify(a));
    
    // 2. Rimuovi le chiavi "di stato" del frontend
    delete clean.isEditing;
    delete clean.newLocalName;

    if (clean.manifest) {
      delete clean.manifest.isEditing;
      delete clean.manifest.newLocalName;
    }
    
    // ---  FIX XSS: Sanifica l'INTERO oggetto 'clean'  ---
    clean = sanitizeObject(clean);
    // --- FINE FIX ---

    // 3. Aggiungi un ID se manca (dopo la sanificazione)
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

  const dataSet = await resSet.json();
  if (dataSet.error)
    throw new Error(dataSet.error.message || "Errore salvataggio addon.");

  res.json({ success: true, message: "Addon salvati con successo." });
}));

// FETCH MANIFEST
app.post('/api/fetch-manifest', asyncHandler(async (req, res) => {
  const { error } = schemas.manifestUrl.validate(req.body);
  if (error)
    return res.status(400).json({ error: { message: "URL manifesto non valido." } });

  const { manifestUrl } = req.body;
  
  // ---  FIX SSRF: isSafeUrl ora è asincrono  ---
  if (!(await isSafeUrl(manifestUrl))) {
    return res.status(400).json({ error: { message: "URL non sicuro o risolve a un IP privato." } });
  }

  const headers = {};
  const parsedUrl = new URL(manifestUrl);
  const allowedTokenHosts = ['api.github.com', 'raw.githubusercontent.com'];
  if (GITHUB_TOKEN && allowedTokenHosts.includes(parsedUrl.hostname)) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`;
  }

  
  const fetchOptions = {
    headers,
    redirect: 'error' 
  };

  const resp = await fetchWithTimeout(manifestUrl, fetchOptions);
  if (!resp.ok)
    throw new Error(`Status ${resp.status}`);

  const manifest = await resp.json();
  if (!manifest.id || !manifest.version)
    throw new Error("Manifesto non valido.");

  res.json(manifest);
}));

// ADMIN MONITOR (DISABILITATO)
app.post('/api/admin/monitor', asyncHandler(async (req, res) => {
  const { adminKey, targetEmail } = req.body;
  if (!MONITOR_KEY_SECRET || adminKey !== MONITOR_KEY_SECRET)
    return res.status(401).json({ error: { message: "Chiave amministratore non valida." } });
  if (!targetEmail)
    return res.status(400).json({ error: { message: "Email target richiesta." } });
  return res.status(403).json({ error: { message: `Accesso ai dati di ${targetEmail} non consentito.` } });
}));

// LOGOUT
app.post('/api/logout', (req, res) => {
  res.cookie('authKey', '', { ...cookieOptions, maxAge: 0 });
  res.json({ success: true, message: "Logout effettuato." });
});

// 404
app.use('/api/*', (req, res) =>
  res.status(404).json({ error: { message: 'Endpoint non trovato.' } })
);

// HTTPS REDIRECT IN PRODUZIONE
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      // ---  FIX: Usa req.hostname per prevenire Host Header Injection  ---
      return res.redirect(301, `https://${req.hostname}${req.url}`);
    }
    next();
  });
}

// ERRORE GLOBALE
app.use((err, req, res, next) => {
  console.error(err);
  const status = err.status || 500;
  let message = 'Errore interno del server.';

  // Se l'errore è causato dal redirect bloccato
  if (err.message.includes('redirect')) {
      message = 'Recupero del manifesto non riuscito (redirect bloccato).';
  } 
  else if (err.message.includes('timeout')) {
      message = 'Richiesta al server scaduta (timeout).';
  }
  else if (status < 500) {
      message = err.message;
  }
  
  res.status(status).json({ error: { message } });
});

// AVVIO LOCALE
if (!process.env.VERCEL_ENV)
  app.listen(PORT, () => console.log(`Server avviato sulla porta ${PORT}`));

module.exports = app;
