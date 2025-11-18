const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

// --- LIBRERIE AGGIUNTE PER PERSISTENZA E SICUREZZA ---
const mongoose = require('mongoose'); // MongoDB
const sanitizeHtml = require('sanitize-html');

// --- FIX VERCEL/NPM: Isolamento moduli core per prevenire errori di installazione ---
const { promises: dns } = require('dns');
const net = require('net');
// --- FINE FIX ---

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

// Costanti per i limiti
const MAX_JSON_PAYLOAD = '250kb';
const MAX_MANIFEST_SIZE_BYTES = 250 * 1024;
const MAX_API_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_LOGIN_RESPONSE_BYTES = 1 * 1024 * 1024;
const SANITIZE_MAX_DEPTH = 6;
const SANITIZE_MAX_STRING = 2000;
const SANITIZE_MAX_ARRAY = 200;

// ---------------------------------------------------------------------
// MONGO DB CONNECTION & SCHEMA
// ---------------------------------------------------------------------
const MONGO_URI = process.env.DATABASE_URL; 
let isConnected = false;

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    authKey: { type: String },
    autoUpdate: { type: Boolean, default: false },
    lastCheck: { type: Date },
    updatedAt: { type: Date, default: Date.now }
});
const User = mongoose.models.User || mongoose.model('User', userSchema);

async function connectToDatabase() {
    if (isConnected) return;
    if (!MONGO_URI) return console.warn("⚠️ DATABASE_URL mancante. Persistenza disabilitata.");
    try {
        await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
        isConnected = true;
        console.log("✅ Connesso a MongoDB");
    } catch (error) {
        console.error("❌ Errore connessione MongoDB:", error.message);
    }
}

async function updateUserPreference(authKey, email, autoUpdate) {
    await connectToDatabase();
    if (!isConnected) return;
    return await User.findOneAndUpdate(
        { email },
        { authKey, email, autoUpdate, updatedAt: new Date() },
        { upsert: true, new: true }
    );
}

async function findUserPreference(email) {
    await connectToDatabase();
    if (!isConnected) return null;
    return await User.findOne({ email });
}

// ---------------------------------------------------------------------
// MIDDLEWARE GENERALI
// ---------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "https://unpkg.com", "https://cdnjs.cloudflare.com"],
      "style-src": ["'self'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "connect-src": [
        "'self'", "https://api.strem.io", "https://api.github.com", 
        "https://fonts.googleapis.com", "https://fonts.gstatic.com", 
        "https://unpkg.com", "https://cdnjs.cloudflare.com", 
        "https://stream-organizer.vercel.app", "https://*.vercel.app",
        process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''
      ].filter(Boolean), 
      "img-src": ["'self'", "data:", "https:"]
    }
  }
}));

app.use(express.json({ limit: MAX_JSON_PAYLOAD }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Rate Limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: process.env.RATE_LIMIT_MAX || 100,
  message: { error: { message: 'Troppe richieste. Riprova fra 15 minuti.' } }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: process.env.LOGIN_RATE_LIMIT_MAX || 20,
  message: { error: { message: 'Troppi tentativi di login. Riprova fra 15 minuti.' } }
});
app.use('/api/', apiLimiter);
app.use('/api/login', loginLimiter);

// CORS
const allowedOrigins = ['http://localhost:7860', 'https://stream-organizer.vercel.app'];
if (process.env.VERCEL_URL) allowedOrigins.push(`https://${process.env.VERCEL_URL}`);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || (process.env.VERCEL_ENV === 'preview' && origin.endsWith('.vercel.app'))) {
      return callback(null, true);
    }
    return callback(new Error('Origine non autorizzata dalla policy CORS'), false);
  },
  credentials: true
}));

