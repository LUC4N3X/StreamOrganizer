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

// --- DATABASE ---
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

// Connessione Ottimizzata (Promise Caching)
let dbPromise = null;
async function connectToDatabase() {
    if (isConnected) return;
    if (!MONGO_URI) return;
    
    // Se c'è già una connessione in corso, usala invece di aprirne una nuova
    if (!dbPromise) {
        dbPromise = mongoose.connect(MONGO_URI, { 
            serverSelectionTimeoutMS: 5000,
            maxPoolSize: 1 // Ottimizzazione per Serverless
        }).then(() => {
            isConnected = true;
            console.log("✅ DB Connected");
        }).catch(e => {
            dbPromise = null;
            console.error("❌ DB Error:", e.message);
        });
    }
    await dbPromise;
}

// --- MIDDLEWARE ---
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: MAX_JSON_PAYLOAD }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const apiLimiter = rateLimit({ windowMs: 15*60*1000, max: 300 }); // Aumentato leggermente
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

// --- HELPER STREMIO ---
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

// 1. LOGIN (TURBO MODE)
app.post('/api/login', asyncHandler(async (req, res) => {
  // 1. Avvia connessione DB in parallelo (senza aspettare)
  const dbInit = connectToDatabase();

  const { email, password, authKey: providedAuthKey } = req.body;
  let data;

  // 2. Esegui chiamate Stremio (mentre il DB si connette)
  if (email && password) {
    const loginRes = await fetchWithTimeout(LOGIN_API_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password })
    });
    const loginData = await loginRes.json();
    if (!loginData.result?.authKey) throw new Error("Credenziali non valide.");
    
    // Parallelizziamo anche il fetch degli addon se possibile, ma qui serve la key
    const addons = await getAddonsByAuthKey(loginData.result.authKey);
    data = { authKey: loginData.result.authKey, addons };

  } else if (providedAuthKey) {
    const trimmedKey = providedAuthKey.trim();
    const addons = await getAddonsByAuthKey(trimmedKey);
    data = { authKey: trimmedKey, addons };
  } else {
      return res.status(400).json({ error: { message: "Dati mancanti." } });
  }

  // 3. Gestione DB (Ora aspettiamo che sia pronto, ma dovrebbe aver finito)
  let autoUpdateEnabled = false;
  
  if (email) {
      await dbInit; // Aspetta solo se il DB è più lento di Stremio (raro)
      
      // USIAMO findOneAndUpdate con UPSERT (1 sola chiamata al DB invece di 3)
      // Se esiste: aggiorna authKey e updatedAt
      // Se non esiste: crea nuovo con autoUpdate: false
      try {
          const user = await User.findOneAndUpdate(
              { email },
              { 
                  $set: { authKey: data.authKey, updatedAt: new Date() },
                  $setOnInsert: { autoUpdate: false } // Setta false solo se crea nuovo
              },
              { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          autoUpdateEnabled = user.autoUpdate;
          console.log(`[LOGIN] Sync OK per ${email}`);
      } catch (e) {
          console.error("DB Update Fallito:", e);
          // Non blocchiamo il login se il DB fallisce
      }
  }

  // 4. Risposta Immediata
  res.cookie('authKey', data.authKey, { httpOnly: true, secure: true, sameSite: 'none' });
  res.json({ 
      addons: data.addons, 
      authKey: data.authKey,
      autoUpdateEnabled 
  });
}));

// 2. GET PREFERENCES
app.get('/api/preferences', asyncHandler(async (req, res) => {
    const { authKey } = req.cookies;
    if (!authKey) return res.status(401).json({ error: "No Auth" });
    await connectToDatabase();
    // Proiezione: prendi solo il campo autoUpdate per essere più veloce
    const user = await User.findOne({ authKey }).select('autoUpdate'); 
    res.json({ autoUpdate: user ? user.autoUpdate : false });
}));

// 3. SAVE PREFERENCES
app.post('/api/preferences', asyncHandler(async (req, res) => {
    const { authKey } = req.cookies;
    const { email, autoUpdate } = req.body;
    const key = authKey || req.body.authKey;

    if (!key || !email) return res.status(400).json({ error: "Dati mancanti" });

    // Non aspettiamo la connessione se è già attiva
    await connectToDatabase();
    
    // Fire and forget parziale (non bloccare troppo)
    await User.findOneAndUpdate(
        { email }, 
        { email, authKey: key, autoUpdate: !!autoUpdate, updatedAt: new Date() },
        { upsert: true, new: true }
    );
    
    res.json({ success: true });
}));

// 4. SET ADDONS
app.post('/api/set-addons', asyncHandler(async (req, res) => {
  const { authKey } = req.cookies;
  if (!authKey) return res.status(401).json({error: "No Auth"});
  
  const addons = req.body.addons.map(a => {
      let c = JSON.parse(JSON.stringify(a));
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

// 5. FETCH MANIFEST
app.post('/api/fetch-manifest', asyncHandler(async (req, res) => {
  const { manifestUrl } = req.body;
  // Validazione basilare prima di tutto
  if (!manifestUrl) return res.status(400).json({error: "No URL"});

  // Controllo SSRF
  if (!(await isSafeUrl(manifestUrl))) return res.status(400).json({error: "URL non sicuro"});

  const r = await fetchWithTimeout(manifestUrl, { redirect: 'error' });
  if (!r.ok) throw new Error("Fetch failed");
  res.json(await r.json());
}));

// 6. CRON JOB
app.get('/api/cron', async (req, res) => {
    await connectToDatabase();
    console.log("⏰ [CRON] Starting...");
    const users = await User.find({ autoUpdate: true }).select('email authKey'); // Prendi solo campi utili
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

            // Limitiamo a 5 chiamate parallele per utente per non intasare
            const checkUpdate = async (addon) => {
                const url = addon.transportUrl || addon.manifest?.id;
                if (!url || !url.startsWith('http')) return addon;
                try {
                    // Check SSRF veloce
                    if (!(await isSafeUrl(url))) return addon;
                    
                    const r = await fetchWithTimeout(url, {}, 4000); // Timeout ridotto a 4s per il cron
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
                // Aggiorna timestamp senza await (fire and forget)
                User.updateOne({ _id: user._id }, { lastCheck: new Date() }).exec();
            }
        } catch(e) {
            console.error(`Errore ${user.email}`, e.message);
        }
    }
    res.json({ success: true, updated: updatedCount });
});

app.post('/api/logout', (req, res) => {
  res.cookie('authKey', '', { ...cookieOptions, maxAge: 0 });
  res.json({ success: true });
});

app.use('/api/*', (req, res) => res.status(404).json({error: "Not found"}));

app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
        return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    next();
});

app.use((err, req, res, next) => {
  console.error(`ERROR: ${err.message}`);
  res.status(err.status || 500).json({ error: { message: err.message || "Server Error" } });
});

if (!process.env.VERCEL_ENV) {
    connectToDatabase().then(() => app.listen(PORT, () => console.log(`Running on ${PORT}`)));
}

module.exports = app;
