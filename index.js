const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');

// --- LIBRERIE PER IL DATABASE CENTRALE (Come nel config.py) ---
const mongoose = require('mongoose'); 
const sanitizeHtml = require('sanitize-html');

// --- FIX VERCEL: Isolamento moduli core ---
const { promises: dns } = require('dns');
const net = require('net');

const app = express();
const PORT = process.env.PORT || 7860;

app.set('trust proxy', 1);

// --- CONFIGURAZIONE (Ispirata al tuo file Python) ---
const CONFIG = {
    STREMIO_API: 'https://api.strem.io/api/',
    // Qui usiamo la variabile d'ambiente di Vercel per sicurezza
    DATABASE_URL: process.env.DATABASE_URL, 
    TIMEOUT: 10000
};

const LOGIN_API_URL = `${CONFIG.STREMIO_API}login`;
const ADDONS_GET_URL = `${CONFIG.STREMIO_API}addonCollectionGet`;
const ADDONS_SET_URL = `${CONFIG.STREMIO_API}addonCollectionSet`;

const MAX_JSON_PAYLOAD = '250kb';

// ---------------------------------------------------------------------
// CONNESSIONE DATABASE CENTRALE (MongoDB)
// ---------------------------------------------------------------------
let isConnected = false;

// Schema Utente (La "memoria" del database)
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
    if (!CONFIG.DATABASE_URL) {
        console.warn("⚠️ NESSUN DATABASE_URL! I dati non verranno salvati.");
        return;
    }
    try {
        await mongoose.connect(CONFIG.DATABASE_URL, { serverSelectionTimeoutMS: 5000 });
        isConnected = true;
        console.log("✅ Connesso al Database Centrale");
    } catch (error) {
        console.error("❌ Errore DB:", error.message);
    }
}

// ---------------------------------------------------------------------
// MIDDLEWARE & SICUREZZA
// ---------------------------------------------------------------------
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: MAX_JSON_PAYLOAD }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const apiLimiter = rateLimit({ windowMs: 15*60*1000, max: 300 });
app.use('/api/', apiLimiter);

const allowedOrigins = ['http://localhost:7860', 'https://stream-organizer.vercel.app'];
if (process.env.VERCEL_URL) allowedOrigins.push(`https://${process.env.VERCEL_URL}`);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(o => origin.startsWith(o)) || origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }
    return callback(new Error('Blocco CORS'), false);
  },
  credentials: true
}));

// --- UTILS ---
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

if (!global.AbortController) global.AbortController = require('abort-controller').AbortController;
async function fetchWithTimeout(url, options = {}, timeout = CONFIG.TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) { clearTimeout(id); throw err; }
}

function isPrivateIp(ip) {
  if (net.isIPv6(ip) && ip.startsWith('::ffff:')) ip = ip.substring(7);
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254) || parts[0] === 0;
  }
  return false;
}
async function isSafeUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.hostname.toLowerCase() === 'localhost') return false;
    if (net.isIP(parsed.hostname)) return !isPrivateIp(parsed.hostname);
    const addressesInfo = await dns.lookup(parsed.hostname, { all: true });
    const ips = addressesInfo.map(info => info.address);
    return !ips.some(isPrivateIp);
  } catch (err) { return false; }
}

const sanitizeOptions = { allowedTags: [], allowedAttributes: {} };
const sanitize = (text) => text ? sanitizeHtml(text.trim(), sanitizeOptions) : '';
function sanitizeObject(data) {
  if (typeof data === 'string') return sanitize(data);
  if (Array.isArray(data)) return data.map(item => sanitizeObject(item));
  if (data && typeof data === 'object') {
    const newObj = {};
    for (const key in data) newObj[key] = sanitizeObject(data[key]);
    return newObj;
  }
  return data; 
}

async function getAddonsByAuthKey(authKey) {
    const res = await fetchWithTimeout(ADDONS_GET_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authKey: authKey.trim() })
    });
    const data = await res.json();
    if (!data.result) throw new Error(data.error?.message || "Errore recupero addon.");
    return data.result.addons || [];
}

// ---------------------------------------------------------------------
// ENDPOINTS
// ---------------------------------------------------------------------

// 1. LOGIN (Con Sincronizzazione DB Centrale)
app.post('/api/login', asyncHandler(async (req, res) => {
  // Avvia connessione in parallelo
  const dbInit = connectToDatabase();

  const { email, password, authKey: providedAuthKey } = req.body;
  let data;
  
  // Normalizza email
  const cleanEmail = email ? email.trim().toLowerCase() : null;

  if (cleanEmail && password) {
    const loginRes = await fetchWithTimeout(LOGIN_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, password })
    });
    const loginData = await loginRes.json();
    if (!loginData.result?.authKey) throw new Error("Credenziali non valide.");
    const addons = await getAddonsByAuthKey(loginData.result.authKey);
    data = { authKey: loginData.result.authKey, addons };
  } else if (providedAuthKey) {
    const trimmedKey = providedAuthKey.trim();
    const addons = await getAddonsByAuthKey(trimmedKey);
    data = { authKey: trimmedKey, addons };
  } else {
      return res.status(400).json({ error: { message: "Dati mancanti." } });
  }

  let autoUpdateEnabled = false;
  
  // Salva/Aggiorna nel Database Centrale
  if (cleanEmail) {
      await dbInit;
      try {
          const user = await User.findOneAndUpdate(
              { email: cleanEmail },
              { 
                  $set: { authKey: data.authKey, updatedAt: new Date() },
                  $setOnInsert: { autoUpdate: false } 
              },
              { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          autoUpdateEnabled = user.autoUpdate;
      } catch (e) { console.error("Errore sync DB:", e); }
  }

  res.cookie('authKey', data.authKey, { httpOnly: true, secure: true, sameSite: 'none' });
  res.json({ 
      addons: data.addons, 
      authKey: data.authKey,
      autoUpdateEnabled 
  });
}));