// CSRF Hardening
const enforceOrigin = (req, res, next) => {
  if (req.path === '/api/cron') return next();
  if (req.method === 'POST') {
    const origin = req.header('Origin');
    const referer = req.header('Referer');
    let requestOrigin = origin;
    if (!requestOrigin && referer) {
      try { requestOrigin = new URL(referer).origin; } catch (e) { requestOrigin = undefined; }
    }
    if (requestOrigin) {
      const isAllowed = allowedOrigins.includes(requestOrigin) || (process.env.VERCEL_ENV === 'preview' && requestOrigin.endsWith('.vercel.app'));
      if (!isAllowed) return res.status(403).json({ error: { message: 'Origine richiesta non valida (CSRF check).' } });
    }
  }
  return next();
};
app.use('/api/', enforceOrigin);

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
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
  }),
  manifestCore: Joi.object({
    id: Joi.string().max(100).required(),
    version: Joi.string().max(50).required(),
    name: Joi.string().max(250).required(),
    description: Joi.string().max(5000).allow('').optional(),
    resources: Joi.array().max(50),
    types: Joi.array().max(50),
  }).unknown(true),
  preferences: Joi.object({
    autoUpdate: Joi.boolean().required(),
    email: Joi.string().email().required()
  })
};

// ---------------------------------------------------------------------
// SICUREZZA (SSRF & XSS)
// ---------------------------------------------------------------------
function isPrivateIp(ip) {
  if (net.isIPv6(ip) && ip.startsWith('::ffff:')) { ip = ip.substring(7); }
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254) || parts[0] === 0;
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
    let ips = [];
    try {
      const addressesInfo = await dns.lookup(hostname, { all: true });
      ips = addressesInfo.map(info => info.address);
    } catch (dnsErr) { return false; }
    if (ips.length === 0) return false;
    if (ips.some(isPrivateIp)) return false;
    return true;
  } catch (err) { return false; }
}

const sanitizeOptions = { allowedTags: [], allowedAttributes: {} };
const sanitize = (text) => text ? sanitizeHtml(text.trim(), sanitizeOptions) : '';

function sanitizeObject(data, currentDepth = 0) {
  if (currentDepth > SANITIZE_MAX_DEPTH) return "[Profondità eccessiva]";
  if (typeof data === 'string') {
    if (data.length > SANITIZE_MAX_STRING) data = data.substring(0, SANITIZE_MAX_STRING) + "...";
    return sanitize(data);
  }
  if (Array.isArray(data)) {
    if (data.length > SANITIZE_MAX_ARRAY) data = data.slice(0, SANITIZE_MAX_ARRAY);
    return data.map(item => sanitizeObject(item, currentDepth + 1));
  }
  if (data && typeof data === 'object' && data.constructor === Object) {
    const newObj = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        newObj[key] = sanitizeObject(data[key], currentDepth + 1);
      }
    }
    return newObj;
  }
  return data; 
}

// ---------------------------------------------------------------------
// UTILS
// ---------------------------------------------------------------------
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function validateApiResponse(res, maxSize = MAX_API_RESPONSE_BYTES) {
  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) throw new Error('Risposta API non valida.');
  const contentLength = res.headers.get('content-length');
  if (contentLength && parseInt(contentLength, 10) > maxSize) throw new Error('Risposta API troppo grande.');
}

if (!global.AbortController) global.AbortController = require('abort-controller').AbortController;

async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function getAddonsByAuthKey(authKey) {
  const { error } = schemas.authKey.validate({ authKey });
  if (error) throw new Error("AuthKey non valida.");
  const res = await fetchWithTimeout(ADDONS_GET_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey: authKey.trim() })
  });
  validateApiResponse(res, MAX_API_RESPONSE_BYTES);
  const data = await res.json();
  if (!data.result) throw new Error(data.error?.message || "Errore recupero addon.");
  return data.result.addons || [];
}

async function getStremioData(email, password) {
  const { error } = schemas.login.validate({ email, password });
  if (error) throw new Error("Email o password non valide.");
  const res = await fetchWithTimeout(LOGIN_API_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password })
  });
  validateApiResponse(res, MAX_LOGIN_RESPONSE_BYTES);
  const data = await res.json();
  if (!data.result?.authKey) throw new Error(data.error?.message || "Credenziali non valide.");
  const addons = await getAddonsByAuthKey(data.result.authKey);
  return { addons, authKey: data.result.authKey };
}

