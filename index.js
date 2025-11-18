const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const sanitizeHtml = require('sanitize-html');

// Fix per moduli core su Vercel
const { promises: dns } = require('dns');
const net = require('net');

const app = express();
const PORT = process.env.PORT || 7860;

app.set('trust proxy', 1);

const STREMIO_API_BASE = 'https://api.strem.io/api/';
const LOGIN_API_URL = `${STREMIO_API_BASE}login`;
const ADDONS_GET_URL = `${STREMIO_API_BASE}addonCollectionGet`;
const ADDONS_SET_URL = `${STREMIO_API_BASE}addonCollectionSet`;
const FETCH_TIMEOUT = 10000;
const MAX_JSON_PAYLOAD = '250kb';
const MAX_MANIFEST_SIZE_BYTES = 250 * 1024;
const MAX_API_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_LOGIN_RESPONSE_BYTES = 1 * 1024 * 1024;
const SANITIZE_MAX_DEPTH = 6;
const SANITIZE_MAX_STRING = 2000;
const SANITIZE_MAX_ARRAY = 200;

// --- DATABASE ---
const MONGO_URI = process.env.DATABASE_URL; 
let isConnected = false;

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    authKey: { type: String }, // L'ultima chiave usata
    autoUpdate: { type: Boolean, default: false },
    lastCheck: { type: Date },
    updatedAt: { type: Date, default: Date.now }
});
const User = mongoose.models.User || mongoose.model('User', userSchema);

async function connectToDatabase() {
    if (isConnected) return;
    if (!MONGO_URI) return console.warn("⚠️ DATABASE_URL mancante.");
    try {
        await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 });
        isConnected = true;
        console.log("✅ Connesso a MongoDB");
    } catch (error) { console.error("❌ Errore DB:", error.message); }
}

// --- MIDDLEWARE ---
app.use(helmet({ contentSecurityPolicy: false })); // Semplificato per evitare problemi UI
app.use(express.json({ limit: MAX_JSON_PAYLOAD }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const apiLimiter = rateLimit({ windowMs: 15*60*1000, max: 200 });
app.use('/api/', apiLimiter);

const allowedOrigins = ['http://localhost:7860', 'https://stream-organizer.vercel.app'];
if (process.env.VERCEL_URL) allowedOrigins.push(`https://${process.env.VERCEL_URL}`);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.some(o => origin.startsWith(o)) || origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }
    return callback(new Error('CORS Block'), false);
  },
  credentials: true
}));

// --- UTILS ---
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

if (!global.AbortController) global.AbortController = require('abort-controller').AbortController;
async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
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

// --- ENDPOINTS ---

// 1. LOGIN (FIXED FOR SYNC)
app.post('/api/login', asyncHandler(async (req, res) => {
  const { email, password, authKey: providedAuthKey } = req.body;
  let data;

  // 1. Autenticazione con Stremio
  if (email && password) {
    // Login classico con credenziali
    const loginRes = await fetchWithTimeout(LOGIN_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password })
    });
    const loginData = await loginRes.json();
    if (!loginData.result?.authKey) throw new Error("Credenziali non valide.");
    
    // Otteniamo gli addon
    const addonsRes = await fetchWithTimeout(ADDONS_GET_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authKey: loginData.result.authKey })
    });
    const addonsData = await addonsRes.json();
    data = { authKey: loginData.result.authKey, addons: addonsData.result?.addons || [] };

  } else if (providedAuthKey) {
    // Login con chiave esistente
    const authKey = providedAuthKey.trim();
    const addonsRes = await fetchWithTimeout(ADDONS_GET_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authKey })
    });
    const addonsData = await addonsRes.json();
    if (!addonsData.result) throw new Error("AuthKey scaduta.");
    data = { authKey, addons: addonsData.result.addons || [] };
  } else {
      return res.status(400).json({ error: { message: "Dati mancanti." } });
  }

  // 2. SINCRONIZZAZIONE DB (Il cuore del fix)
  let autoUpdateEnabled = false;
  
  if (email) {
      await connectToDatabase();
      
      // Cerchiamo se l'utente esiste già con questa email
      const existingUser = await User.findOne({ email });

      if (existingUser) {
          // UTENTE ESISTE: Manteniamo la sua preferenza di autoUpdate
          autoUpdateEnabled = existingUser.autoUpdate;
          
          // Aggiorniamo la AuthKey nel DB perché è cambiata con questo nuovo login
          existingUser.authKey = data.authKey;
          existingUser.updatedAt = new Date();
          await existingUser.save();
          console.log(`[LOGIN] Utente ${email} riconosciuto. Key aggiornata. AutoUpdate: ${autoUpdateEnabled}`);
      } else {
          // NUOVO UTENTE SUL DB: Creiamolo (default autoUpdate: false)
          await User.create({
              email,
              authKey: data.authKey,
              autoUpdate: false
          });
          console.log(`[LOGIN] Nuovo utente DB creato: ${email}`);
      }
  }

  // 3. Risposta
  res.cookie('authKey', data.authKey, { httpOnly: true, secure: true, sameSite: 'none' });
  res.json({ 
      addons: data.addons, 
      authKey: data.authKey,
      autoUpdateEnabled // Il frontend usa questo per settare l'interruttore
  });
}));

