import { api } from './services/api.js';

export function useAddons(
    ref,
    nextTick,
    addons,
    
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
    const newAddonUrl = ref('');

    const retrieveAddonsFromServer = async (key, userEmail) => {
        if (isLoading.value) return false;
        isLoading.value = true;
        try {
           
            const data = await api.getAddons(key, userEmail);

            if (data.error) throw new Error(data.error?.message || data.error || 'Refresh failed.');

            const serverMap = new Map(data.addons.map(a => [a.transportUrl, a]));
            const merged = addons.value.map(local => {
                const server = serverMap.get(local.transportUrl);
                if (server) {
                    const updated = mapAddon(server);
                    updated.isEnabled = local.isEnabled;
                    updated.manifest.name = local.manifest.name;
                    updated.newLocalName = local.newLocalName;
                    updated.disableAutoUpdate = local.disableAutoUpdate;
                    serverMap.delete(local.transportUrl);
                    return updated;
                }
                local.isEnabled = false;
                return local;
            });

            serverMap.forEach(a => merged.push(mapAddon(a)));
            addons.value = merged;
            sessionStorage.setItem('stremioAddonList', JSON.stringify(merged));
            resetHistory();
            hasUnsavedChanges.value = false;
            return true;
        } catch (err) {
            showToast(t.value('list.refreshError', { message: err.message }), 'error');
            addons.value = [];
            return false;
        } finally {
            isLoading.value = false;
        }
    };

    const refreshAddonList = async () => {
        if (isLoading.value || isMonitoring.value) return;
        if (await retrieveAddonsFromServer(authKey.value, email.value)) {
            showToast(t.value('list.refreshSuccess'), 'success');
            hasUnsavedChanges.value = false;
        }
    };

    const saveOrder = async (isUpdating) => {
        if (isMonitoring.value) return;
        isLoading.value = true;
        showToast(t.value('addon.saving'), 'info', 5000);

        try {
            const enabled = addons.value.filter(a => a.isEnabled);
            const payload = enabled.map(({ isEditing, newLocalName, status, isEnabled, selected, errorDetails, isExpanded, ...rest }) => rest);
            
            // [MODIFICATO] Usa il servizio api
            const data = await api.setAddons(payload, email.value);

            if (data.error) throw new Error(data.error?.message || data.message || 'Errore sconosciuto.');

            showToast(t.value('addon.saveSuccess'), 'success');
            resetHistory();
            addons.value.forEach(a => a.selected = false);
            sessionStorage.setItem('stremioAddonList', JSON.stringify(addons.value));

            const idx = savedProfiles.value.findIndex(p => p.id === authKey.value);
            if (idx !== -1) {
                savedProfiles.value[idx].addons = payload;
                saveProfiles();
            }
        } catch (err) {
            showToast(t.value('addon.saveError', { message: err.message }), 'error');
        } finally {
            isLoading.value = false;
            isUpdating.value = false;
        }
    };

    const addNewAddon = async () => {
        if (isMonitoring.value) return;
        const url = newAddonUrl.value.trim();
        if (!url.startsWith('http')) return showToast("URL non valido.", 'error');

        isLoading.value = true;
        try {
            
            const manifest = await api.fetchManifest(url);

            if (manifest.error) throw new Error(manifest.error?.message || "Manifesto non valido.");

            const clean = { id: manifest.id || `external-${Date.now()}`, version: manifest.version || '1.0.0', name: manifest.name || `New Addon`, types: manifest.types || ["movie","series"], resources: manifest.resources || [], idPrefixes: manifest.idPrefixes || [], configurable: manifest.configurable, behaviorHints: manifest.behaviorHints, description: manifest.description || `URL: ${url}`, logo: manifest.logo || '', ...manifest };
            const baseUrl = url.split('?')[0];
            if (addons.value.some(a => a.transportUrl.split('?')[0] === baseUrl)) return showToast("Addon già esistente.", 'error');

            recordAction(t.value('actions.added', { name: clean.name }));
            addons.value.push(mapAddon({ transportUrl: url, manifest: clean, isEnabled: true }));
            await nextTick();
            document.querySelector('.main-content')?.scrollTo({ top: document.querySelector('.main-content').scrollHeight, behavior: 'smooth' });
            newAddonUrl.value = '';
            showToast(t.value('addon.addSuccess', { name: clean.name }), 'success');
            hasUnsavedChanges.value = true;
        } catch (err) {
            showToast(t.value('addon.addError', { message: err.message }), 'error');
        } finally {
            isLoading.value = false;
        }
    };

    const startEdit = addon => {
        if (!isMonitoring.value) {
            addon.newLocalName = addon.manifest.name;
            addon.newTransportUrl = addon.transportUrl;
            addon.isEditing = true;
        }
    };

    const finishEdit = async addon => {
        if (isMonitoring.value) { addon.isEditing = false; return; }
        const oldName = addon.manifest.name, newName = addon.newLocalName.trim();
        const oldUrl = addon.transportUrl, newUrl = addon.newTransportUrl.trim();
        const nameChanged = newName && newName !== oldName;
        const urlChanged = newUrl && newUrl !== oldUrl;
        if (!nameChanged && !urlChanged) { addon.isEditing = false; return; }

        if (urlChanged) {
            isLoading.value = true;
            try {
              
                const manifest = await api.fetchManifest(newUrl);

                if (manifest.error) throw new Error(manifest.error?.message || "Nuovo URL non valido.");
                
                addon.transportUrl = newUrl;
                addon.manifest = { ...manifest, name: newName };
                addon.status = 'ok';
                recordAction(t.value('addon.updateUrlSuccess', { name: oldName, newUrl }));
                showToast(t.value('addon.updateUrlSuccess', { name: oldName, newUrl }), 'success');
            } catch (err) {
                showToast(t.value('addon.updateUrlError', { message: err.message }), 'error');
            } finally {
                isLoading.value = false;
            }
        } else if (nameChanged) {
            recordAction(t.value('actions.renamed', { oldName, newName }));
            addon.manifest.name = newName;
            showToast(t.value('addon.renameSuccess'), 'info');
        }

        addon.isEditing = false;
    };

    const moveAddon = (addon, dir) => {
        if (isMonitoring.value) return;
        const idx = addons.value.indexOf(addon);
        if (idx === -1) return;
        const item = addons.value[idx];
        recordAction(t.value('actions.reordered'));
        switch(dir){
            case 'up': if(idx>0) [addons.value[idx-1], addons.value[idx]] = [item, addons.value[idx-1]]; break;
            case 'down': if(idx<addons.value.length-1) [addons.value[idx+1], addons.value[idx]] = [addons.value[idx], addons.value[idx+1]]; break;
            case 'top': if(idx>0){ addons.value.splice(idx,1); addons.value.unshift(item); } break;
            case 'bottom': if(idx<addons.value.length-1){ addons.value.splice(idx,1); addons.value.push(item); } break;
        }
        hasUnsavedChanges.value = true;
    };

    const moveUp = addon => moveAddon(addon,'up');
    const moveDown = addon => moveAddon(addon,'down');
    const moveTop = addon => moveAddon(addon,'top');
    const moveBottom = addon => moveAddon(addon,'bottom');

    const removeAddon = addon => {
        if (isMonitoring.value) return;
        if(!confirm(t.value('addon.removeConfirm',{name:addon.manifest.name}))) return;
        const idx = addons.value.findIndex(a=>a.transportUrl===addon.transportUrl);
        if(idx>-1){
            recordAction(t.value('actions.removed',{name:addons.value[idx].manifest.name}));
            addons.value.splice(idx,1);
            showToast(t.value('addon.removeSuccess'),'info');
            hasUnsavedChanges.value = true;
        }
    };

    const toggleAddonDisableAutoUpdate = addon => {
        if(isMonitoring.value) return;
        addon.disableAutoUpdate = !addon.disableAutoUpdate;
        recordAction(t.value(addon.disableAutoUpdate?'actions.excludedFromUpdate':'actions.includedInUpdate',{name:addon.manifest.name}));
    };

    const onDragEnd = () => { if(!isMonitoring.value) recordAction(t.value('actions.reordered')); };

    return {
        addons, newAddonUrl, retrieveAddonsFromServer, refreshAddonList, saveOrder, addNewAddon,
        startEdit, finishEdit, moveUp, moveDown, moveTop, moveBottom, removeAddon,
        toggleAddonDisableAutoUpdate, onDragEnd
    };
}
