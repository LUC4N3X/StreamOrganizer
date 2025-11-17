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

// --- TRUST PROXY per Vercel/Docker ---
app.set('trust proxy', 1);

// --- Chiavi segrete ---
const MONITOR_KEY_SECRET = process.env.MONITOR_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// --- API Stremio ---
const STREMIO_API_BASE = 'https://api.strem.io/api/';
const LOGIN_API_URL = `${STREMIO_API_BASE}login`;
const ADDONS_GET_URL = `${STREMIO_API_BASE}addonCollectionGet`;
const ADDONS_SET_URL = `${STREMIO_API_BASE}addonCollectionSet`;
const FETCH_TIMEOUT = 10000;

// --- Helmet + CSP ---
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
      "img-src": ["'self'", "data:", "https:"]
    }
  }
}));

// --- Middleware generali ---
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Rate Limiter ---
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Troppi richieste. Riprova tra 15 minuti.' } }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.LOGIN_RATE_LIMIT_MAX || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Troppi tentativi di login. Riprova tra 15 minuti.' } }
});
app.use('/api/', apiLimiter);
app.use('/api/login', loginLimiter);

// --- CORS ---
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
    return callback(new Error('La policy CORS non permette l\'accesso da questa origine.'), false);
  },
  credentials: true
}));

// --- AbortController Node <18 ---
if (!global.AbortController) global.AbortController = require('abort-controller').AbortController;

// --- Fetch con timeout ---
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

// --- Opzioni cookie sicure ---
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60 * 1000
};

// --- Schemi Joi ---
const schemas = {
  authKey: Joi.object({ authKey: Joi.string().min(1).required() }),
  login: Joi.object({ email: Joi.string().email().required(), password: Joi.string().min(6).required() }),
  manifestUrl: Joi.object({ manifestUrl: Joi.string().uri().required() }),
  setAddons: Joi.object({ addons: Joi.array().min(1).required(), email: Joi.string().email().allow(null) })
};

// --- Helper ---

// ===================================================================
// FUNZIONE isSafeUrl CORRETTA (FIX PER SSRF)
// ===================================================================
function isSafeUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    
    // 1. Solo protocolli http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }
    
    const hostname = parsed.hostname;

    // 2. Blocca 'localhost'
    if (hostname.toLowerCase() === 'localhost') {
      return false;
    }

    // 3. Blacklist di pattern IP (IPv4 e IPv6)
    const forbiddenPatterns = [
      /^127\./,                            // Loopback IPv4 (127.0.0.0/8)
      /^10\./,                             // Private IPv4 (10.0.0.0/8)
      /^172\.(1[6-9]|2[0-9]|3[01])\./,      // Private IPv4 (172.16.0.0/12)
      /^192\.168\./,                       // Private IPv4 (192.168.0.0/16)
      /^169\.254\./,                       // Link-local & Metadata (169.254.0.0/16)
      /^0\./,                              // Reserved (0.0.0.0/8)
      /^::1$/,                             // Loopback IPv6
      /^[fF][cCdD]00:/,                    // IPv6 Unique Local (fc00::/7)
      /^[fF][eE]80:/                       // IPv6 Link-local (fe80::/10)
    ];

    if (forbiddenPatterns.some(regex => regex.test(hostname))) {
      return false;
    }

    return true;

  } catch {
    return false;
  }
}
// ===================================================================

// --- Async wrapper ---
const asyncHandler = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

// --- Funzioni principali ---
async function getAddonsByAuthKey(authKey) {
  const { error } = schemas.authKey.validate({ authKey });
  if (error) throw new Error("AuthKey non valida.");
  const res = await fetchWithTimeout(ADDONS_GET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey: authKey.trim() })
  });
  const data = await res.json();
  if (!data.result || data.error) throw new Error(data.error?.message || 'Errore recupero addon.');
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
  if (!data.result?.authKey || data.error) throw new Error(data.error?.message || 'Credenziali non valide.');
  const addons = await getAddonsByAuthKey(data.result.authKey);
  return { addons, authKey: data.result.authKey };
}

// --- ENDPOINTS ---
app.post('/api/login', asyncHandler(async (req, res) => {
  const { email, password, authKey: providedAuthKey } = req.body;
  let data;
  if(email && password) data = await getStremioData(email,password);
  else if(providedAuthKey) data = { addons: await getAddonsByAuthKey(providedAuthKey), authKey: providedAuthKey };
  else return res.status(400).json({ error: { message: "Email/password o authKey richiesti." } });

  res.cookie('authKey', data.authKey, cookieOptions);
  res.json({ addons: data.addons });
}));

app.post('/api/get-addons', asyncHandler(async (req,res)=>{
  const { authKey } = req.cookies;
  const { email } = req.body;
  if(!authKey || !email) return res.status(400).json({ error:{ message:"Cookie authKey mancante o email mancante." } });
  res.json({ addons: await getAddonsByAuthKey(authKey) });
}));

