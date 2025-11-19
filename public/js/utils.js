export const debounce = (fn, delay = 250) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => fn(...args), delay);
    };
};

/**
 * Trasforma un addon grezzo in un oggetto ricco e reattivo per il frontend.
 */
export const mapAddon = (addon = {}) => {
    const {
        manifest = {},
        transportUrl = '',
        isEnabled = true,
        disableAutoUpdate = false,
    } = addon;

    return {
        ...addon,
        isEditing: false,
        newLocalName: manifest.name || 'Unnamed Addon',
        newTransportUrl: transportUrl,
        status: 'unchecked',
        selected: false,
        errorDetails: null,
        isEnabled,
        isExpanded: false,
        disableAutoUpdate,
        githubInfo: null,
        isLoadingGithub: false,
        resourceNames: getResourceNames(manifest.resources)
    };
};

/**
 * Deep clone moderno con fallback.
 * Usa structuredClone se disponibile (molto più veloce).
 */
export const deepClone = (obj) => {
    if (globalThis.structuredClone) {
        try {
            return structuredClone(obj);
        } catch {
            // Alcuni oggetti non sono clonabili (es: function, DOM Node) o environment vecchi
        }
    }
    return JSON.parse(JSON.stringify(obj));
};

/**
 * Ritorna i nomi delle risorse di un addon in una stringa leggibile.
 */
export const getResourceNames = (resources) => {
    if (!Array.isArray(resources)) return 'N/A';
    if (resources.length === 0) return 'None';

    return resources
        .map(res => {
            if (typeof res === 'string') return res;
            if (res && typeof res === 'object' && 'name' in res) return res.name;
            return 'unknown';
        })
        .join(', ');
};

/**
 * Esegue una lista di operazioni asincrone in lotti (batch) per non sovraccaricare la rete.
 * Utile per checkStatus e autoUpdate quando si hanno molti addon.
 * * @param {Array} items - Array di elementi da processare
 * @param {number} batchSize - Numero massimo di operazioni parallele
 * @param {Function} fn - Funzione asincrona da eseguire per ogni item
 * @returns {Promise<Array>} - Risultati
 */
export const processInBatches = async (items, batchSize, fn) => {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        // Esegue il lotto in parallelo e attende che finiscano tutti
        const batchResults = await Promise.all(batch.map(item => fn(item)));
        results.push(...batchResults);
    }
    return results;
};