// 2. GET PREFERENCES (Per sync quando ricarichi la pagina)
app.get('/api/preferences', asyncHandler(async (req, res) => {
    const { authKey } = req.cookies;
    if (!authKey) return res.status(401).json({ error: "No Auth" });

    await connectToDatabase();
    // Cerca l'utente che ha QUESTA chiave di sessione
    const user = await User.findOne({ authKey });
    
    res.json({ autoUpdate: user ? user.autoUpdate : false });
}));

// 3. SAVE PREFERENCES
app.post('/api/preferences', asyncHandler(async (req, res) => {
    const { authKey } = req.cookies;
    const { email, autoUpdate } = req.body;
    
    // Fallback authKey dal body se i cookie non vanno (es. Safari mobile a volte)
    const key = authKey || req.body.authKey;

    if (!key || !email) return res.status(400).json({ error: "Dati mancanti" });

    await connectToDatabase();
    
    // Aggiorna o crea
    await User.findOneAndUpdate(
        { email }, 
        { email, authKey: key, autoUpdate: !!autoUpdate, updatedAt: new Date() },
        { upsert: true, new: true }
    );
    
    res.json({ success: true });
}));

// 4. CRON JOB
app.get('/api/cron', async (req, res) => {
    await connectToDatabase();
    console.log("⏰ [CRON] Starting...");
    
    const users = await User.find({ autoUpdate: true });
    let updatedCount = 0;

    for (const user of users) {
        try {
            // Fetch current addons
            const addonsRes = await fetchWithTimeout(ADDONS_GET_URL, {
                method: 'POST', headers: {'Content-Type':'application/json'},
                body: JSON.stringify({ authKey: user.authKey })
            });
            const addonsData = await addonsRes.json();
            if (!addonsData.result) continue; // Key scaduta o errore

            const addons = addonsData.result.addons;
            let hasUpdates = false;

            // Check updates
            const newAddons = await Promise.all(addons.map(async (addon) => {
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
            }));

            // Save if needed
            if (hasUpdates) {
                await fetchWithTimeout(ADDONS_SET_URL, {
                    method: 'POST', headers: {'Content-Type':'application/json'},
                    body: JSON.stringify({ authKey: user.authKey, addons: newAddons })
                });
                updatedCount++;
                user.lastCheck = new Date();
                await user.save();
            }
        } catch(e) {
            console.error(`Errore utente ${user.email}`, e.message);
        }
    }
    res.json({ success: true, updated: updatedCount });
});

// ALTRI ENDPOINT (Standard)
app.post('/api/get-addons', asyncHandler(async (req, res) => {
    const { authKey } = req.cookies;
    if (!authKey) return res.status(401).json({error: "No Auth"});
    const r = await fetchWithTimeout(ADDONS_GET_URL, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ authKey })
    });
    const d = await r.json();
    res.json({ addons: d.result?.addons || [] });
}));

app.post('/api/set-addons', asyncHandler(async (req, res) => {
    const { authKey } = req.cookies;
    if (!authKey) return res.status(401).json({error: "No Auth"});
    
    // Pulisci dati per sicurezza
    const addons = req.body.addons.map(a => {
        let c = JSON.parse(JSON.stringify(a));
        // Basic sanitize
        if (c.manifest && typeof c.manifest === 'object') {
            for(let k in c.manifest) if(typeof c.manifest[k] === 'string') c.manifest[k] = sanitizeHtml(c.manifest[k]);
        }
        return c;
    });

    const r = await fetchWithTimeout(ADDONS_SET_URL, {
        method: 'POST', headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ authKey, addons })
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error.message);
    res.json({ success: true });
}));

app.post('/api/fetch-manifest', asyncHandler(async (req, res) => {
    const { manifestUrl } = req.body;
    if (!(await isSafeUrl(manifestUrl))) return res.status(400).json({error: "URL non sicuro"});
    const r = await fetchWithTimeout(manifestUrl, { redirect: 'error' });
    if (!r.ok) throw new Error("Fetch failed");
    res.json(await r.json());
}));

app.post('/api/logout', (req, res) => {
    res.cookie('authKey', '', { maxAge: 0 });
    res.json({ success: true });
});

app.use('/api/*', (req, res) => res.status(404).json({error: "Not found"}));

// Fallback per SPA (Frontend)
app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    next();
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: { message: err.message || "Server Error" } });
});

if (!process.env.VERCEL_ENV) {
    connectToDatabase().then(() => app.listen(PORT, () => console.log(`Running on ${PORT}`)));
}

module.exports = app;
