const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { kv } = require('@vercel/kv'); // --- MODIFICA --- (Caching)
const crypto = require('crypto'); // --- MODIFICA --- (Per chiavi cache sicure)

const app = express();
const PORT = process.env.PORT || 7860;

// --- TRUST PROXY per Vercel/Docker ---
app.set('trust proxy', 1);

// --- Chiavi segrete ---
const MONITOR_KEY_SECRET = process.env.MONITOR_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// --- Costanti API Stremio ---
const STREMIO_API_BASE = 'https://api.strem.io/api/';
const LOGIN_API_URL = `${STREMIO_API_BASE}login`;
const ADDONS_GET_URL = `${STREMIO_API_BASE}addonCollectionGet`;
const ADDONS_SET_URL = `${STREMIO_API_BASE}addonCollectionSet`;

const FETCH_TIMEOUT = 10000;
const CACHE_TTL_ADDONS = 86400; // 1 giorno (invalidato al salvataggio)
const CACHE_TTL_MANIFEST = 21600; // 6 ore

// --- Helmet + CSP ---
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
          "https://stream-organizer.vercel.app", 
          process.env.VERCEL_URL,
          process.env.KV_REST_API_URL // --- MODIFICA --- (Allow Vercel KV)
        ],
        "img-src": ["'self'", "data:", "https:"]
      }
    }
  })
);

// --- Rate limiting ---
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX || 100,
  message: { error: { message: 'Troppo richieste. Riprova tra 15 minuti.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.LOGIN_RATE_LIMIT_MAX || 20,
  message: { error: { message: 'Troppi tentativi di login. Riprova tra 15 minuti.' } },
  standardHeaders: true,
  legacyHeaders: false,
});

// --- CORS whitelist ---
const allowedOrigins = [
  'http://localhost:7860',
  'https://stream-organizer.vercel.app' 
];
if (process.env.VERCEL_URL) {
  allowedOrigins.push(`https://${process.env.VERCEL_URL}`); 
}

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);  
    if (allowedOrigins.indexOf(origin) !== -1 || (process.env.VERCEL_ENV === 'preview' && origin.endsWith('.vercel.app'))) {
        return callback(null, true);
    }
    return callback(new Error('La policy CORS non permette l\'accesso da questa origine.'), false);
  },
  credentials: true 
}));

// --- Middleware ---
app.use(express.json());
app.use(cookieParser());
// app.use(express.static(path.join(__dirname, 'public'))); // --- MODIFICA --- (Rimosso. Gestito da vercel.json)
app.use('/api/', limiter);
app.use('/api/login', loginLimiter);

// --- AbortController per Node <18 ---
if (!global.AbortController) {
  const { AbortController } = require('abort-controller');
  global.AbortController = AbortController;
}

// --- fetch con timeout ---
async function fetchWithTimeout(url, options, timeout = FETCH_TIMEOUT) {
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

// --- Opzioni Cookie Sicuro ---
const cookieOptions = {
    httpOnly: true,
    secure: true, 
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 giorni
};

// --- Joi Schemi ---
const authKeySchema = Joi.object({ authKey: Joi.string().min(1).required() });
const loginSchema = Joi.object({ email: Joi.string().email().required(), password: Joi.string().min(6).required() });
const manifestUrlSchema = Joi.object({ manifestUrl: Joi.string().uri().required() });
const setAddonsSchema = Joi.object({ 
  addons: Joi.array().min(1).required(),  
  email: Joi.string().email().allow(null) 
});

// --- Helper: URL sicuro ---
function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const privateIPs = [/^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./, /^192\.168\./];
    if (privateIPs.some(r => r.test(parsed.hostname))) return false;
    return true;
  } catch { return false; }
}

// --- MODIFICA --- (Helper per chiave cache sicura)
function getCacheKey(prefix, key) {
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return `${prefix}:${hash}`;
}

// --- Funzioni principali ---