// ---------------------------------------------------------------------
// ENDPOINTS
// ---------------------------------------------------------------------

// 1. LOGIN (Con Sync preferenze)
app.post('/api/login', asyncHandler(async (req, res) => {
  const { email, password, authKey: providedAuthKey } = req.body;
  let data;
  let userPreference = null;

  if (email && password) {
    data = await getStremioData(email, password);
  }
  else if (providedAuthKey) {
    const trimmedAuthKey = providedAuthKey.trim();
    data = { addons: await getAddonsByAuthKey(trimmedAuthKey), authKey: trimmedAuthKey };
  }
  else return res.status(400).json({ error: { message: "Email o AuthKey mancanti." } });

  // Recupera stato sync da MongoDB
  if (email) {
      userPreference = await findUserPreference(email);
      // Se è un nuovo login o authKey diversa, aggiorna la chiave nel DB mantenendo la preferenza
      if (!userPreference || userPreference.authKey !== data.authKey) {
          const currentAutoUpdate = userPreference ? userPreference.autoUpdate : false;
          await updateUserPreference(data.authKey, email, currentAutoUpdate);
      }
  }

  res.cookie('authKey', data.authKey, cookieOptions);
  
  res.json({ 
      addons: data.addons, 
      authKey: data.authKey,
      // Invia lo stato al frontend per attivare l'interruttore
      autoUpdateEnabled: userPreference ? userPreference.autoUpdate : false 
  });
}));

// 2. SAVE PREFERENCES (Attiva/Disattiva e Salva)
app.post('/api/preferences', asyncHandler(async (req, res) => {
    const { authKey } = req.cookies;
    const { error } = schemas.preferences.validate(req.body);
    
    if (!authKey) return res.status(401).json({ error: { message: "Non autenticato." } });
    if (error) return res.status(400).json({ error: { message: error.details[0].message } });

    const { email, autoUpdate } = req.body;
    
    try {
        await updateUserPreference(authKey, email, !!autoUpdate);
        res.json({ success: true, message: "Preferenze salvate in Cloud." });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: { message: "Errore salvataggio DB." } });
    }
}));

// 3. GET PREFERENCES (Per sync su altri dispositivi)
app.get('/api/preferences', asyncHandler(async (req, res) => {
    const { authKey } = req.cookies;
    if (!authKey) return res.status(401).json({ error: { message: "Non autenticato." } });

    await connectToDatabase();
    const user = await User.findOne({ authKey });
    
    res.json({ autoUpdate: user ? user.autoUpdate : false });
}));

// 4. GET ADDONS
app.post('/api/get-addons', asyncHandler(async (req, res) => {
  const { authKey } = req.cookies;
  const { email } = req.body;
  if (!authKey) return res.status(400).json({ error: { message: "Cookie mancante." } });
  res.json({ addons: await getAddonsByAuthKey(authKey) });
}));

// 5. SET ADDONS (Sanitized)
app.post('/api/set-addons', asyncHandler(async (req, res) => {
  const { authKey } = req.cookies;
  if (!authKey) return res.status(401).json({ error: { message: "Cookie mancante." } });

  const { error } = schemas.setAddons.validate(req.body);
  if (error) return res.status(400).json({ error: { message: error.details[0].message } });

  const addonsToSave = req.body.addons.map(a => {
    let clean = JSON.parse(JSON.stringify(a));
    clean = sanitizeObject(clean);
    if (clean.manifest && !clean.manifest.id) {
      clean.manifest.id = `external-${Math.random().toString(36).substring(2, 9)}`;
    }
    return clean;
  });

  const resSet = await fetchWithTimeout(ADDONS_SET_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey: authKey.trim(), addons: addonsToSave })
  });
  validateApiResponse(resSet, MAX_LOGIN_RESPONSE_BYTES);
  const dataSet = await resSet.json();
  if (dataSet.error) throw new Error(dataSet.error.message);

  res.json({ success: true, message: "Salvataggio riuscito." });
}));

