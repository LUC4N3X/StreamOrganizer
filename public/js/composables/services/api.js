// [File: services/api.js]

const API_BASE_URL = window.location.origin;

/**
 * Un helper 'http' centralizzato per tutte le chiamate API.
 * Gestisce la logica di 'fetch', l'impostazione degli header,
 * la serializzazione del body e la gestione degli errori.
 */
async function http(endpoint, options = {}) {
    // Configura le opzioni di default
    const config = {
        method: 'POST', // La maggior parte delle tue API usa POST
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
    };

    // Serializza il body se è un oggetto
    if (config.body && typeof config.body === 'object') {
        config.body = JSON.stringify(config.body);
    }

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, config);
        const data = await response.json();

        // Se la risposta non è OK, estrae il messaggio d'errore e lancia
        if (!response.ok) {
            const errorMsg = data.error?.message || data.message || data.details || data.error || 'Errore API sconosciuto';
            throw new Error(errorMsg);
        }

        // Ritorna i dati in caso di successo
        return data;

    } catch (err) {
        // Se l'errore è già stato gestito (es. da !response.ok)
        if (err instanceof Error) {
            throw err;
        }
        // Altrimenti, è un errore di rete o di parsing JSON
        throw new Error(`Errore di rete o API: ${err.message}`);
    }
}

/**
 * Il nostro servizio API esporta funzioni pulite che
 * i composable possono importare e utilizzare.
 */
export const api = {
    // da useAuth.js
    login: (payload) => http('/api/login', { body: payload }),
    monitorLogin: (adminKey, targetEmail) => http('/api/admin/monitor', { body: { adminKey, targetEmail } }),

    // da useAddons.js
    getAddons: (authKey, email) => http('/api/get-addons', { body: { authKey, email } }),
    setAddons: (addonsPayload, email) => http('/api/set-addons', { body: { addons: addonsPayload, email } }),

    // da useAddonActions.js & useAddons.js
    fetchManifest: (manifestUrl) => http('/api/fetch-manifest', { body: { manifestUrl } }),
    checkHealth: (addonUrl) => http('/api/check-health', { body: { addonUrl } }),
    getGithubInfo: (repoUrl) => http('/api/github-info', { body: { repoUrl } }),
};
