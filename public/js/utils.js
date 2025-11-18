// utils.js

/**
 * DEBOUNCE
 * Ritarda l'esecuzione di una funzione. Fondamentale per la barra di ricerca
 * per evitare di filtrare a ogni singola lettera digitata.
 */
export function debounce(fn, delay = 300) {
    let timeoutId;
    return function(...args) {
        const context = this;
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            fn.apply(context, args);
        }, delay);
    };
}

/**
 * DEEP CLONE
 * Crea una copia profonda di un oggetto per evitare modifiche per riferimento.
 */
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    return JSON.parse(JSON.stringify(obj));
}

/**
 * GET RESOURCE NAMES
 * Estrae i nomi delle risorse dal manifest (che possono essere stringhe o oggetti).
 */
export function getResourceNames(resources) {
    if (!Array.isArray(resources)) return '';
    if (resources.length === 0) return '';
    
    return resources.map(res => {
        // Alcuni manifest hanno risorse come stringhe ("catalog"), altri come oggetti ({name: "catalog"})
        if (typeof res === 'string') return res;
        if (typeof res === 'object' && res.name) return res.name;
        return '';
    }).filter(Boolean).join(', ');
}

/**
 * MAP ADDON
 * Trasforma i dati grezzi dal server in un oggetto utilizzabile da Vue.js,
 * aggiungendo campi per lo stato dell'interfaccia (selezione, editing, ecc).
 */
export function mapAddon(addon) {
    if (!addon) return null;

    // Assicuriamoci che il manifest esista per evitare crash
    const manifest = addon.manifest || { name: 'Sconosciuto', version: '0.0.0', resources: [] };

    return {
        // Copia tutte le proprietà originali
        ...addon,

        // --- Proprietà Reattive per la UI (Frontend) ---
        
        // Per la modifica inline
        isEditing: false,
        newLocalName: manifest.name,
        newTransportUrl: addon.transportUrl || '',

        // Per la selezione e i filtri
        selected: false,
        isExpanded: false,
        
        // Stato salute/aggiornamento
        status: 'unchecked', // 'online', 'offline', 'unchecked'
        errorDetails: null,
        
        // Impostazioni utente (con fallback)
        isEnabled: addon.isEnabled !== false, // Default true se non specificato
        disableAutoUpdate: addon.disableAutoUpdate || false,

        // Helper per la visualizzazione
        resourceNames: getResourceNames(manifest.resources),
        
        // Dati GitHub (opzionali)
        githubInfo: null,
        isLoadingGithub: false
    };
}
