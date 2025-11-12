// public/js/composables/useAddonActions.js

// 'ref' viene passato come argomento
export function useAddonActions(
    ref,
    apiBaseUrl,
    isLoggedIn,
    isMonitoring,
    isLoading,
    showToast,
    t,
    addons,
    saveOrder // saveOrder viene da useAddons, ma è passato dal setup principale
) {
    
    const isAutoUpdateEnabled = ref(false);
    const lastUpdateCheck = ref(null);
    const isUpdating = ref(false);

    const checkAllAddonsStatus = async () => {
        isLoading.value = true;
        showToast(t.value('addon.statusCheck'), 'info');
        let errorCountLocal = 0;
   
        await Promise.allSettled(addons.value.map(async (addon) => {
            addon.status = 'checking';
            addon.errorDetails = null;
            
            try {
                const response = await fetch(`${apiBaseUrl}/api/check-health`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ addonUrl: addon.transportUrl })
                });
                
                if (!response.ok) {
                    throw new Error(`Server error: ${response.statusText}`);
                }
                const data = await response.json();
                if (data.status === 'ok') {
                    addon.status = 'ok';
                } else {
                    throw new Error(data.details || 'Check failed');
                }
            } catch (err) {
                console.error(`Error checking ${addon.manifest.name}:`, err);
                addon.status = 'error';
                addon.errorDetails = err.message;
                errorCountLocal++;
            }
        }));

        showToast(t.value('addon.statusCheckComplete', { errorCount: errorCountLocal }), errorCountLocal > 0 ? 'error' : 'success');
        isLoading.value = false;
    };

    const fetchGithubInfo = async (addon) => {
        if (addon.githubInfo || addon.isLoadingGithub) return;

        const description = addon.manifest.description || '';
        const transportUrl = addon.transportUrl || '';
        
        const githubRepoRegex = /(https?:\/\/github\.com\/[\w-]+\/[\w-]+)/;
        const githubPagesRegex = /https?:\/\/([\w-]+)\.github\.io\/([\w-]+)/;
        let repoUrl = null;
        let match = null;

        match = description.match(githubRepoRegex);
        if (match) repoUrl = match[0];

        if (!repoUrl) {
            match = transportUrl.match(githubRepoRegex);
            if (match) repoUrl = match[0];
        }
        
        if (!repoUrl) {
            match = transportUrl.match(githubPagesRegex);
            if (match) repoUrl = `https://github.com/${match[1]}/${match[2]}`;
        }

        if (!repoUrl) {
            console.log(`Nessun URL GitHub trovato per ${addon.manifest.name}`);
            return;
        }
        
        addon.isLoadingGithub = true;
        try {
            const response = await fetch(`${apiBaseUrl}/api/github-info`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repoUrl: repoUrl })
            });
            if (!response.ok) throw new Error(`Impossibile caricare dati GitHub (status: ${response.status})`);
            const data = await response.json();
            if (data.info) {
                addon.githubInfo = data.info;
            } else if (data.error) {
                throw new Error(data.error);
            }
        } catch (err) {
            console.error("Errore fetchGithubInfo:", err.message);
            addon.githubInfo = { error: err.message }; 
        } finally {
            addon.isLoadingGithub = false;
        }
    };
    
    const toggleAddonDetails = (addon) => { 
        addon.isExpanded = !addon.isExpanded;
        if (addon.isExpanded) {
            fetchGithubInfo(addon);
        }
    };

    const testAddonSpeed = async (addon) => {
        if (isLoading.value) return; 
        showToast(t.value('addon.speedTestRunning', { name: addon.manifest.name }), 'info', 2000); 
        isLoading.value = true; 
        const startTime = performance.now();
        try {
            const controller = new AbortController(); 
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            await fetch(addon.transportUrl, { signal: controller.signal, mode: 'cors', cache: 'no-store' }); 
            clearTimeout(timeoutId);
            const endTime = performance.now(); 
            const duration = Math.round(endTime - startTime);
            showToast(t.value('addon.speedTestResult', { name: addon.manifest.name, time: duration }), 'success');
        } catch (err) { 
            showToast(t.value(err.name === 'AbortError' ? 'addon.speedTestTimeout' : 'addon.statusCheckError', { name: addon.manifest.name, message: err.message }), 'error'); 
        } finally { 
            isLoading.value = false; 
        }
    };
    
    const runAutoUpdate = async (isManual = false) => {
        if ((isLoading.value && !isUpdating.value) || isMonitoring.value || !isLoggedIn.value) { 
            if (isManual) showToast(isMonitoring.value ? t.value('addon.monitorModeActive') : "Operazione già in corso o non loggato.", 'error'); 
            return; 
        }
        isLoading.value = true; 
        isUpdating.value = true; 
        showToast(t.value('autoUpdate.running'), 'info');
        let updatedCount = 0; 
        let failedCount = 0; 
        let hasManifestChanges = false;
        
        const fetchAndUpdateAddon = async (addon) => {
            const transportUrl = addon.transportUrl || '';
            const addonName = addon.manifest?.name || 'Unknown';
            
            const isCinemeta = transportUrl.includes('cinemeta.strem.io');
            const isHttp = transportUrl.startsWith('http://') && !transportUrl.startsWith('https://');
            const isLocked = addon.disableAutoUpdate; 

            if (isLocked || isCinemeta || isHttp || !transportUrl) {
                // ... logica di skip
                return { status: 'fulfilled', id: addon.manifest.id, skipped: true };
            }

            try {
                const response = await fetch(`${apiBaseUrl}/api/fetch-manifest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manifestUrl: addon.transportUrl }) });
                const responseText = await response.text(); 
                let newManifest; 
                try { newManifest = JSON.parse(responseText); } catch (e) { throw new Error(`Invalid JSON response.`); }
                if (!response.ok || newManifest.error) throw new Error(newManifest.error?.message || "Failed to fetch");
                
                const getComparableManifest = (m) => { const { version, description, logo, types, resources, id, behaviorHints, configurable } = m; return JSON.stringify({ version, description, logo, types, resources, id, behaviorHints, configurable }); };
                const oldManifestComparable = getComparableManifest(addon.manifest);
                const newManifestComparable = getComparableManifest(newManifest);
                
                if (oldManifestComparable !== newManifestComparable) {
                    hasManifestChanges = true; 
                    updatedCount++;
                    const oldManifest = addon.manifest;
                    addon.manifest = { ...oldManifest, ...newManifest, name: oldManifest.name };
                    addon.newLocalName = oldManifest.name; 
                    return { status: 'fulfilled', id: addon.manifest.id };
                }
                return { status: 'fulfilled', id: addon.manifest.id, noChange: true };
            } catch (error) { 
                console.error(`Failed to update ${addonName}:`, error); 
                failedCount++; 
                return { status: 'rejected', id: addon.manifest.id, reason: error.message }; 
            }
        }; 

        const results = await Promise.allSettled(addons.value.map(fetchAndUpdateAddon));
        
        if (hasManifestChanges) { 
            showToast(t.value('autoUpdate.foundChanges', { count: updatedCount, failed: failedCount }), 'info'); 
            // hasUnsavedChanges è impostato nel setup principale
            await saveOrder(isUpdating); // Passa isUpdating a saveOrder
        } else { 
            showToast(t.value('autoUpdate.noChanges', { failed: failedCount }), failedCount > 0 ? 'error' : 'success'); 
            isLoading.value = false; 
            isUpdating.value = false; // Resetta qui se saveOrder non è chiamato
        }
        
        try { 
            localStorage.setItem('stremioLastAutoUpdate', new Date().toISOString()); 
            lastUpdateCheck.value = new Date().toISOString(); 
        } catch (e) { 
            console.warn("Cannot save last update time to localStorage.");
        }
        
        // isUpdating.value è resettato da saveOrder o qui sopra
    }; 

    const scheduleUpdateCheck = () => {
        const now = new Date(); 
        const nextUpdate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 3, 0, 0, 0);
        if (now.getTime() > nextUpdate.getTime()) { nextUpdate.setDate(nextUpdate.getDate() + 1); }
        const timeToNextUpdate = nextUpdate.getTime() - now.getTime(); 
        console.log(`Next auto-update check scheduled for: ${nextUpdate.toLocaleString()}`);
        
        setTimeout(async () => { 
            console.log("Running scheduled auto-update check..."); 
            if (isLoggedIn.value && isAutoUpdateEnabled.value && !isMonitoring.value) { 
                await runAutoUpdate(false); 
            } 
            scheduleUpdateCheck(); // Riprogramma
        }, timeToNextUpdate);
    };

    const openConfiguration = (addon) => { 
        const baseUrl = addon.transportUrl.replace(/\/manifest.json$/, ''); 
        window.open(`${baseUrl}/configure`, '_blank'); 
    };
    
    const copyManifestUrl = async (addon) => { 
        try { 
            await navigator.clipboard.writeText(addon.transportUrl); 
            showToast(t.value('addon.copyUrlSuccess'), 'success'); 
        } catch(e) { 
            showToast(t.value('addon.copyUrlError'), 'error'); 
        } 
    };

    // Inizializza le preferenze di auto-update
    const initAutoUpdate = () => {
         try {
            isAutoUpdateEnabled.value = localStorage.getItem('stremioAutoUpdateEnabled') === 'true';
            lastUpdateCheck.value = localStorage.getItem('stremioLastAutoUpdate');
        } catch (e) { 
            console.warn("Error reading auto-update settings from localStorage."); 
        }
        scheduleUpdateCheck();
    };

    return {
        isAutoUpdateEnabled,
        lastUpdateCheck,
        isUpdating,
        checkAllAddonsStatus,
        toggleAddonDetails,
        testAddonSpeed,
        runAutoUpdate,
        openConfiguration,
        copyManifestUrl,
        initAutoUpdate // Esponi la funzione di inizializzazione
    };
}
