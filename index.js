

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const dns = require('dns').promises;
const net = require('net');

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

// --- Parametri sicurezza fetch-manifest ---
const MAX_MANIFEST_BYTES = Number(process.env.MAX_MANIFEST_BYTES) || (2 * 1024 * 1024); // 2MB
const MAX_REDIRECTS = Number(process.env.MAX_MANIFEST_REDIRECTS) || 3;

// --- Helmet + CSP (consigliata riduzione unsafe se possibile) ---
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "https://unpkg.com", "https://cdnjs.cloudflare.com"], // rimosso 'unsafe-eval'
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
        process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : ''
      ],
      "img-src": ["'self'", "data:", "https:"]
    }
  }
}));

// --- Middleware generali ---
app.use(express.json({ limit: '1mb' })); // body limit per JSON generico
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Rate Limiter ---
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Troppe richieste. Riprova più tardi.' } }
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Troppi tentativi di login. Riprova più tardi.' } }
});
app.use('/api/', apiLimiter);
app.use('/api/login', loginLimiter);

// --- CORS (più restrittivo) ---
// Nota: richiediamo Origin per le chiamate browser. Se vuoi permettere richieste CLI senza Origin,
// modifica la policy (ma attenzione).
const allowedOrigins = [
  'http://localhost:7860',
  'https://stream-organizer.vercel.app'
];
if (process.env.VERCEL_URL) allowedOrigins.push(`https://${process.env.VERCEL_URL}`);

app.use(cors({
  origin: (origin, callback) => {
    // Nota: rifiutiamo le richieste senza Origin per maggiore sicurezza (es. curl senza origin)
    if (!origin) return callback(new Error('Origin header richiesto.'), false);
    if (allowedOrigins.includes(origin) || (process.env.VERCEL_ENV === 'preview' && origin.endsWith('.vercel.app'))) {
      return callback(null, true);
    }
    return callback(new Error('La policy CORS non permette l\'accesso da questa origine.'), false);
  },
  credentials: true
}));

// --- AbortController Node <18 polyfill (lo lasciamo) ---
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
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: 30 * 24 * 60 * 60 * 1000
};

// --- Schemi Joi ---
const schemas = {
  authKey: Joi.object({ authKey: Joi.string().min(1).required() }),
  login: Joi.object({ email: Joi.string().email().required(), password: Joi.string().min(6).required() }),
  manifestUrl: Joi.object({ manifestUrl: Joi.string().uri({ scheme: ['http','https'] }).required() }),
  // Manifest schema: restrittivo, estendi se necessario
  manifest: Joi.object({
    id: Joi.string().pattern(/^[a-zA-Z0-9\-\_:.]{1,200}$/).required(),
    version: Joi.string().pattern(/^\d+\.\d+\.\d+(-.*)?$/).required(),
    name: Joi.string().max(200).required()
    // aggiungi altri campi consentiti qui
  }).required(),
  addonManifest: Joi.object({
    id: Joi.string().max(200).required(),
    name: Joi.string().max(200).required(),
    version: Joi.string().required(),
    resources: Joi.array().items(Joi.string()).optional()
  }).required(),
  addon: Joi.object({
    manifest: Joi.object().required(),
    // altri campi controllati opzionali
  }),
  setAddons: Joi.object({ addons: Joi.array().min(1).items(Joi.object()).required(), email: Joi.string().email().allow(null) })
};


// ----------------------
// FUNZIONI DI SICUREZZA
// ----------------------

// Indirizzi privati/riservati IPv4 CIDR checks (usiamo check semplice convertendo IPv4 in integer)
function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc,oct)=> (acc << 8) + parseInt(oct,10), 0) >>> 0;
}
function inCidr(ip, network, bits) {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  const ipInt = ipv4ToInt(ip);
  const netInt = ipv4ToInt(network);
  return (ipInt & mask) === (netInt & mask);
}
function isPrivateIPv4(ip) {
  // 10.0.0.0/8
  if (inCidr(ip, '10.0.0.0', 8)) return true;
  // 172.16.0.0/12
  if (inCidr(ip, '172.16.0.0', 12)) return true;
  // 192.168.0.0/16
  if (inCidr(ip, '192.168.0.0', 16)) return true;
  // 127.0.0.0/8 loopback
  if (inCidr(ip, '127.0.0.0', 8)) return true;
  // 169.254.0.0/16 link-local / metadata
  if (inCidr(ip, '169.254.0.0', 16)) return true;
  // 0.0.0.0/8 reserved
  if (inCidr(ip, '0.0.0.0', 8)) return true;
  return false;
}
function isPrivateIPv6(ip) {
  const low = ip.toLowerCase();
  // loopback
  if (low === '::1' || low === '0:0:0:0:0:0:0:1') return true;
  // Unique local fc00::/7 => starts with fc or fd
  if (low.startsWith('fc') || low.startsWith('fd')) return true;
  // Link-local fe80::/10
  if (low.startsWith('fe80') || low.startsWith('fe8')) return true;
  return false;
}

