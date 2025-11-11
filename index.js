const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

// AbortController per Node <18
if (!global.AbortController) {
  const { AbortController } = require('abort-controller');
  global.AbortController = AbortController;
}

const app = express();
const PORT = process.env.PORT || 7860;

// --- TRUST PROXY (Vercel) ---
app.set('trust proxy', 1);

// --- Sicurezza: Helmet con CSP ---
app.use(
  helmet({
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
          "https://huggingface.co",
          "https://luca12234345-stremorganizer.hf.space"
        ],
        "img-src": ["'self'", "data:", "https:"]
      }
    }
  })
);

// --- Rate limit ---
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX || 100,
  message: { error: { message: 'Troppo richieste. Riprova tra 15 minuti.' } },
  standardHeaders: true,
  legacyHeaders: false
});

// --- CORS ---
const allowedOrigins = [
  'https://luca12234345-stremorganizer.hf.space',
  'http://localhost:7860'
];
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (!allowedOrigins.includes(origin)) return callback(new Error('Origine non consentita.'), false);
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.json());
app.use(cookieParser());
app.use(limiter);

// --- Helper ---
function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const privateIPs = [/^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./, /^192\.168\./];
    if (privateIPs.some(r => r.test(parsed.hostname))) return false;
    return true;
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, options, timeout = 10000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') throw new Error('Richiesta scaduta (timeout).');
    throw err;
  }
}

// --- Cookie ---
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60 * 1000
};

// --- Schemi Joi ---
const loginSchema = Joi.object({ email: Joi.string().email().required(), password: Joi.string().min(6).required() });
const authKeySchema = Joi.object({ authKey: Joi.string().min(1).required() });

// --- Funzioni principali ---
async function getAddonsByAuthKey(authKey) {
  const { error } = authKeySchema.validate({ authKey });
  if (error) throw new Error("AuthKey non valida.");
  
  const res = await fetchWithTimeout('https://api.strem.io/api/addonCollectionGet', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'StremioAddonManager/1.0'
    },
    body: JSON.stringify({ authKey: authKey.trim() })
  });

  if (!res.ok) throw new Error(`Errore Stremio: ${res.status}`);

  const data = await res.json();
  if (data.error || !data.result) throw new Error(data.error?.message || 'Impossibile recuperare gli addon.');

  return data.result.addons || [];
}

async function getStremioData(email, password) {
  const { error } = loginSchema.validate({ email, password });
  if (error) throw new Error("Email o Password non validi.");

  const res = await fetchWithTimeout('https://api.strem.io/api/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'StremioAddonManager/1.0'
    },
    body: JSON.stringify({ email: email.trim(), password })
  });

  if (!res.ok) throw new Error(`Errore login Stremio: ${res.status}`);

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || 'Credenziali non valide.');
  if (!data.result?.authKey) throw new Error('AuthKey non ricevuta.');

  const addons = await getAddonsByAuthKey(data.result.authKey);
  return { addons, authKey: data.result.authKey };
}

// --- Endpoint principali ---

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const data = await getStremioData(email, password);
    res.cookie('authKey', data.authKey, cookieOptions);
    res.json({ addons: data.addons });
  } catch (err) {
    res.status(err.message.includes('timeout') ? 504 : 401).json({ error: { message: err.message } });
  }
});

app.post('/get-addons', async (req, res) => {
  const { authKey } = req.cookies;
  try {
    if (!authKey) throw new Error('AuthKey mancante.');
    const addons = await getAddonsByAuthKey(authKey);
    res.json({ addons });
  } catch (err) {
    res.status(401).json({ error: { message: err.message } });
  }
});

app.post('/logout', (req, res) => {
  res.cookie('authKey', '', { ...cookieOptions, maxAge: 0 });
  res.json({ success: true, message: 'Logout effettuato.' });
});

// --- Forza HTTPS in produzione ---
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      return res.redirect(301, `https://${req.header('host')}${req.url}`);
    }
    next();
  });
}

// --- Avvio server ---
app.listen(PORT, () => {
  console.log(`Server avviato sulla porta ${PORT}`);
});
