export function useAddons(
    ref,
    nextTick,
    addons,
    apiBaseUrl,
    authKey,
    email,
    isMonitoring,
    isLoading,
    recordAction,
    showToast,
    t,
    mapAddon,
    hasUnsavedChanges
) {

    // ================= CALLBACK ESTERNI =================
    let resetHistoryCallback = () => { console.error("setHistory non è stato chiamato per useAddons"); };
    let getSavedProfilesRefCallback = () => { console.error("setProfileFns non è stato chiamato"); return ref([]); };
    let saveProfilesCallback = () => { console.error("setProfileFns non è stato chiamato"); };

    const setHistory = (fn) => { resetHistoryCallback = fn; };
    const setProfileFns = (profilesRef, saveFn) => {
        getSavedProfilesRefCallback = () => profilesRef;
        saveProfilesCallback = saveFn;
    };

    // ================= HELPERS =================
    const withLoading = async (fn) => {
        isLoading.value = true;
        try { return await fn(); }
        finally { isLoading.value = false; }
    };

    // ================= FETCH E MERGE ADDONS =================
    const retrieveAddonsFromServer = async (key, userEmail) => 
        withLoading(async () => {
            try {
                const response = await fetch(`${apiBaseUrl}/api/get-addons`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ authKey: key, email: userEmail })
                });
                const data = await response.json();

                if (!response.ok || data.error) throw new Error(data.error?.message || 'Refresh failed.');

                // 1. Mappa server addons per URL (già mappati)
                const serverMap = new Map(data.addons.map(a => [a.transportUrl, mapAddon(a)]));
                const finalAddonsList = [];

                // 2. Itera sulla lista LOCALE per aggiornare e soft-delete
                addons.value.forEach(local => {
                    const serverVersion = serverMap.get(local.transportUrl);
                    if (serverVersion) {
                        // Addon esiste ancora sul server: aggiorna ma preserva stato locale
                        Object.assign(serverVersion, {
                            isEnabled: local.isEnabled,
                            disableAutoUpdate: local.disableAutoUpdate,
                            newLocalName: local.newLocalName,
                        });
                        // Preserva il nome locale personalizzato
                        serverVersion.manifest.name = local.manifest.name; 
                        
                        finalAddonsList.push(serverVersion);
                        serverMap.delete(local.transportUrl); // Rimuovi dalla mappa
                    } else {
                        // Addon non più sul server: "soft delete" (disabilita)
                        local.isEnabled = false;
                        finalAddonsList.push(local);
                    }
                });

                // 3. Aggiungi i nuovi addon rimasti nella mappa
                finalAddonsList.push(...serverMap.values());

                addons.value = finalAddonsList;
                sessionStorage.setItem('stremioAddonList', JSON.stringify(addons.value));

                resetHistoryCallback();
                hasUnsavedChanges.value = false;
                return true;
            } catch (err) {
                showToast(t.value('list.refreshError', { message: err.message }), 'error');
                addons.value = [];
                return false;
            }
        });

    const refreshAddonList = async () => {
        if (isLoading.value || isMonitoring.value) return;
        const success = await retrieveAddonsFromServer(authKey.value, email.value);
        if (success) showToast(t.value('list.refreshSuccess'), 'success');
    };

    // ================= SALVATAGGIO ORDINAMENTO =================
   
    const saveOrder = async () => {
        if (isMonitoring.value) return;

        const addonsToSave = addons.value
            .filter(a => a.isEnabled)
            .map(({ isEditing, newLocalName, status, isEnabled, selected, errorDetails, isExpanded, ...rest }) => rest);

        isLoading.value = true;
        showToast(t.value('addon.saving'), 'info', 5000);

        try {
            const response = await fetch(`${apiBaseUrl}/api/set-addons`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ addons: addonsToSave, email: email.value })
            });
            const data = await response.json();

            if (!response.ok || data.error) throw new Error(data.error?.message || data.message || 'Errore sconosciuto.');

            showToast(t.value('addon.saveSuccess'), 'success');
            resetHistoryCallback();
            hasUnsavedChanges.value = false; 

            addons.value.forEach(a => a.selected = false);
            sessionStorage.setItem('stremioAddonList', JSON.stringify(addons.value));

            // Gestione profili con callback
            const savedProfiles = getSavedProfilesRefCallback();
            const profileIndex = savedProfiles.value.findIndex(p => p.id === authKey.value);
            if (profileIndex !== -1) {
                savedProfiles.value[profileIndex].addons = addonsToSave;
                saveProfilesCallback();
            }

        } catch (err) {
            showToast(t.value('addon.saveError', { message: err.message }), 'error');
            // Non resettare hasUnsavedChanges qui, l'utente deve poter riprovare
        } finally {
            isLoading.value = false;
        }
    };

    // ================= AGGIUNTA NUOVO ADDON =================
    const newAddonUrl = ref('');
    const addNewAddon = async () => {
        if (isMonitoring.value) return;

        const url = newAddonUrl.value.trim();
        if (!url.startsWith('http')) { showToast("URL non valido.", 'error'); return; }

        try {
            
            await withLoading(async () => {
                const resp = await fetch(`${apiBaseUrl}/api/fetch-manifest`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ manifestUrl: url })
                });
                const manifest = await resp.json().catch(() => { throw new Error('Risposta JSON non valida.'); });

                if (!resp.ok || manifest.error) throw new Error(manifest.error?.message || 'Manifesto non valido.');

                // Valori di default
                const cleanManifest = {
                    id: `external-${Date.now()}`,
                    version: '1.0.0',
                    name: `New Addon`,
                    types: ["movie", "series"],
                    resources: [],
                    // Sovrascrivi i default con il manifesto reale
                    ...manifest 
                };
                
                // Pulisci l'URL per il controllo duplicati (ignora query params)
                const baseUrl = url.split('?')[0];
                if (addons.value.some(a => a.transportUrl.split('?')[0] === baseUrl)) {
                    showToast("Addon già esistente.", 'error'); 
                    return; 
                }

                recordAction(t.value('actions.added', { name: cleanManifest.name }));
                addons.value.push(mapAddon({ transportUrl: url, manifest: cleanManifest, isEnabled: true }));

                // Rimossa logica di scroll - deve essere gestita dal componente
                
                newAddonUrl.value = '';
                showToast(t.value('addon.addSuccess', { name: cleanManifest.name }), 'success');
                hasUnsavedChanges.value = true;
            });
        } catch (err) {
            // Gestisce gli errori lanciati da fetch, response.json() o !resp.ok
            showToast(err.message, 'error');
        }
    };

    // ================= EDITING =================
    const startEdit = (addon) => {
        if (!isMonitoring.value) {
            addon.newLocalName = addon.manifest.name;
            addon.newTransportUrl = addon.transportUrl;
            addon.isEditing = true;
        }
    };

    const finishEdit = async (addon) => {
        if (isMonitoring.value) { addon.isEditing = false; return; }

        const oldName = addon.manifest.name;
        const newName = addon.newLocalName.trim();
        const oldUrl = addon.transportUrl;
        const newUrl = addon.newTransportUrl.trim();

        const nameChanged = newName && newName !== oldName;
        const urlChanged = newUrl && newUrl !== oldUrl;

        if (!nameChanged && !urlChanged) { addon.isEditing = false; return; }

        try {
            if (urlChanged) {
                await withLoading(async () => {
                    const resp = await fetch(`${apiBaseUrl}/api/fetch-manifest`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ manifestUrl: newUrl })
                    });
                    const manifest = await resp.json().catch(() => { throw new Error('Risposta JSON non valida dal nuovo URL.'); });
                    if (!resp.ok || manifest.error) throw new Error(manifest.error?.message || 'Nuovo URL non valido.');

                    addon.transportUrl = newUrl;
                    addon.manifest = { ...manifest, name: newName }; 
                    addon.status = 'ok'; 

                    recordAction(t.value('addon.updateUrlSuccess', { name: oldName, newUrl }));
                    showToast(t.value('addon.updateUrlSuccess', { name: oldName, newUrl }), 'success');
                });
            } else if (nameChanged) {
                recordAction(t.value('actions.renamed', { oldName, newName }));
                addon.manifest.name = newName;
                showToast(t.value('addon.renameSuccess'), 'info');
            }

            
            addon.isEditing = false;
            hasUnsavedChanges.value = true; 

        } catch (err) {
         
            showToast(err.message, 'error');
        }
    };

    // ================= MOVE =================
    const moveAddon = (addon, dir) => {
        if (isMonitoring.value) return;
        recordAction(t.value('actions.reordered'));
        const i = addons.value.indexOf(addon);
        if (i === -1) return;
        const item = addons.value[i];

        if (dir === 'up' && i > 0) [addons.value[i], addons.value[i - 1]] = [addons.value[i - 1], addons.value[i]];
        else if (dir === 'down' && i < addons.value.length - 1) [addons.value[i], addons.value[i + 1]] = [addons.value[i + 1], addons.value[i]];
        else if (dir === 'top' && i > 0) { addons.value.splice(i, 1); addons.value.unshift(item); }
        else if (dir === 'bottom' && i < addons.value.length - 1) { addons.value.splice(i, 1); addons.value.push(item); }

        hasUnsavedChanges.value = true;
    };

    const moveUp = a => moveAddon(a, 'up');
    const moveDown = a => moveAddon(a, 'down');
    const moveTop = a => moveAddon(a, 'top');
    const moveBottom = a => moveAddon(a, 'bottom');

    // ================= REMOVE =================
    const removeAddon = (addon) => {
        if (isMonitoring.value) return;
        if (!confirm(t.value('addon.removeConfirm', { name: addon.manifest.name }))) return;

        const idx = addons.value.findIndex(a => a.transportUrl === addon.transportUrl);
        if (idx > -1) {
            const removedName = addons.value[idx].manifest.name;
            recordAction(t.value('actions.removed', { name: removedName }));
            addons.value.splice(idx, 1);
            showToast(t.value('addon.removeSuccess'), 'info');
            hasUnsavedChanges.value = true;
        }
    };

    const toggleAddonDisableAutoUpdate = (addon) => {
        if (isMonitoring.value) return;
        addon.disableAutoUpdate = !addon.disableAutoUpdate;
        recordAction(t.value(addon.disableAutoUpdate ? 'actions.excludedFromUpdate' : 'actions.includedInUpdate', { name: addon.manifest.name }));
        hasUnsavedChanges.value = true; 
    };

    const onDragEnd = () => {
        if (isMonitoring.value) return;
        recordAction(t.value('actions.reordered'));
        hasUnsavedChanges.value = true; 
    };

    // ================= RETURN =================
    return {
        addons, newAddonUrl, retrieveAddonsFromServer, refreshAddonList, saveOrder,
        addNewAddon, startEdit, finishEdit, moveUp, moveDown, moveTop, moveBottom,
        removeAddon, toggleAddonDisableAutoUpdate, onDragEnd,
        setHistory, setProfileFns
    };
}
