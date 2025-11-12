export function useImportExport(ref, addons, isMonitoring, recordAction, showToast, t, mapAddon, hasUnsavedChanges) {
    const fileInput = ref(null);
    const shareInput = ref(null);
    const shareUrl = ref(null);
    const importedConfigFromUrl = ref(null);
    const showImportConfirm = ref(false);
    const pendingImportData = ref(null);
    const importSource = ref('');
    const pendingImportNames = ref([]);

    // --- Export ---
    const exportBackup = () => {
        if (!addons.value.length) return showToast("No addons to export.", 'error');
        try {
            const dataStr = JSON.stringify(addons.value.map(a => {
                const { selected, errorDetails, status, isEditing, newLocalName, isExpanded, ...rest } = a; 
                return rest;
            }), null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = `stremio-addons-backup-${new Date().toISOString().split('T')[0]}.json`;
            link.href = url; link.click(); URL.revokeObjectURL(url);
            showToast(t.value('addon.exportSuccess'), 'success');
        } catch(e) { showToast(t.value('addon.exportError', { message: e.message }), 'error'); }
    };

    const exportTxt = () => {
        if (!addons.value.length) return showToast("No addons to export.", 'error');
        const txt = addons.value.map(a => `${a.manifest.name}: ${a.transportUrl}`).join('\n');
        const blob = new Blob([txt], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `stremio-addons-list-${new Date().toISOString().split('T')[0]}.txt`;
        link.href = url; link.click(); URL.revokeObjectURL(url);
        showToast(t.value('backup.exportTxtSuccess'), 'success');
    };

    // --- Import ---
    const triggerFileInput = () => { if (!isMonitoring.value) fileInput.value.click(); };
    const handleFileImport = e => {
        const file = e.target.files[0]; if (!file || isMonitoring.value) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const importedData = JSON.parse(ev.target.result);
                if (!Array.isArray(importedData)) throw new Error("Invalid JSON data.");
                pendingImportData.value = importedData;
                pendingImportNames.value = importedData.map(a => a?.manifest?.name || 'Addon Sconosciuto');
                importSource.value = 'file'; showImportConfirm.value = true;
            } catch(err) {
                showToast(t.value('import.error', { message: err.message }), 'error');
                pendingImportData.value = null; pendingImportNames.value = [];
            }
        };
        reader.readAsText(file); e.target.value = null;
    };
    const closeImportConfirm = () => { showImportConfirm.value = false; pendingImportData.value = null; importSource.value = ''; pendingImportNames.value = []; };
    const confirmImport = () => {
        try {
            const data = pendingImportData.value;
            if (!Array.isArray(data) || !data.length || !data[0].manifest || !data[0].transportUrl) throw new Error("Incorrect addon format.");
            recordAction(t.value('actions.imported', { count: data.length }));
            addons.value = data.map(mapAddon); hasUnsavedChanges.value = true; addons.value.forEach(a => a.selected = false);
            showToast(t.value(importSource.value === 'file' ? 'import.fileSuccess' : 'import.urlSuccess', { count: addons.value.length }), 'success');
        } catch(err) { showToast(t.value('import.error', { message: err.message }), 'error'); }
        finally { closeImportConfirm(); }
    };

    // --- Share ---
    const generateShareLink = () => {
        try {
            const data = JSON.stringify(addons.value.map(a => {
                const { selected, errorDetails, status, isEditing, newLocalName, isExpanded, ...rest } = a; return rest;
            }));
            const compressed = LZString.compressToEncodedURIComponent(data);
            shareUrl.value = `${window.location.origin}${window.location.pathname}#config=${compressed}`;
            showToast(t.value('addon.shareGenerated'), 'info');
        } catch(err) { showToast(t.value('addon.shareError', { message: err.message }), 'error'); }
    };
    const copyShareLink = () => {
        if (!shareInput.value) return;
        try { shareInput.value.select(); document.execCommand('copy'); showToast(t.value('share.copySuccess'), 'success'); }
        catch { showToast(t.value('addon.copyUrlError'), 'error'); }
    };

    // --- URL Import ---
    const checkUrlImport = () => {
        if (!window.location.hash.startsWith('#config=')) return;
        const compressed = window.location.hash.slice(8);
        try {
            const data = LZString.decompressFromEncodedURIComponent(compressed);
            if (!data) throw new Error(t.value('import.urlErrorInvalid'));
            const importedData = JSON.parse(data);
            if (Array.isArray(importedData)) importedConfigFromUrl.value = importedData;
            window.location.hash = '';
        } catch(e) { showToast(t.value('import.error', { message: e.message }), 'error'); window.location.hash = ''; }
    };

    return { fileInput, shareInput, shareUrl, importedConfigFromUrl, showImportConfirm, pendingImportData, importSource, pendingImportNames, exportBackup, exportTxt, triggerFileInput, handleFileImport, closeImportConfirm, confirmImport, generateShareLink, copyShareLink, checkUrlImport };
}
