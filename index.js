const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 7860;

// --- Configurazione Chiave Segreta e Costanti ---

// Chiave segreta caricata da Hugging Face Secrets
const MONITOR_KEY_SECRET = process.env.MONITOR_KEY;

// Costanti globali API (Miglioramento 1: Centralizzazione)
const STREMIO_API_BASE = 'https://api.strem.io/api/';
const LOGIN_API_URL = `${STREMIO_API_BASE}login`;
const ADDONS_GET_URL = `${STREMIO_API_BASE}addonCollectionGet`;
const ADDONS_SET_URL = `${STREMIO_API_BASE}addonCollectionSet`;

// Timeout globale per le richieste di rete (Miglioramento 2: Robustezza)
const FETCH_TIMEOUT = 10000; // 10 secondi

// --- Configurazione Server ---
app.use(express.static('public'));
app.use(cors());
app.use(express.json());

// --- FUNZIONI HELPER ---

/**
 * (Miglioramento 2)
 * Esegue un fetch con un timeout.
 * Lancia un AbortError se la richiesta impiega più del tempo limite.
 */
async function fetchWithTimeout(url, options, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    if (err.name === 'AbortError') {
      throw new Error('Richiesta al server scaduta (timeout).');
    }
    throw err;
  }
}

/**
 * Recupera gli addon di un utente usando il suo AuthKey.
 * Centralizzato perché usato sia dal login con token che dal refresh.
 */
async function getAddonsByAuthKey(authKey) {
  if (!authKey) {
    throw new Error("AuthKey mancante.");
  }
  
  try {
    const addonsResponse = await fetchWithTimeout(ADDONS_GET_URL, { // Usa Timeout
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        "authKey": authKey
      })
    });

    const addonsData = await addonsResponse.json();

    if (addonsData.error || !addonsData.result) {
      let errorMsg = addonsData.error?.message || 'Impossibile recuperare gli addon.';
      if (errorMsg.includes('Invalid AuthKey') || (addonsData.error && addonsData.error.code === 1010)) {
          errorMsg = "AuthKey non valido o scaduto.";
      }
      throw new Error(errorMsg);
    }

    return addonsData.result.addons || [];

  } catch (err) {
    // Rilancia l'errore (incluso il timeout) per essere gestito dall'endpoint
    throw err;
  }
}

/**
 * Esegue il login tramite Email/Password e recupera gli addon.
 */
async function getStremioData(email, password) {
  if (!email || !password) {
    throw new Error("Email o Password mancanti.");
  }
  
  try {
    // 1. LOGIN
    const loginResponse = await fetchWithTimeout(LOGIN_API_URL, { // Usa Timeout
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        "email": email,
        "password": password
      })
    });

    const loginData = await loginResponse.json();
    if (loginData.error || !loginData.result || !loginData.result.authKey) {
      throw new Error(loginData.error ? loginData.error.message : 'Credenziali non valide o accesso negato da Stremio.');
    }

    const authKey = loginData.result.authKey;

    // 2. RECUPERO ADDONS
    const finalAddons = await getAddonsByAuthKey(authKey);
    
    return { addons: finalAddons, authKey: authKey };

  } catch (err) {
    // Rilancia l'errore (incluso il timeout)
    throw err;
  }
}

// ------------------------------------------
// ENDPOINT
// ------------------------------------------

/**
 * 1. ENDPOINT LOGIN (Email/Pass OPPURE Token)
 * (Miglioramento 3: Gestione errori coerente)
 */
app.post('/api/login', async (req, res) => {
  const { email, password, authKey: providedAuthKey } = req.body;

  try {
    // CASO 1: Login con Email/Password
    if (email && password) {
      const data = await getStremioData(email, password);
      return res.json(data);
    }

    // CASO 2: Login con AuthKey (Token)
    if (providedAuthKey) {
      const addons = await getAddonsByAuthKey(providedAuthKey);
      return res.json({ addons: addons, authKey: providedAuthKey });
    }

    // CASO 3: Dati mancanti
    return res.status(400).json({ error: { message: "Email/password o authKey sono obbligatori." } });

  } catch (err) {
    // (Miglioramento 3) Gestione centralizzata errori
    const status = err.message.includes('timeout') ? 504 : 401;
    return res.status(status).json({ error: { message: err.message } });
  }
});


/**
 * 2. ENDPOINT: RECUPERA ADDONS (per refresh)
 * (Miglioramento 3: Gestione errori coerente)
 */