// --- MODIFICA --- (Funzione aggiornata con Caching)
async function getAddonsByAuthKey(authKey) {
  const { error } = authKeySchema.validate({ authKey });
  if (error) throw new Error("AuthKey non valido.");

  const cacheKey = getCacheKey('addons', authKey);
  
  // 1. Prova a leggere dalla cache
  try {
    let cachedAddons = await kv.get(cacheKey);
    if (cachedAddons) {
      // console.log('Cache HIT per getAddons');
      return cachedAddons;
    }
  } catch (e) {
    console.error("Errore lettura Vercel KV (getAddons):", e.message);
    // Non bloccare, continua con il fetch
  }

  // console.log('Cache MISS per getAddons. Fetch da Stremio...');
  // 2. Se non in cache, fetcha da Stremio
  const res = await fetchWithTimeout(ADDONS_GET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey: authKey.trim() })
  });
  
  const data = await res.json();
  if (data.error || !data.result) throw new Error(data.error?.message || 'Impossibile recuperare gli addon.');
  
  const addons = data.result.addons || [];

  // 3. Salva il risultato in cache
  try {
    await kv.set(cacheKey, addons, { ex: CACHE_TTL_ADDONS });
  } catch (e) {
    console.error("Errore scrittura Vercel KV (getAddons):", e.message);
  }

  return addons;
}

async function getStremioData(email, password) {
  const { error } = loginSchema.validate({ email, password });
  if (error) throw new Error("Email o Password non validi.");
  const res = await fetchWithTimeout(LOGIN_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), password })
  });
  const data = await res.json();
  if (data.error || !data.result?.authKey) throw new Error(data.error?.message || 'Credenziali non valide.');
  
  // Questa funzione ora userà la cache (se disponibile)
  const addons = await getAddonsByAuthKey(data.result.authKey); 
  return { addons, authKey: data.result.authKey };
}

// --- ENDPOINTS ---

// Login
app.post('/api/login', async (req,res)=>{
  const { email, password, authKey: providedAuthKey } = req.body;
  try {
    let data; 
    if(email && password) {
        data = await getStremioData(email,password);
    } else if(providedAuthKey) {
        const { error } = authKeySchema.validate({ authKey: providedAuthKey });
        if (error) throw new Error("AuthKey fornita non valida.");
        data = { addons: await getAddonsByAuthKey(providedAuthKey), authKey: providedAuthKey };
    } else {
        return res.status(400).json({ error: { message: "Email/password o authKey obbligatori." } });
    }
    
    res.cookie('authKey', data.authKey, cookieOptions); 
    return res.json({ addons: data.addons }); // Ritorna solo addons (cache-friendly)

  } catch(err) {
    const status = err.message.includes('timeout') ? 504 : 401;
    res.status(status).json({ error: { message: err.message } });
  }
});

// Get addons
app.post('/api/get-addons', async (req,res)=>{
  const { authKey } = req.cookies; 
  const { email } = req.body;
  const { error } = authKeySchema.validate({ authKey });
  if(error || !email) return res.status(400).json({ error: { message: "authKey (cookie) non valida o email (body) mancante." } });
  
  // Questa funzione ora userà la cache (se disponibile)
  try { res.json({ addons: await getAddonsByAuthKey(authKey) }); }  
  catch(err){ res.status(err.message.includes('timeout') ? 504 : 500).json({ error:{ message: err.message } }); }
});

// Set addons
app.post('/api/set-addons', async (req,res)=>{
  const { authKey } = req.cookies; 
  const authKeyValidation = authKeySchema.validate({ authKey });
  if (authKeyValidation.error) return res.status(401).json({ error: { message: "Nessuna authKey valida fornita (cookie)." } });

  const { error } = setAddonsSchema.validate(req.body); 
  if(error) return res.status(400).json({ error: { message: error.details[0].message } });
  
  try {
    const { addons } = req.body; 
    const addonsToSave = addons.map(a=>{
      const clean = JSON.parse(JSON.stringify(a));
      if(clean.isEditing) delete clean.isEditing;
      if(clean.newLocalName) delete clean.newLocalName;
      if(clean.manifest){ delete clean.manifest.newLocalName; delete clean.manifest.isEditing; }
      clean.manifest.name = a.manifest.name.trim();
      if(!clean.manifest.id) clean.manifest.id = `external-${Math.random().toString(36).substring(2,9)}`;
      return clean;
    });
    const resSet = await fetchWithTimeout(ADDONS_SET_URL, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ authKey: authKey.trim(), addons: addonsToSave }) 
    });
    const dataSet = await resSet.json();
    if(dataSet.error) throw new Error(dataSet.error.message || 'Errore salvataggio addon.');

    // --- MODIFICA --- (Invalidazione cache)
    // Se il salvataggio ha successo, invalidiamo la cache
    try {
      const cacheKey = getCacheKey('addons', authKey);
      await kv.del(cacheKey);
      // console.log('Cache INVALIDATA per setAddons');
    } catch (e) {
      console.error("Errore invalidazione Vercel KV (setAddons):", e.message);
    }
    // --- FINE MODIFICA ---

    res.json({ success:true, message:"Addon salvati con successo." });
  } catch(err){ res.status(err.message.includes('timeout') ? 504 : 500).json({ error:{ message: err.message } }); }
});

