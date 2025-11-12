// public/js/composables/useAddons.js

// 'ref' e 'nextTick' vengono passati come argomenti
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
    hasUnsavedChanges,
    resetHistory,
    savedProfiles,
    saveProfiles
) {

    const retrieveAddonsFromServer = async (key, userEmail) => {
        isLoading.value = true;
        try {
            const response = await fetch(`${apiBaseUrl}/api/get-addons`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ authKey: key, email: userEmail })
            });
            const data = await response.json();
            
            // --- INIZIO BLOCCO MODIFICATO ---
            if (!response.ok || data.error) {
                 const errorMessage = data.error?.message || data.error || 'Refresh failed.';
                 throw new Error(errorMessage);
            }

            // 1. Mappa gli addon del server per un rapido accesso (URL -> addon)
            const serverAddonsMap = new Map();
            data.addons.forEach(serverAddon => {
                serverAddonsMap.set(serverAddon.transportUrl, serverAddon);
            });

            // 2. Combina le liste: usa la lista locale (addons.value) come base
            const newAddonsList = addons.value.map(localAddon => {
                const serverVersion = serverAddonsMap.get(localAddon.transportUrl);
                
                if (serverVersion) {
                    // L'addon esiste ancora sul server.
                    // Aggiorna il suo manifesto, ma mantieni le impostazioni locali.
                    const updatedAddon = mapAddon(serverVersion); // Prende il nuovo manifesto
                    updatedAddon.isEnabled = localAddon.isEnabled; // MANTIENE isEnabled locale
                    updatedAddon.manifest.name = localAddon.manifest.name; // MANTIENE il nome locale
                    updatedAddon.newLocalName = localAddon.newLocalName;
                    updatedAddon.disableAutoUpdate = localAddon.disableAutoUpdate; // MANTIENE il blocco update
                    
                    serverAddonsMap.delete(localAddon.transportUrl); // Rimuovilo dalla mappa
                    return updatedAddon;
                    
                } else {
                    // L'addon non è sul server (perché l'abbiamo disinstallato).
                    // MANTIENI la versione locale, ma forzala come disabilitata.
                    localAddon.isEnabled = false; 
                    return localAddon;
                }
            });

            // 3. Aggiungi eventuali NUOVI addon 
            // (addon che erano sul server ma non ancora nella nostra lista locale)
            serverAddonsMap.forEach(newServerAddon => {
                newAddonsList.push(mapAddon(newServerAddon));
            });

            addons.value = newAddonsList;
            sessionStorage.setItem('stremioAddonList', JSON.stringify(addons.value));
            // --- FINE BLOCCO MODIFICATO ---
            
            resetHistory(); // Resetta la cronologia dopo un refresh
            hasUnsavedChanges.value = false;

            return true;
        } catch (err) { 
            showToast(t.value('list.refreshError', { message: err.message }), 'error'); 
            addons.value = [];
            return false;
        }
        finally { isLoading.value = false; }
    };

    const refreshAddonList = async () => {
        if (isLoading.value || isMonitoring.value) return;
        const success = await retrieveAddonsFromServer(authKey.value, email.value);
        if (success) showToast(t.value('list.refreshSuccess'), 'success');
        hasUnsavedChanges.value = false;
    };

    // --- FUNZIONE MODIFICATA ---
    const saveOrder = async (isUpdating) => {
        if (isMonitoring.value) return; 
        
        const enabledAddons = addons.value.filter(a => a.isEnabled);
        const addonsToSave = enabledAddons.map(({ isEditing, newLocalName, status, isEnabled, selected, errorDetails, isExpanded, ...rest }) => rest);
        
        if (!isLoading.value) isLoading.value = true;
        showToast(t.value('addon.saving'), 'info', 5000);
        
        try {
            const response = await fetch(`${apiBaseUrl}/api/set-addons`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                // --- INIZIO BLOCCO CORRETTO ---
                // Abbiamo rimosso 'authKey' da qui. 
                // Il server la legge automaticamente dal cookie.
                body: JSON.stringify({ 
                    addons: addonsToSave, 
                    email: email.value 
                }) 
                // --- FINE BLOCCO CORRETTO ---
            });
            const data = await response.json(); 

            if (!response.ok || data.error) {
                // Estrai il messaggio di errore REALE prima di lanciarlo
                const errorMessage = data.error?.message || data.message || 'Errore sconosciuto durante il salvataggio.';
                throw new Error(errorMessage); 
            }
            
            showToast(t.value('addon.saveSuccess'), 'success'); 
            resetHistory(); // Pulisci la cronologia dopo un salvataggio riuscito
            
            addons.value.forEach(a => a.selected = false); 
            sessionStorage.setItem('stremioAddonList', JSON.stringify(addons.value));
            
            const profileIndex = savedProfiles.value.findIndex(p => p.id === authKey.value);
            if (profileIndex !== -1) {
                savedProfiles.value[profileIndex].addons = addonsToSave;
                saveProfiles(); // Salva i profili aggiornati
            }
        } catch (err) { 
            // Ora err.message conterrà la stringa di errore corretta
            showToast(t.value('addon.saveError', { message: err.message }), 'error'); 
        } finally { 
            isLoading.value = false; 
            isUpdating.value = false; // Assicurati di resettare isUpdating
        }
    };
    // --- FINE FUNZIONE MODIFICATA ---
    
    const newAddonUrl = ref('');
    const addNewAddon = async () => {
        if (isMonitoring.value) return; 
        const url = newAddonUrl.value.trim(); 
        if (!url.startsWith('http')) { showToast("URL non valido.", 'error'); return; } 
        isLoading.value = true;
        try {
            const response = await fetch(`${apiBaseUrl}/api/fetch-manifest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manifestUrl: url }) });
            const responseText = await response.text();
            let manifest;
            try { manifest = JSON.parse(responseText); } catch (e) { throw new Error(`Risposta JSON non valida.`); }
            if (!response.ok || manifest.error) throw new Error(manifest.error?.message || "Manifesto non valido.");
            
            const cleanManifest = { id: manifest.id || `external-${Date.now()}`, version: manifest.version || '1.0.0', name: manifest.name || `New Addon`, types: manifest.types || ["movie", "series"], resources: manifest.resources || [], idPrefixes: manifest.idPrefixes || [], configurable: manifest.configurable, behaviorHints: manifest.behaviorHints, description: manifest.description || `URL: ${url}`, logo: manifest.logo || '', ...manifest };
            const newAddonUrlBase = url.split('?')[0]; 
            
            if (addons.value.some(a => a.transportUrl.split('?')[0] === newAddonUrlBase)) { 
                showToast("Addon già esistente.", 'error'); 
                return; 
            }
            
            recordAction(t.value('actions.added', { name: cleanManifest.name })); 
            
            addons.value.push(mapAddon({ transportUrl: url, manifest: cleanManifest, isEnabled: true })); 
            await nextTick(); 
            const listElement = document.querySelector('.main-content'); 
            if (listElement) listElement.scrollTo({ top: listElement.scrollHeight, behavior: 'smooth' }); 
            newAddonUrl.value = ''; 
            showToast(t.value('addon.addSuccess', { name: cleanManifest.name }), 'success'); 
            hasUnsavedChanges.value = true;
        } catch (err) { 
            showToast(t.value('addon.addError', { message: err.message }), 'error'); 
        } finally { 
            isLoading.value = false; 
        }
    };

    const startEdit = (addon) => { 
        if (!isMonitoring.value) { 
            addon.newLocalName = addon.manifest.name; 
            addon.newTransportUrl = addon.transportUrl; 
            addon.isEditing = true; 
        } 
    };

    const finishEdit = async (addon) => {
        if (isMonitoring.value) {
            addon.isEditing = false;
            return;
        }

        const oldName = addon.manifest.name;
        const newName = addon.newLocalName.trim();
        const oldUrl = addon.transportUrl;
        const newUrl = addon.newTransportUrl.trim();

        const nameChanged = newName && newName !== oldName;
        const urlChanged = newUrl && newUrl !== oldUrl;

        if (!nameChanged && !urlChanged) {
            addon.isEditing = false;
            return;
        }

        if (urlChanged) {
            isLoading.value = true;
            try {
                const response = await fetch(`${apiBaseUrl}/api/fetch-manifest`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ manifestUrl: newUrl }) 
                });
                const responseText = await response.text();
                let newManifest;
                try { newManifest = JSON.parse(responseText); } catch (e) { throw new Error(`Risposta JSON non valida dal nuovo URL.`); }
                if (!response.ok || newManifest.error) throw new Error(newManifest.error?.message || "Nuovo URL non valido o irraggiungibile.");

                addon.transportUrl = newUrl;
                addon.manifest = { ...newManifest, name: newName }; 
                addon.status = 'ok';
                
                recordAction(t.value('addon.updateUrlSuccess', { name: oldName, newUrl: newUrl }));
                showToast(t.value('addon.updateUrlSuccess', { name: oldName, newUrl: newUrl }), 'success');
                
            } catch (err) {
                showToast(t.value('addon.updateUrlError', { message: err.message }), 'error');
                isLoading.value = false;
                return; 
            }
        
        } else if (nameChanged) {
            recordAction(t.value('actions.renamed', { oldName: oldName, newName: newName }));
            addon.manifest.name = newName;
            showToast(t.value('addon.renameSuccess'), 'info');
        }

        addon.isEditing = false;
        isLoading.value = false;
    };
    
    const moveAddon = (addon, logicDirection) => { 
        if (isMonitoring.value) return; 
        recordAction(t.value('actions.reordered')); 
        const index = addons.value.indexOf(addon); 
        if (index === -1) return; 
        const item = addons.value[index]; 
        if (logicDirection === 'up' && index > 0) [addons.value[index], addons.value[index - 1]] = [addons.value[index - 1], addons.value[index]]; 
        else if (logicDirection === 'down' && index < addons.value.length - 1) [addons.value[index], addons.value[index + 1]] = [addons.value[index + 1], addons.value[index]]; 
        else if (logicDirection === 'top' && index > 0) { addons.value.splice(index, 1); addons.value.unshift(item); } 
        else if (logicDirection === 'bottom' && index < addons.value.length - 1) { addons.value.splice(index, 1); addons.value.push(item); } 
        hasUnsavedChanges.value = true; 
    };
    
    const moveUp = (addon) => moveAddon(addon, 'up'); 
    const moveDown = (addon) => moveAddon(addon, 'down'); 
    const moveTop = (addon) => moveAddon(addon, 'top'); 
    const moveBottom = (addon) => moveAddon(addon, 'bottom');

    const removeAddon = (addon) => { 
        if (isMonitoring.value) return; 
        if(confirm(t.value('addon.removeConfirm', { name: addon.manifest.name }))) { 
            const index = addons.value.findIndex(a => a.transportUrl === addon.transportUrl); 
            if (index > -1) { 
                const removedAddonName = addons.value[index].manifest.name;
                recordAction(t.value('actions.removed', { name: removedAddonName })); 
                addons.value.splice(index, 1); 
                showToast(t.value('addon.removeSuccess'), 'info'); 
                hasUnsavedChanges.value = true; 
            }
        }
    };

    const toggleAddonDisableAutoUpdate = (addon) => {
        if (!isMonitoring.value) {
            addon.disableAutoUpdate = !addon.disableAutoUpdate; 
            recordAction(t.value(addon.disableAutoUpdate ? 'actions.excludedFromUpdate' : 'actions.includedInUpdate', { name: addon.manifest.name })); 
        }
    };
    
    const onDragEnd = (event) => { 
        if (!isMonitoring.value) {
            recordAction(t.value('actions.reordered'));
            // hasUnsavedChanges è gestito dal computed draggableList.set
        }
    };

    return {
        addons, // Esponi gli addons gestiti
        newAddonUrl,
        retrieveAddonsFromServer,
        refreshAddonList,
        saveOrder,
        addNewAddon,
        startEdit,
        finishEdit,
        moveUp,
        moveDown,
        moveTop,
        moveBottom,
        removeAddon,
        // toggleAddonEnabled, // Rimosso per ottimizzazione
        toggleAddonDisableAutoUpdate,
        onDragEnd
    };
}
