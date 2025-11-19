// public/js/utils.js

/**
 * Funzione di utilità debounce per limitare la frequenza di esecuzione di una funzione
 */
export const debounce = (fn, delay) => {
    let timeoutId;
    return function(...args) {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
            fn.apply(this, args);
        }, delay);
    };
};

/**
 * Mappa un addon grezzo del server in un oggetto reattivo per il frontend
 */
export const mapAddon = (addon) => ({ 
    ...addon, 
    isEditing: false, 
    newLocalName: addon.manifest.name, 
    newTransportUrl: addon.transportUrl,
    status: 'unchecked', 
    selected: false, 
    errorDetails: null, 
    isEnabled: addon.isEnabled !== undefined ? addon.isEnabled : true, 
    isExpanded: false,
    disableAutoUpdate: addon.disableAutoUpdate !== undefined ? addon.disableAutoUpdate : false,
    githubInfo: null,
    isLoadingGithub: false,

    resourceNames: getResourceNames(addon.manifest.resources)
});

/**
 * Esegue una clonazione profonda di un oggetto.
 * Usa la moderna API 'structuredClone' se disponibile (più veloce e gestisce Date/Map/Set),
 * altrimenti usa il fallback JSON per compatibilità con vecchi WebView/Smart TV.
 */
export const deepClone = (obj) => {
    if (typeof structuredClone === 'function') {
        return structuredClone(obj);
    }
    return JSON.parse(JSON.stringify(obj));
};

/**
 * Ottiene una stringa formattata dei nomi delle risorse di un addon
 */
export const getResourceNames = (resources) => {
    if (!Array.isArray(resources)) return 'N/A'; 
    if (resources.length === 0) return 'None';
    return resources.map(res => { 
        if (typeof res === 'string') return res; 
        if (typeof res === 'object' && res.name) return res.name; 
        return 'unknown'; 
    }).join(', ');
};
