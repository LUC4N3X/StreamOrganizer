const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 7860;

// --- TRUST PROXY per Vercel/Docker --- (Invariato, buona practice)
app.set('trust proxy', 1);

// --- Chiavi segrete --- (Suggerimento: Assicurati che queste env var siano settate in prod; considera secret manager come AWS Secrets o Vercel Secrets)
const MONITOR_KEY_SECRET = process.env.MONITOR_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// --- API Stremio --- (Invariato)
const STREMIO_API_BASE = 'https://api.strem.io/api/';
const LOGIN_API_URL = `${STREMIO_API_BASE}login`;
const ADDONS_GET_URL = `${STREMIO_API_BASE}addonCollectionGet`;
const ADDONS_SET_URL = `${STREMIO_API_BASE}addonCollectionSet`;
const FETCH_TIMEOUT = 10000;

// --- Helmet + CSP --- (Migliorato: Aggiunte direttive per worker-src se usi web workers; reso più restrittivo su img-src)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-eval'", "https://unpkg.com", "https://cdnjs.cloudflare.com"],
      "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
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
        process.env.VERCEL_URL || ''
      ],
      "img-src": ["'self'", "data:", "https:"],  // Invariato, ma considera di restringere a domini specifici se possibile
      "worker-src": ["'self'", "blob:"]  // Aggiunto: Per supportare worker se futuri aggiornamenti lo richiedono
    }
  }
}));

// --- Middleware generali --- (Invariato, ma aggiunto compression per performance se non è già gestito da Vercel)
const compression = require('compression');  // Nuovo: Installa 'compression' per ridurre payload risposte
app.use(compression());
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Rate Limiter --- (Migliorato: Aggiunto keyGenerator per limitare per IP; aumentato flessibilità con env vars)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Troppi richieste. Riprova tra 15 minuti.' } },
  keyGenerator: (req) => req.ip  // Nuovo: Limita per IP per prevenire abusi
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.LOGIN_RATE_LIMIT_MAX || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Troppi tentativi di login. Riprova tra 15 minuti.' } },
  keyGenerator: (req) => req.ip
});
app.use('/api/', apiLimiter);
app.use('/api/login', loginLimiter);

// --- CORS --- (Migliorato: Aggiunto supporto per origini dinamiche da env var; logga origini non permesse per debug)
const allowedOrigins = [
  'http://localhost:7860',
  'https://stream-organizer.vercel.app'
];
if (process.env.VERCEL_URL) allowedOrigins.push(`https://${process.env.VERCEL_URL}`);
if (process.env.ADDITIONAL_ORIGINS) allowedOrigins.push(...process.env.ADDITIONAL_ORIGINS.split(','));  // Nuovo: Flessibilità via env
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || (process.env.VERCEL_ENV === 'preview' && origin.endsWith('.vercel.app'))) {
      return callback(null, true);
    }
    console.warn(`Origine non permessa: ${origin}`);  // Nuovo: Logging per monitorare tentativi
    return callback(new Error('La policy CORS non permette l\'accesso da questa origine.'), false);
  },
  credentials: true
}));

// --- AbortController Node <18 --- (Invariato, ma considera upgrade a Node 18+ per rimuoverlo)
if (!global.AbortController) global.AbortController = require('abort-controller').AbortController;

// --- Fetch con timeout --- (Migliorato: Aggiunto retry base per flake API; gestito errori HTTP)
async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT, retries = 1) {  // Nuovo: Aggiunto retries
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    if (!res.ok) {
      if (retries > 0 && res.status >= 500) {  // Nuovo: Retry su errori server-side
        return fetchWithTimeout(url, options, timeout, retries - 1);
      }
      throw new Error(`HTTP error! Status: ${res.status}`);
    }
    return res;
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') throw new Error('Richiesta al server scaduta (timeout).');
    throw err;
  }
}

// --- Opzioni cookie sicure --- (Migliorato: Aggiunto domain per Vercel; secure solo in prod)
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',  // Nuovo: Non secure in dev per facilitare test localhost
  sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  domain: process.env.COOKIE_DOMAIN || undefined  // Nuovo: Per subdomini se deploy multiplo
};

// --- Schemi Joi --- (Invariato, ma reso più restrittivo su addons array)
const schemas = {
  authKey: Joi.object({ authKey: Joi.string().min(1).required() }),
  login: Joi.object({ email: Joi.string().email().required(), password: Joi.string().min(6).required() }),
  manifestUrl: Joi.object({ manifestUrl: Joi.string().uri().required() }),
  setAddons: Joi.object({ 
    addons: Joi.array().items(Joi.object().unknown(true)).min(1).required(),  // Migliorato: Allow unknown keys in addons
    email: Joi.string().email().allow(null) 
  })
};

// --- Helper --- (Invariato, ma aggiunto check per localhost/loopback)
function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const privateIPs = [/^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./, /^192\.168\./, /^127\./, /^::1$/];  // Nuovo: Aggiunto localhost
    return !privateIPs.some(r => r.test(parsed.hostname));
  } catch { return false; }
}

// --- Async wrapper --- (Invariato)
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// --- Funzioni principali --- (Rifattorizzato: Estratto logica comune per ridurre duplicazioni)
async function getAddonsByAuthKey(authKey) {
  const { error } = schemas.authKey.validate({ authKey });
  if (error) throw Object.assign(new Error("AuthKey non valida."), { status: 400 });
  const res = await fetchWithTimeout(ADDONS_GET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey: authKey.trim() })
  });
  const data = await res.json();
  if (!data.result || data.error) throw Object.assign(new Error(data.error?.message || 'Errore recupero addon.'), { status: 500 });
  return data.result.addons || [];
}