// isSafeUrlStrict: risolve il nome e verifica che nessun IP sia privato / loopback / link-local
async function isSafeUrlStrict(urlString) {
  try {
    const parsed = new URL(urlString);

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    const hostname = parsed.hostname;

    // Blocca nomi ovvi di loopback / host locali
    if (/^localhost(\.|$)/i.test(hostname)) return false;
    if (/^127\./.test(hostname)) return false;
    if (/^0\.0\.0\.0$/.test(hostname)) return false;

    // Prova a risolvere il nome (se fallisce, rifiuta per sicurezza)
    let addresses;
    try {
      addresses = await dns.lookup(hostname, { all: true });
    } catch (e) {
      // Non riesce a risolvere -> rifiuta
      return false;
    }

    // Controlla ogni address risolto
    for (const entry of addresses) {
      const addr = entry.address;
      if (net.isIPv4(addr)) {
        if (isPrivateIPv4(addr)) return false;
      } else if (net.isIPv6(addr)) {
        if (isPrivateIPv6(addr)) return false;
      } else {
        // indirizzo non riconosciuto
        return false;
      }
    }

    return true;
  } catch (e) {
    return false;
  }
}


// --- Async wrapper ---
const asyncHandler = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

// --- Funzioni principali ---
async function getAddonsByAuthKey(authKey) {
  const { error } = schemas.authKey.validate({ authKey });
  if (error) throw Object.assign(new Error("AuthKey non valida."), { status: 400 });

  const res = await fetchWithTimeout(ADDONS_GET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authKey: authKey.trim() })
  });
  const data = await res.json();
  if (!data.result || data.error) throw Object.assign(new Error(data.error?.message || 'Errore recupero addon.'), { status: 502 });
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

// --- ENDPOINTS ---
app.post('/api/login', asyncHandler(async (req, res) => {
  const { email, password, authKey: providedAuthKey } = req.body;
  let data;
  if (email && password) data = await getStremioData(email, password);
  else if (providedAuthKey) data = { addons: await getAddonsByAuthKey(providedAuthKey), authKey: providedAuthKey };
  else return res.status(400).json({ error: { message: "Email/password o authKey richiesti." } });

  // Nota: per migliori sicurezza, valuta di salvare solo un session id nel cookie e tenere authKey in store server-side.
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

  // Validazione e sanitizzazione più rigorosa per ogni addon
  const addonSchema = Joi.object({
    manifest: Joi.object({
      id: Joi.string().max(200).optional(),
      name: Joi.string().max(200).required(),
      version: Joi.string().max(50).required()
    }).required()
    // aggiungi altri campi consentiti qui
  });

  const addonsToSave = [];
  for (const a of req.body.addons) {
    const validated = addonSchema.validate(a, { stripUnknown: true });
    if (validated.error) throw Object.assign(new Error('Addon malformato: ' + validated.error.details[0].message), { status: 400 });
    const clean = validated.value;
    // Normalizzazioni
    clean.manifest.name = clean.manifest.name.trim();
    if (!clean.manifest.id) clean.manifest.id = `external-${Math.random().toString(36).substring(2,9)}`;
    addonsToSave.push(clean);
  }

  const resSet = await fetchWithTimeout(ADDONS_SET_URL,{
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ authKey: authKey.trim(), addons: addonsToSave })
  });
  const dataSet = await resSet.json();
  if(dataSet.error) throw Object.assign(new Error(dataSet.error.message || 'Errore salvataggio addon.'), { status: 502 });
  res.json({ success:true, message:"Addon salvati con successo." });
}));