// Fetch manifest
app.post('/api/fetch-manifest', async(req,res)=>{
  const { error } = manifestUrlSchema.validate(req.body);
  if(error) return res.status(400).json({ error:{ message: "URL manifesto non valido." } });
  
  const { manifestUrl } = req.body;
  if(!isSafeUrl(manifestUrl)) return res.status(400).json({ error:{ message:'URL non sicuro o non valido.' } });

  const cacheKey = getCacheKey('manifest', manifestUrl);

  // 1. Prova a leggere dalla cache
  try {
    let cachedManifest = await kv.get(cacheKey);
    if (cachedManifest) {
      // console.log('Cache HIT per fetchManifest');
      return res.json(cachedManifest);
    }
  } catch (e) {
    console.error("Errore lettura Vercel KV (fetchManifest):", e.message);
  }

  // 2. Se non in cache, fetcha
  // console.log('Cache MISS per fetchManifest. Fetch da URL...');
  try{
    const headers = {};
    if(GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;
    const resp = await fetchWithTimeout(manifestUrl,{ headers });
    if(!resp.ok) throw new Error(`Status ${resp.status}`);
    const manifest = await resp.json();
    if(!manifest.id || !manifest.version) throw new Error("Manifesto non valido.");
    
    // 3. Salva in cache
    try {
      await kv.set(cacheKey, manifest, { ex: CACHE_TTL_MANIFEST });
    } catch (e) {
      console.error("Errore scrittura Vercel KV (fetchManifest):", e.message);
    }

    res.json(manifest);
  }catch(err){ res.status(err.message.includes('timeout') ? 504 : 500).json({ error:{ message: err.message } }); }
});

// Monitor admin
app.post('/api/admin/monitor', async(req,res)=>{
  const { adminKey, targetEmail } = req.body;
  if(!MONITOR_KEY_SECRET || adminKey !== MONITOR_KEY_SECRET) return res.status(401).json({ error:{ message: "Chiave di monitoraggio non corretta." } });
  if(!targetEmail) return res.status(400).json({ error:{ message: "È necessaria l'email dell'utente da monitorare." } });
  return res.status(403).json({ error:{ message:`Impossibile accedere ai dati di ${targetEmail}. Stremio richiede la password/AuthKey.` } });
});

// Logout
app.post('/api/logout', (req, res) => {
    res.cookie('authKey', '', {
        ...cookieOptions,
        maxAge: 0 // Scadenza immediata
    });
    res.json({ success: true, message: "Logout effettuato." });
});

// --- MODIFICA --- (Endpoint Health Check)
// Aggiunto per tenere "calda" la funzione serverless con UptimeRobot
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

// 404 API
app.use('/api/*',(req,res)=>res.status(404).json({ error:{ message:'Endpoint non trovato.' }}));

// HTTPS forzato in produzione
if(process.env.NODE_ENV==='production'){
  app.use((req,res,next)=>{
    if(req.header('x-forwarded-proto')!=='httpsS') return res.redirect(301,`https://${req.header('host')}${req.url}`);
    next();
  });
}

// Avvio server solo se NODE_ENV !== vercel
if(process.env.NODE_ENV!=='vercel' && !process.env.VERCEL_ENV){
  app.listen(PORT,()=>console.log(`Server avviato sulla porta ${PORT}`));
}

// Esportazione per Vercel
module.exports = app;