app.post('/api/set-addons', asyncHandler(async(req,res)=>{
  const { authKey } = req.cookies;
  if(!authKey) return res.status(401).json({ error:{ message:"Cookie authKey mancante." } });

  const { error } = schemas.setAddons.validate(req.body);
  if(error) return res.status(400).json({ error:{ message: error.details[0].message } });

  const addonsToSave = req.body.addons.map(a=>{
    const clean = JSON.parse(JSON.stringify(a));
    delete clean.isEditing; delete clean.newLocalName;
    if(clean.manifest) delete clean.manifest.isEditing, delete clean.manifest.newLocalName;
    clean.manifest.name = a.manifest.name.trim();
    if(!clean.manifest.id) clean.manifest.id = `external-${Math.random().toString(36).substring(2,9)}`;
    return clean;
  });

  const resSet = await fetchWithTimeout(ADDONS_SET_URL,{
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ authKey: authKey.trim(), addons: addonsToSave })
  });
  const dataSet = await resSet.json();
  if(dataSet.error) throw new Error(dataSet.error.message || 'Errore salvataggio addon.');
  res.json({ success:true, message:"Addon salvati con successo." });
}));

// ===================================================================
// ENDPOINT /api/fetch-manifest CORRETTO (FIX PER TOKEN LEAK)
// ===================================================================
app.post('/api/fetch-manifest', asyncHandler(async(req,res)=>{
  const { error } = schemas.manifestUrl.validate(req.body);
  if(error) return res.status(400).json({ error:{ message: "URL manifesto non valido." } });
  
  const { manifestUrl } = req.body;
  
  // 1. Controlla se l'URL è sicuro (blacklist SSRF)
  if(!isSafeUrl(manifestUrl)) {
    return res.status(400).json({ error:{ message:'URL non sicuro.' } });
  }

  // 2. Prepara gli header
  const headers = {};
  const parsedUrl = new URL(manifestUrl);
  
  // Whitelist dei domini a cui inviare il token
  const allowedTokenHosts = ['api.github.com', 'raw.githubusercontent.com'];

  // 3. Aggiungi il token SOLO se l'hostname è nella whitelist
  if (GITHUB_TOKEN && allowedTokenHosts.includes(parsedUrl.hostname)) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`;
  }

  // 4. Esegui il fetch con gli header sicuri (vuoti o con token)
  const resp = await fetchWithTimeout(manifestUrl,{ headers });
  if(!resp.ok) throw new Error(`Status ${resp.status}`);
  
  const manifest = await resp.json();
  if(!manifest.id || !manifest.version) throw new Error("Manifesto non valido.");
  res.json(manifest);
}));
// ===================================================================

app.post('/api/admin/monitor', asyncHandler(async(req,res)=>{
  const { adminKey, targetEmail } = req.body;
  if(!MONITOR_KEY_SECRET || adminKey!==MONITOR_KEY_SECRET) return res.status(401).json({ error:{ message:"Chiave di monitoraggio non corretta." } });
  if(!targetEmail) return res.status(400).json({ error:{ message:"Email target richiesta." } });
  // Logica disabilitata per sicurezza
  return res.status(403).json({ error:{ message:`Accesso ai dati di ${targetEmail} non consentito.` } });
}));

app.post('/api/logout',(req,res)=>{
  res.cookie('authKey','',{ ...cookieOptions, maxAge:0 });
  res.json({ success:true, message:"Logout effettuato." });
});

// --- 404 ---
app.use('/api/*',(req,res)=>res.status(404).json({ error:{ message:'Endpoint non trovato.' }}));

// --- HTTPS forzato in produzione ---
if(process.env.NODE_ENV==='production'){
  app.use((req,res,next)=>{
    if(req.header('x-forwarded-proto')!=='https') return res.redirect(301,`https://${req.header('host')}${req.url}`);
    next();
  });
}

// --- Error handler globale ---
app.use((err, req, res, next)=>{
  console.error(err); // Logga l'errore in console
  
  // Risposta generica per evitare di esporre dettagli
  const status = err.status || 500;
  let message = 'Errore interno del server.';
  
  // Invia messaggi specifici solo se "sicuri" (es. timeout)
  if (err.message.includes('timeout')) {
    message = 'Richiesta al server scaduta (timeout).';
  } else if (status < 500) {
    message = err.message; // Errore del client (4xx)
  }

  res.status(status).json({ error:{ message } });
});

// --- Avvio server locale ---
if(!process.env.VERCEL_ENV) app.listen(PORT,()=>console.log(`Server avviato sulla porta ${PORT}`));

// --- Export per Vercel ---
module.exports = app;
