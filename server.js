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

// --- CONFIGURAZIONE ---
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

// --- HELMET & CSP (STRICT PER VERCEL) ---
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
        "https://*.vercel.app",
        process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''
      ].filter(Boolean),
      "img-src": ["'self'", "data:", "https:"]
    }
  }
}));

// --- MIDDLEWARE ---
app.use(express.json({ limit: MAX_JSON_PAYLOAD }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- RATE LIMIT ---
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: { message: 'Troppe richieste.' } }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: { message: 'Troppi tentativi di login.' } }
});
app.use('/api/', apiLimiter);
app.use('/api/login', loginLimiter);

// --- CORS (STRICT PER VERCEL) ---
const allowedOrigins = [
  'http://localhost:7860', // Dev locale standard
  'https://stream-organizer.vercel.app'
];
if (process.env.VERCEL_URL) allowedOrigins.push(`https://${process.env.VERCEL_URL}`);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin) || (process.env.VERCEL_ENV === 'preview' && origin.endsWith('.vercel.app'))) {
      return callback(null, true);
    }
    return callback(new Error('CORS non consentito'), false);
  },
  credentials: true
}));

// --- HELPERS (Identici a server.js ma duplicati per autonomia) ---
// ... (Codice helper omesso per brevità, è identico a server.js) ...
// In un progetto reale metteresti gli helper in un file `utils.js` importato da entrambi.
// Per semplicità qui assumiamo che tu copi le funzioni `isSafeUrl`, `sanitizeObject`, `fetchWithTimeout` da server.js

// --- ENDPOINTS (Identici a server.js) ---
// Qui ci andrebbero le stesse route (/api/login, /api/fetch-manifest etc)
// Vercel userà questo file.

// --- REDIRECT HTTPS (SOLO VERCEL) ---
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(301, `https://${req.hostname}${req.url}`);
    }
    next();
  });
}

// Vercel non ha bisogno di app.listen, ma per dev locale serve
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`Vercel Dev Server running on ${PORT}`));
}

module.exports = app;