// 6. FETCH MANIFEST (SSRF Protected)
app.post('/api/fetch-manifest', asyncHandler(async (req, res) => {
  const { error } = schemas.manifestUrl.validate(req.body);
  if (error) return res.status(400).json({ error: { message: "URL non valido." } });

  const { manifestUrl } = req.body;
  if (!(await isSafeUrl(manifestUrl))) {
    return res.status(400).json({ error: { message: "URL non sicuro (SSRF)." } });
  }

  const resp = await fetchWithTimeout(manifestUrl, { redirect: 'error' });
  if (!resp.ok) throw new Error(`Status ${resp.status}`);
  validateApiResponse(resp, MAX_MANIFEST_SIZE_BYTES);

  const manifest = await resp.json(); 
  const { error: mErr } = schemas.manifestCore.validate(manifest);
  if (mErr) throw new Error(`Manifesto invalido: ${mErr.details[0].message}`);

  res.json(manifest);
}));

// 7. CRON JOB (Aggiornamento Notturno)
app.get('/api/cron', async (req, res) => {
    await connectToDatabase();
    if (!isConnected) return res.status(503).json({ error: "DB Error" });
    
    console.log("⏰ [CRON] Start update cycle...");
    const users = await User.find({ autoUpdate: true });
    let updatedCount = 0;
    const logs = [];

    for (const user of users) {
        try {
            const addons = await getAddonsByAuthKey(user.authKey);
            let hasUpdates = false;

            const updatedAddons = await Promise.all(addons.map(async (addon) => {
                const manifestUrl = addon.transportUrl || addon.manifest?.id;
                if (!manifestUrl || !manifestUrl.startsWith('http')) return addon;

                try {
                    if (!(await isSafeUrl(manifestUrl))) return addon; 
                    const resp = await fetchWithTimeout(manifestUrl, {}, 5000);
                    if (resp.ok) {
                        const remote = await resp.json();
                        if (remote.version !== addon.manifest.version) {
                            hasUpdates = true;
                            return { ...addon, manifest: remote };
                        }
                    }
                } catch (e) {}
                return addon;
            }));

            if (hasUpdates) {
                const saveRes = await fetchWithTimeout(ADDONS_SET_URL, {
                    method: 'POST', body: JSON.stringify({ authKey: user.authKey, addons: updatedAddons })
                });
                const saveData = await saveRes.json();
                if (saveData.result || saveData.success) {
                    updatedCount++;
                    user.lastCheck = new Date();
                    await user.save();
                }
            }
        } catch (err) {
            logs.push(`Error ${user.email}: ${err.message}`);
            if (err.message.includes('AuthKey') || err.message.includes('Credenziali')) {
                 await User.findOneAndUpdate({ email: user.email }, { autoUpdate: false });
            }
        }
    }
    res.json({ success: true, updated: updatedCount, logs });
});

// 8. LOGOUT
app.post('/api/logout', (req, res) => {
  res.cookie('authKey', '', { ...cookieOptions, maxAge: 0 });
  res.json({ success: true });
});

// 404 & ERRORS
app.use('/api/*', (req, res) => res.status(404).json({ error: { message: 'Endpoint not found' } }));

if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') return res.redirect(301, `https://${req.hostname}${req.url}`);
    next();
  });
}

app.use((err, req, res, next) => {
  console.error(`ERROR: ${err.message}`);
  const status = err.status || 500;
  let message = 'Errore interno.';
  if (err.isJoi) message = err.details[0].message;
  else if (status < 500) message = err.message;
  res.status(status).json({ error: { message } });
});

// AVVIO
if (!process.env.VERCEL_ENV) {
    connectToDatabase().then(() => {
        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    });
}

module.exports = app;