app.post('/api/get-addons', async (req, res) => {
  const { authKey, email } = req.body;

  if (!authKey || !email) {
    return res.status(400).json({ error: { message: "authKey e email sono obbligatori." } });
  }

  try {
    const finalAddons = await getAddonsByAuthKey(authKey);
    res.json({ addons: finalAddons });

  } catch (err) {
    // (Miglioramento 3)
    const status = err.message.includes('timeout') ? 504 : 500;
    res.status(status).json({ error: { message: "Errore durante il recupero degli addon: " + err.message } });
  }
});

/**
 * 3. ENDPOINT ADMIN/MONITORAGGIO
 * (Miglioramento 3: Gestione errori coerente)
 */
app.post('/api/admin/monitor', async (req, res) => {
  const { adminKey, targetEmail } = req.body;

  if (!MONITOR_KEY_SECRET || adminKey !== MONITOR_KEY_SECRET) {
    return res.status(401).json({ error: { message: "Chiave di monitoraggio non corretta." } });
  }

  if (!targetEmail) {
    return res.status(400).json({ error: { message: "È necessaria l'email dell'utente da monitorare." } });
  }

  // Errore logico (non tecnico)
  return res.status(403).json({ error: { message: `Impossibile accedere ai dati di ${targetEmail}. Per motivi di sicurezza Stremio richiede la password/AuthKey.` } });
});

/**
 * 4. ENDPOINT DI SALVATAGGIO
 * (Miglioramento 3: Gestione errori coerente)
 */
app.post('/api/set-addons', async (req, res) => {
  try {
    const { authKey, addons, email } = req.body;

    if (!authKey || !addons) {
      // (Miglioramento 3)
      return res.status(400).json({ error: { message: "Chiave di autenticazione o lista addon mancante." } });
    }

    // Logica di pulizia (invariata, era corretta)
    const addonsToSave = addons.map(addon => {
        const cleanAddon = JSON.parse(JSON.stringify(addon));
        if (cleanAddon.isEditing) delete cleanAddon.isEditing;
        if (cleanAddon.newLocalName) delete cleanAddon.newLocalName;
        if (cleanAddon.manifest) {
            delete cleanAddon.manifest.newLocalName;
            delete cleanAddon.manifest.isEditing;
        }
        cleanAddon.manifest.name = addon.manifest.name;
        if (!cleanAddon.manifest.id) {
            cleanAddon.manifest.id = `external-${Math.random().toString(36).substring(2, 9)}`;
        }
        return cleanAddon;
    });

    const setResponse = await fetchWithTimeout(ADDONS_SET_URL, { // Usa Timeout
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        "authKey": authKey,
        "addons": addonsToSave
      })
    });

    const setData = await setResponse.json();

    if (setData.error) {
      throw new Error(setData.error.message || 'Errore Stremio durante il salvataggio degli addon.');
    }

    res.json({ success: true, message: "Addon salvati con successo." });

  } catch (err) {
    // (Miglioramento 3)
    const status = err.message.includes('timeout') ? 504 : 500;
    res.status(status).json({ error: { message: err.message } });
  }
});

/**
 * 5. ENDPOINT: RECUPERA MANIFESTO
 * (Miglioramento 3: Gestione errori coerente)
 */
app.post('/api/fetch-manifest', async (req, res) => {
  const { manifestUrl } = req.body;

  if (!manifestUrl || !manifestUrl.startsWith('http')) {
    return res.status(400).json({ error: { message: "URL manifesto non valido." } });
  }

  try {
    const manifestResponse = await fetchWithTimeout(manifestUrl); // Usa Timeout

    if (!manifestResponse.ok) {
      const errorText = await manifestResponse.text();
      if (errorText.trim().startsWith('<!DOCTYPE html>')) {
        throw new Error("Blocco di sicurezza: Il server ha restituito una pagina HTML anziché JSON.");
      }
      throw new Error(`Impossibile raggiungere il manifesto: Status ${manifestResponse.status}.`);
    }

    const manifest = await manifestResponse.json();
    if (!manifest.id || !manifest.version) {
      throw new Error("Manifesto non valido: mancano ID o Versione.");
    }

    res.json(manifest);
  } catch (err) {
    // (Miglioramento 3)
    const status = err.message.includes('timeout') ? 504 : 500;
    res.status(status).json({ error: { message: "Errore nel recupero del manifesto: " + err.message } });
  }
});


// --- AVVIO DEL SERVER ---
app.listen(PORT, () => {
  console.log(`Server avviato correttamente sulla porta ${PORT}`);
});
