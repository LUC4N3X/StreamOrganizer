// public/js/composables/useAddonActions.js

// Importiamo la funzione di utilità per processare in lotti
import { processInBatches } from '../utils.js';

export function useAddonActions(
    ref,
    apiBaseUrl,
    isLoggedIn,
    isMonitoring,
    isLoading,
    showToast,
    t,
    addons,
    saveOrder 
) {
    
    const isAutoUpdateEnabled = ref(false);
    const lastUpdateCheck = ref(null);
    const isUpdating = ref(false);

    // --- 1. CHECK STATUS (BATCHED) ---
    const checkAllAddonsStatus = async () => {
        if (isLoading.value) return;
        isLoading.value = true;
        showToast(t.value('addon.statusCheck'), 'info');
        
        let errorCountLocal = 0;
    
        // Imposta lo stato iniziale di tutti gli addon
        addons.value.forEach(a => {
            a.status = 'checking';
            a.errorDetails = null;
        });

        // Funzione worker per un singolo addon
        const checkSingleAddon = async (addon) => {
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
        };

        try {
            // Esegue il check a gruppi di 5 alla volta per non sovraccaricare la rete
            await processInBatches(addons.value, 5, checkSingleAddon);
            showToast(t.value('addon.statusCheckComplete', { errorCount: errorCountLocal }), errorCountLocal > 0 ? 'error' : 'success');
        } catch (err) {
            console.error("Errore critico nel batch checking:", err);
            showToast("Errore critico durante la verifica", 'error');
        } finally {
            isLoading.value = false;
        }
    };

    // --- 2. GITHUB INFO ---
    const fetchGithubInfo = async (addon) => {
        if (addon.githubInfo || addon.isLoadingGithub) return;

        const description = addon.manifest.description || '';
        const transportUrl = addon.transportUrl || '';
        
        const githubRepoRegex = /(https?:\/\/github\.com\/[\w-]+\/[\w-]+)/;
        const githubPagesRegex = /https?:\/\/([\w-]+)\.github\.io\/([\w-]+)/;
        
        let repoUrl = null;
        let match;

        // Cerca URL GitHub
        match = description.match(githubRepoRegex) || transportUrl.match(githubRepoRegex);
        if (match) {
            repoUrl = match[0];
        } else {
            match = transportUrl.match(githubPagesRegex);
            if (match) {
                repoUrl = `https://github.com/${match[1]}/${match[2]}`;
            }
        }

        if (!repoUrl) return;
        
        addon.isLoadingGithub = true;
        try {
            const response = await fetch(`${apiBaseUrl}/api/github-info`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repoUrl: repoUrl })
            });
            if (!response.ok) throw new Error(`Status: ${response.status}`);
            const data = await response.json();
            if (data.info) {
                addon.githubInfo = data.info;
            } else if (data.error) {
                throw new Error(data.error);
            }
        } catch (err) {
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

    // --- 3. SPEED TEST ---
    const testAddonSpeed = async (addon) => {
        if (isLoading.value) return; 
        showToast(t.value('addon.speedTestRunning', { name: addon.manifest.name }), 'info', 2000); 
        isLoading.value = true; 
        const startTime = performance.now();
        try {
            const controller = new AbortController(); 
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            // Usa cache: no-store per test reale
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
    
    // --- 4. AUTO UPDATE (BATCHED) ---
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

        const getComparableManifest = (m) => {
            const { version, description, logo, types, resources, id, behaviorHints, configurable } = m;
            return JSON.stringify({ version, description, logo, types, resources, id, behaviorHints, configurable });
        };
        
        // Funzione worker per aggiornare singolo addon
        const fetchAndUpdateAddon = async (addon) => {
            const transportUrl = addon.transportUrl || '';
            const isCinemeta = transportUrl.includes('cinemeta.strem.io');
            const isHttp = transportUrl.startsWith('http://') && !transportUrl.startsWith('https://');
            const isLocked = addon.disableAutoUpdate; 

            // Skip conditions
            if (isLocked || isCinemeta || isHttp || !transportUrl) {
                return { status: 'skipped', id: addon.manifest.id };
            }

            try {
                const response = await fetch(`${apiBaseUrl}/api/fetch-manifest`, { 
                    method: 'POST', 
                    headers: { 'Content-Type': 'application/json' }, 
                    body: JSON.stringify({ manifestUrl: addon.transportUrl }) 
                });
                
                const responseText = await response.text(); 
                let newManifest; 
                try { newManifest = JSON.parse(responseText); } catch (e) { throw new Error(`Invalid JSON.`); }
                
                if (!response.ok || newManifest.error) throw new Error(newManifest.error?.message || "Fetch error");
                
                const oldManifestComparable = getComparableManifest(addon.manifest);
                const newManifestComparable = getComparableManifest(newManifest);
                
                if (oldManifestComparable !== newManifestComparable) {
                    hasManifestChanges = true; 
                    updatedCount++;
                    const oldManifest = addon.manifest;
                    // Aggiorna il manifesto mantenendo il nome locale
                    addon.manifest = { ...oldManifest, ...newManifest, name: oldManifest.name };
                    addon.newLocalName = oldManifest.name; 
                    return { status: 'updated', id: addon.manifest.id };
                }
                return { status: 'no-change', id: addon.manifest.id };
            } catch (error) { 
                console.error(`Update failed for ${addon.manifest.name}:`, error); 
                failedCount++; 
                return { status: 'failed', id: addon.manifest.id, reason: error.message }; 
            }
        }; 

        try {
            // Anche qui: BATCHING di 5 alla volta
            await processInBatches(addons.value, 5, fetchAndUpdateAddon);
            
            if (hasManifestChanges) { 
                showToast(t.value('autoUpdate.foundChanges', { count: updatedCount, failed: failedCount }), 'info'); 
                await saveOrder(); 
            } else { 
                showToast(t.value('autoUpdate.noChanges', { failed: failedCount }), failedCount > 0 ? 'error' : 'success'); 
            }
            
            try { 
                localStorage.setItem('stremioLastAutoUpdate', new Date().toISOString()); 
                lastUpdateCheck.value = new Date().toISOString(); 
            } catch (e) { console.warn("LocalStorage error"); }

        } catch (err) {
            console.error("AutoUpdate critical error:", err);
            showToast(t.value('autoUpdate.genericError', { message: err.message }), 'error');
        } finally {
            isLoading.value = false; 
            isUpdating.value = false;
        }
    }; 

    // --- 5. SCHEDULE & INIT ---
    const scheduleUpdateCheck = () => {
        const now = new Date(); 
        const nextUpdate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 3, 0, 0, 0);
        if (now.getTime() > nextUpdate.getTime()) { nextUpdate.setDate(nextUpdate.getDate() + 1); }
        
        const timeToNextUpdate = nextUpdate.getTime() - now.getTime(); 
        console.log(`Next auto-update check: ${nextUpdate.toLocaleString()}`);
        
        setTimeout(async () => { 
            if (isLoggedIn.value && isAutoUpdateEnabled.value && !isMonitoring.value) { 
                await runAutoUpdate(false); 
            } 
            scheduleUpdateCheck(); 
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

    const initAutoUpdate = () => {
        try {
            isAutoUpdateEnabled.value = localStorage.getItem('stremioAutoUpdateEnabled') === 'true';
            lastUpdateCheck.value = localStorage.getItem('stremioLastAutoUpdate');
        } catch (e) { console.warn("LocalStorage error"); }
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
        initAutoUpdate 
    };
}
