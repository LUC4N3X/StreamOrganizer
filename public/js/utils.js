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
    isLoadingGithub: false
});

/**
 * Esegue una clonazione profonda di un oggetto serializzabile JSON
 */
export const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

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