// ===================================================================
// ENDPOINT /api/fetch-manifest (hardening: SSRF, redirect, size, content-type, schema)
// ===================================================================
app.post('/api/fetch-manifest', asyncHandler(async(req,res)=>{
  const { error } = schemas.manifestUrl.validate(req.body);
  if(error) return res.status(400).json({ error:{ message: "URL manifesto non valido." } });

  const { manifestUrl } = req.body;

  // 1. Controllo URL "strict" risolvendo DNS e bloccando IP interni
  if(!await isSafeUrlStrict(manifestUrl)) {
    return res.status(400).json({ error:{ message:'URL non sicuro.' } });
  }

  // 2. Preparare headers in modo sicuro; aggiungere token SOLO se hostname è nella whitelist
  const headers = {};
  const parsedUrl = new URL(manifestUrl);
  const allowedTokenHosts = ['api.github.com', 'raw.githubusercontent.com'];
  if (GITHUB_TOKEN && allowedTokenHosts.includes(parsedUrl.hostname)) {
    headers['Authorization'] = `token ${GITHUB_TOKEN}`;
  }

  // 3. Fetch manuale con gestione redirect (non segui automaticamente)
  let currentUrl = manifestUrl;
  for (let i=0;i<=MAX_REDIRECTS;i++) {
    // Prima di ogni fetch: ricontrolla che target sia sicuro (in caso di redirect relativi)
    if (!await isSafeUrlStrict(currentUrl)) throw Object.assign(new Error('Redirect non sicuro.'), { status: 400 });

    const resp = await fetchWithTimeout(currentUrl, { headers, redirect: 'manual' });

    // Gestione redirect
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location');
      if (!loc) throw Object.assign(new Error('Redirect senza Location.'), { status: 400 });
      // Risolvi relative -> absolute
      currentUrl = new URL(loc, currentUrl).toString();
      // Loop: verrà verificato nella prossima iterazione
      if (i === MAX_REDIRECTS) throw Object.assign(new Error('Troppi redirect.'), { status: 400 });
      continue;
    }

    // Non-redirect => processa risposta
    if (!resp.ok) throw Object.assign(new Error(`Status ${resp.status}`), { status: 502 });

    // Verifica Content-Type
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('application/json')) throw Object.assign(new Error('Content-Type non JSON.'), { status: 400 });

    // Leggi stream limitando la dimensione
    const reader = resp.body[Symbol.asyncIterator]();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.next();
      if (done) break;
      const chunk = Buffer.from(value);
      received += chunk.length;
      if (received > MAX_MANIFEST_BYTES) {
        // Se superiamo la soglia, interrompi e rifiuta
        if (resp.body && typeof resp.body.destroy === 'function') resp.body.destroy();
        throw Object.assign(new Error('Manifesto troppo grande.'), { status: 413 });
      }
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    let manifest;
    try {
      manifest = JSON.parse(buffer.toString('utf8'));
    } catch (e) {
      throw Object.assign(new Error('JSON manifesto non valido.'), { status: 400 });
    }

    // Validazione schema del manifesto con Joi (schema restrittivo definito sopra)
    const { error: mErr } = schemas.manifest.validate(manifest);
    if (mErr) throw Object.assign(new Error('Manifesto non conforme: ' + mErr.details[0].message), { status: 400 });

    // Se tutto ok, ritorna manifesto (ma non includere headers sensibili)
    return res.json(manifest);
  }

  throw Object.assign(new Error('Errore durante il recupero manifesto.'), { status: 500 });
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

// --- HTTPS forzato in produzione (più sicuro: usa req.hostname) ---
if(process.env.NODE_ENV==='production'){
  app.use((req,res,next)=>{
    if(req.header('x-forwarded-proto')!=='https') {
      // usa req.hostname (Express pulisce il valore basandosi su trust proxy)
      const host = req.hostname;
      // opzionale: verifica host in whitelist prima di redirect
      return res.redirect(301, `https://${host}${req.originalUrl}`);
    }
    next();
  });
}

// --- Error handler globale (più cauto) ---
app.use((err, req, res, next)=>{
  // In produzione: logga con logger strutturato e non esporre dettagli al client
  console.error(err && err.stack ? err.stack : err);

  const status = err.status || 500;
  let message = 'Errore interno del server.';

  // Messaggi più specifici per client errors
  if (status < 500 && err.message) {
    message = err.message;
  } else if (err.message && /timeout/i.test(err.message)) {
    message = 'Richiesta al server scaduta (timeout).';
  }

  res.status(status).json({ error:{ message } });
});

// --- Avvio server locale ---
if(!process.env.VERCEL_ENV) app.listen(PORT,()=>console.log(`Server avviato sulla porta ${PORT}`));

// --- Export per Vercel ---
module.exports = app;
