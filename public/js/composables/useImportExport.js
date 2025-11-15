// public/js/composables/useImportExport.js

// 'ref' viene passato come argomento
export function useImportExport(
    ref,
    addons,
    isMonitoring,
    recordAction,
    showToast,
    t,
    mapAddon,
    hasUnsavedChanges
) {

    // --- Refs ---
    const fileInput = ref(null);
    const shareInput = ref(null); // Mantenuto per il .select() (feedback UI)
    const shareUrl = ref(null);
    const importedConfigFromUrl = ref(null);
    const showImportConfirm = ref(false);
    const pendingImportData = ref(null);
    const importSource = ref('');
    const pendingImportNames = ref([]);

    // --- Export ---
    const exportBackup = () => {
        if (addons.value.length === 0) { showToast("No addons to export.", 'error'); return; }
        try {
            const addonsToExport = addons.value.map(({ selected, errorDetails, status, isEditing, newLocalName, isExpanded, ...rest }) => rest);
            const dataStr = JSON.stringify(addonsToExport, null, 2); 
            const dataBlob = new Blob([dataStr], {type: "application/json"}); 
            const url = URL.createObjectURL(dataBlob); 
            const link = document.createElement('a'); 
            link.download = `stremio-addons-backup-${new Date().toISOString().split('T')[0]}.json`; 
            link.href = url; 
            link.click(); 
            URL.revokeObjectURL(url);
            showToast(t.value('addon.exportSuccess'), 'success');
        } catch(e) { 
            showToast(t.value('addon.exportError', { message: e.message }), 'error'); 
        }
    };

    const exportTxt = () => {
        if (addons.value.length === 0) { showToast("No addons to export.", 'error'); return; }
        const txtContent = addons.value.map(a => `${a.manifest.name}: ${a.transportUrl}`).join('\n');
        const dataBlob = new Blob([txtContent], {type: "text/plain"}); 
        const url = URL.createObjectURL(dataBlob); 
        const link = document.createElement('a'); 
        link.download = `stremio-addons-list-${new Date().toISOString().split('T')[0]}.txt`; 
        link.href = url; 
        link.click(); 
        URL.revokeObjectURL(url);
        showToast(t.value('backup.exportTxtSuccess'), 'success');
    };

    // --- Import ---
    const triggerFileInput = () => { 
        if (!isMonitoring.value) fileInput.value.click(); 
    };

    const handleFileImport = (event) => {
        const file = event.target.files[0]; 
        if (!file || isMonitoring.value) return; 
        const reader = new FileReader();
        
        reader.onload = e => {
            try {
                const jsonString = e.target.result;
                const importedData = JSON.parse(jsonString);
                if (!Array.isArray(importedData)) throw new Error("Dati JSON non validi.");
                
                pendingImportData.value = importedData;
                pendingImportNames.value = importedData.map(a => a?.manifest?.name || 'Addon Sconosciuto');
                importSource.value = 'file';
                showImportConfirm.value = true;
            } catch(err) {
                showToast(t.value('import.error', { message: err.message }), 'error');
                pendingImportData.value = null;
                pendingImportNames.value = [];
            }
        };
        
        reader.readAsText(file); 
        event.target.value = null; // Ottimo!
    };
    
    const closeImportConfirm = () => { 
        showImportConfirm.value = false; 
        pendingImportData.value = null; 
        importSource.value = ''; 
        pendingImportNames.value = [];
    };

    const confirmImport = () => {
        try {
            let importedData = pendingImportData.value;
            if (!Array.isArray(importedData)) throw new Error("Invalid JSON data."); 
            if (importedData.length > 0 && (!importedData[0].manifest || !importedData[0].transportUrl)) throw new Error("Incorrect addon format.");
            
            recordAction(t.value('actions.imported', { count: importedData.length }));
            
            addons.value = importedData.map(mapAddon); 
            showToast(t.value(importSource.value === 'file' ? 'import.fileSuccess' : 'import.urlSuccess', { count: addons.value.length }), 'success'); 
            hasUnsavedChanges.value = true; 
            addons.value.forEach(a => a.selected = false);
        } catch(err) { 
            showToast(t.value('import.error', { message: err.message }), 'error'); 
        } finally { 
            closeImportConfirm(); 
        }
    };
    
    // --- Share ---
    const generateShareLink = () => {
        try {
            const addonsToShare = addons.value.map(({ selected, errorDetails, status, isEditing, newLocalName, isExpanded, ...rest }) => rest);
            const data = JSON.stringify(addonsToShare); 
            // Assicurati che LZString sia caricato globalmente
            const compressed = LZString.compressToEncodedURIComponent(data); 
            shareUrl.value = `${window.location.origin}${window.location.pathname}#config=${compressed}`;
            showToast(t.value('addon.shareGenerated'), 'info');
        } catch (err) { 
            showToast(t.value('addon.shareError', { message: err.message }), 'error'); 
        }
    };
    
    // *** MODIFICATO QUI ***
    const copyShareLink = async () => {
        if (!shareUrl.value) {
            showToast(t.value('addon.shareError', { message: 'No URL generated.' }), 'error');
            return;
        }
        
        try { 
            // 1. Usa l'API moderna (asincrona)
            await navigator.clipboard.writeText(shareUrl.value); 
            showToast(t.value('share.copySuccess'), 'success'); 
            
            // 2. (Opzionale) Fornisci feedback visivo selezionando il testo
            if (shareInput.value) {
                shareInput.value.select();
            }
        } catch (err) { 
            showToast(t.value('addon.copyUrlError'), 'error'); 
        }
    };
    
    // --- URL Import Check (da eseguire onMount) ---
    const checkUrlImport = () => {
        if (window.location.hash.startsWith('#config=')) { 
            const compressed = window.location.hash.substring(8); 
            try { 
                // Assicurati che LZString sia caricato globalmente
                const data = LZString.decompressFromEncodedURIComponent(compressed); 
                if (!data) throw new Error(t.value('import.urlErrorInvalid')); 
                const importedData = JSON.parse(data); 
                if (Array.isArray(importedData)) {
                    importedConfigFromUrl.value = importedData; 
                }
                window.location.hash = ''; 
            } catch (e) { 
                showToast(t.value('import.error', { message: e.message }), 'error'); 
                window.location.hash = ''; 
            }
        }
    };

    return {
        fileInput,
        shareInput,
        shareUrl,
        importedConfigFromUrl,
        showImportConfirm,
        pendingImportData,
        importSource,
        pendingImportNames,
        exportBackup,
        exportTxt,
        triggerFileInput,
        handleFileImport,
        closeImportConfirm,
        confirmImport,
        generateShareLink,
        copyShareLink,
        checkUrlImport
    };
}