// 2. PREFERENZE (Lettura/Scrittura su DB Centrale)
app.get('/api/preferences', asyncHandler(async (req, res) => {
    let authKey = req.cookies.authKey || req.headers.authorization;
    if (!authKey) return res.status(401).json({ error: "No Auth" });

    await connectToDatabase();
    const user = await User.findOne({ authKey }).select('autoUpdate'); 
    res.json({ autoUpdate: user ? user.autoUpdate : false });
}));

app.post('/api/preferences', asyncHandler(async (req, res) => {
    const authKey = req.cookies.authKey || req.body.authKey;
    const email = req.body.email ? req.body.email.trim().toLowerCase() : null;
    const { autoUpdate } = req.body;

    if (!authKey || !email) return res.status(400).json({ error: "Dati mancanti" });

    await connectToDatabase();
    await User.findOneAndUpdate(
        { email }, 
        { email, authKey, autoUpdate: !!autoUpdate, updatedAt: new Date() },
        { upsert: true, new: true }
    );
    res.json({ success: true });
}));

// 3. CRON JOB (Aggiornamento Automatico)
app.get('/api/cron', async (req, res) => {
    await connectToDatabase();
    console.log("⏰ [CRON] Controllo aggiornamenti...");
    
    const users = await User.find({ autoUpdate: true }).select('email authKey');
    let updatedCount = 0;

    for (const user of users) {
        try {
            const addonsRes = await fetchWithTimeout(ADDONS_GET_URL, {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ authKey: user.authKey })
            });
            const addonsData = await addonsRes.json();
            if (!addonsData.result) continue;

            const addons = addonsData.result.addons;
            let hasUpdates = false;

            const checkUpdate = async (addon) => {
                const url = addon.transportUrl || addon.manifest?.id;
                if (!url || !url.startsWith('http') || !(await isSafeUrl(url))) return addon;
                try {
                    const r = await fetchWithTimeout(url, {}, 5000);
                    if (r.ok) {
                        const remote = await r.json();
                        if (remote.version !== addon.manifest.version) {
                            hasUpdates = true;
                            return { ...addon, manifest: remote };
                        }
                    }
                } catch(e){}
                return addon;
            };

            const newAddons = await Promise.all(addons.map(checkUpdate));

            if (hasUpdates) {
                await fetchWithTimeout(ADDONS_SET_URL, {
                    method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ authKey: user.authKey, addons: newAddons })
                });
                updatedCount++;
                User.updateOne({ _id: user._id }, { lastCheck: new Date() }).exec();
            }
        } catch(e) { console.error(`Err ${user.email}:`, e.message); }
    }
    res.json({ success: true, updated: updatedCount });
});

// 4. STANDARD ENDPOINTS
app.post('/api/get-addons', asyncHandler(async (req, res) => {
    const authKey = req.cookies.authKey || req.body.authKey;
    if (!authKey) return res.status(401).json({error: "No Auth"});
    const addons = await getAddonsByAuthKey(authKey);
    res.json({ addons });
}));

app.post('/api/set-addons', asyncHandler(async (req, res) => {
    const authKey = req.cookies.authKey || req.body.authKey;
    if (!authKey) return res.status(401).json({error: "No Auth"});
    const addons = sanitizeObject(req.body.addons); // Usa sanitize ricorsivo
    await fetchWithTimeout(ADDONS_SET_URL, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ authKey, addons })
    });
    res.json({ success: true });
}));

app.post('/api/fetch-manifest', asyncHandler(async (req, res) => {
    const { manifestUrl } = req.body;
    if (!manifestUrl || !(await isSafeUrl(manifestUrl))) return res.status(400).json({error: "URL non sicuro"});
    const r = await fetchWithTimeout(manifestUrl, { redirect: 'error' });
    if (!r.ok) throw new Error("Fetch failed");
    res.json(await r.json());
}));

app.post('/api/logout', (req, res) => {
    res.cookie('authKey', '', { ...cookieOptions, maxAge: 0 });
    res.json({ success: true });
});

app.use('/api/*', (req, res) => res.status(404).json({error: "Not found"}));

// Fallback Frontend
app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    next();
});

// Gestione Errori
app.use((err, req, res, next) => {
    console.error(`ERROR: ${err.message}`);
    res.status(err.status || 500).json({ error: { message: err.message || "Server Error" } });
});

if (!process.env.VERCEL_ENV) connectToDatabase().then(() => app.listen(PORT, () => console.log(`Running on ${PORT}`)));

module.exports = app;