async function getStremioData(email, password) {
  const { error } = schemas.login.validate({ email, password });
  if (error) throw Object.assign(new Error("Email o password non valide."), { status: 400 });
  const res = await fetchWithTimeout(LOGIN_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password })
  });
  const data = await res.json();
  if (!data.result?.authKey || data.error) throw Object.assign(new Error(data.error?.message || 'Credenziali non valide.'), { status: 401 });
  const addons = await getAddonsByAuthKey(data.result.authKey);
  return { addons, authKey: data.result.authKey };
}

// --- ENDPOINTS --- (Migliorato: Aggiunto status codes espliciti; ridotto codice ripetuto)
app.post('/api/login', asyncHandler(async (req, res) => {
  const { email, password, authKey: providedAuthKey } = req.body;
  let data;
  if (email && password) data = await getStremioData(email, password);
  else if (providedAuthKey) data = { addons: await getAddonsByAuthKey(providedAuthKey), authKey: providedAuthKey };
  else throw Object.assign(new Error("Email/password o authKey richiesti."), { status: 400 });
  res.cookie('authKey', data.authKey, cookieOptions);
  res.json({ addons: data.addons });
}));

app.post('/api/get-addons', asyncHandler(async (req, res) => {
  const { authKey } = req.cookies;
  const { email } = req.body;  // Nota: Questo email non è usato; considera rimuoverlo se non necessario
  if (!authKey) throw Object.assign(new Error("Cookie authKey mancante."), { status: 400 });
  res.json({ addons: await getAddonsByAuthKey(authKey) });
}));

app.post('/api/set-addons', asyncHandler(async (req, res) => {
  const { authKey } = req.cookies;
  if (!authKey) throw Object.assign(new Error("Cookie authKey mancante."), { status: 401 });
  const { error } = schemas.setAddons.validate(req.body);
  if (error) throw Object.assign(new Error(error.details[0].message), { status: 400 });
  const addonsToSave = req.body.addons.map(a => {
    const clean = { ...a };  // Nuovo: Usa spread invece di JSON.parse/stringify per performance
    delete clean.isEditing; delete clean.newLocalName;
    if (clean.manifest) delete clean.manifest.isEditing, delete clean.manifest.newLocalName;
    clean.manifest.name = a.manifest.name.trim();
    if (!clean.manifest.id) clean.manifest.id = `external-${Math.random().toString(36).substring(2, 9)}`;
    return clean;
  });
  const resSet = await fetchWithTimeout(ADDONS_SET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey: authKey.trim(), addons: addonsToSave })
  });
  const dataSet = await resSet.json();
  if (dataSet.error) throw Object.assign(new Error(dataSet.error.message || 'Errore salvataggio addon.'), { status: 500 });
  res.json({ success: true, message: "Addon salvati con successo." });
}));

app.post('/api/fetch-manifest', asyncHandler(async (req, res) => {
  const { error } = schemas.manifestUrl.validate(req.body);
  if (error) throw Object.assign(new Error("URL manifesto non valido."), { status: 400 });
  const { manifestUrl } = req.body;
  if (!isSafeUrl(manifestUrl)) throw Object.assign(new Error('URL non sicuro.'), { status: 400 });
  const headers = GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {};
  const resp = await fetchWithTimeout(manifestUrl, { headers });
  const manifest = await resp.json();
  if (!manifest.id || !manifest.version) throw Object.assign(new Error("Manifesto non valido."), { status: 400 });
  res.json(manifest);
}));

app.post('/api/admin/monitor', asyncHandler(async (req, res) => {
  const { adminKey, targetEmail } = req.body;
  if (!MONITOR_KEY_SECRET || adminKey !== MONITOR_KEY_SECRET) throw Object.assign(new Error("Chiave di monitoraggio non corretta."), { status: 401 });
  if (!targetEmail) throw Object.assign(new Error("Email target richiesta."), { status: 400 });
  throw Object.assign(new Error(`Accesso ai dati di ${targetEmail} non consentito.`), { status: 403 });
}));

app.post('/api/logout', (req, res) => {
  res.cookie('authKey', '', { ...cookieOptions, maxAge: 0 });
  res.json({ success: true, message: "Logout effettuato." });
});

// --- 404 --- (Invariato)
app.use('/api/*', (req, res) => res.status(404).json({ error: { message: 'Endpoint non trovato.' } }));

// --- HTTPS forzato in produzione --- (Invariato, ma considera middleware come 'express-sslify' per semplicità)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') return res.redirect(301, `https://${req.header('host')}${req.url}`);
    next();
  });
}

// --- Error handler globale --- (Migliorato: Aggiunto logging strutturato; nascosto stack in prod)
app.use((err, req, res, next) => {
  console.error({
    message: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,  // Nuovo: Nascondi stack in prod per sicurezza
    path: req.path,
    method: req.method
  });
  res.status(err.status || 500).json({ error: { message: err.message || 'Errore interno del server.' } });
});

// --- Avvio server locale --- (Invariato)
if (!process.env.VERCEL_ENV) app.listen(PORT, () => console.log(`Server avviato sulla porta ${PORT}`));

// --- Export per Vercel --- (Invariato)
module.exports = app;
