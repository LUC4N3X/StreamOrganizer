import { api } from './services/api.js';

export function useAddonActions(
    ref,
    
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

    const checkAllAddonsStatus = async () => {
        isLoading.value = true;
        showToast(t.value('addon.statusCheck'), 'info');
        let errorCount = 0;

        await Promise.all(addons.value.map(async addon => {
            addon.status = 'checking';
            addon.errorDetails = null;
            try {
                
                const data = await api.checkHealth(addon.transportUrl);
                
                if (data.status !== 'ok') {
                    throw new Error(data.details || 'Check failed');
                }
                addon.status = 'ok';

            } catch (err) {
                addon.status = 'error';
                addon.errorDetails = err.message;
                errorCount++;
            }
        }));

        showToast(t.value('addon.statusCheckComplete', { errorCount }), errorCount ? 'error' : 'success');
        isLoading.value = false;
    };

    const fetchGithubInfo = async (addon) => {
        if (addon.githubInfo || addon.isLoadingGithub) return;

        const githubRepo = addon.manifest.description?.match(/https?:\/\/github\.com\/[\w-]+\/[\w-]+/)?.[0]
                        || addon.transportUrl?.match(/https?:\/\/github\.com\/[\w-]+\/[\w-]+/)?.[0]
                        || addon.transportUrl?.match(/https?:\/\/([\w-]+)\.github\.io\/([\w-]+)/)?.slice(1).join('/');
        if (!githubRepo) return;

        addon.isLoadingGithub = true;
        try {
            
            const repoUrl = githubRepo.startsWith('http') ? githubRepo : `https://github.com/${githubRepo}`;
            const data = await api.getGithubInfo(repoUrl);

            addon.githubInfo = data.info || { error: data.error };
        } catch (err) {
            addon.githubInfo = { error: err.message };
        } finally {
            addon.isLoadingGithub = false;
        }
    };

    const toggleAddonDetails = addon => {
        addon.isExpanded = !addon.isExpanded;
        if (addon.isExpanded) fetchGithubInfo(addon);
    };

    // [NON MODIFICATO] Questo fetch testa un URL esterno, non la nostra API.
    const testAddonSpeed = async addon => {
        if (isLoading.value) return;
        showToast(t.value('addon.speedTestRunning', { name: addon.manifest.name }), 'info', 2000);
        isLoading.value = true;
        const start = performance.now();
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            await fetch(addon.transportUrl, { signal: controller.signal, mode: 'cors', cache: 'no-store' });
            clearTimeout(timeout);
            showToast(t.value('addon.speedTestResult', { name: addon.manifest.name, time: Math.round(performance.now() - start) }), 'success');
        } catch (err) {
            showToast(t.value(err.name === 'AbortError' ? 'addon.speedTestTimeout' : 'addon.statusCheckError', { name: addon.manifest.name, message: err.message }), 'error');
        } finally {
            isLoading.value = false;
        }
    };

    const runAutoUpdate = async (isManual = false) => {
        if ((isLoading.value && !isUpdating.value) || isMonitoring.value || !isLoggedIn.value) {
            if (isManual) showToast(isMonitoring.value ? t.value('addon.monitorModeActive') : "Operation in progress or not logged in.", 'error');
            return;
        }

        isLoading.value = true;
        isUpdating.value = true;
        showToast(t.value('autoUpdate.running'), 'info');

        let updatedCount = 0, failedCount = 0, hasChanges = false;

        const fetchAndUpdate = async addon => {
            const { transportUrl, manifest, disableAutoUpdate } = addon;
            if (disableAutoUpdate || !transportUrl || transportUrl.includes('cinemeta.strem.io') || transportUrl.startsWith('http://')) return { status: 'skipped', id: manifest.id };

            try {
                // [MODIFICATO] Usa il servizio api
                const newManifest = await api.fetchManifest(transportUrl);

                if (newManifest.error) throw new Error(newManifest.error?.message || "Failed to fetch");

                const cmp = m => JSON.stringify({ version: m.version, description: m.description, logo: m.logo, types: m.types, resources: m.resources, id: m.id, behaviorHints: m.behaviorHints, configurable: m.configurable });
                if (cmp(manifest) !== cmp(newManifest)) {
                    hasChanges = true;
                    updatedCount++;
                    addon.manifest = { ...manifest, ...newManifest, name: manifest.name };
                }
                return { status: 'ok', id: manifest.id };
            } catch (err) {
                failedCount++;
                return { status: 'failed', id: manifest.id, reason: err.message };
            }
        };

        await Promise.all(addons.value.map(fetchAndUpdate));

        if (hasChanges) {
            showToast(t.value('autoUpdate.foundChanges', { count: updatedCount, failed: failedCount }), 'info');
            await saveOrder(isUpdating);
        } else {
            showToast(t.value('autoUpdate.noChanges', { failed: failedCount }), failedCount ? 'error' : 'success');
            isLoading.value = false;
            isUpdating.value = false;
        }

        try { localStorage.setItem('stremioLastAutoUpdate', new Date().toISOString()); lastUpdateCheck.value = new Date().toISOString(); } catch {}
    };

    const scheduleUpdateCheck = () => {
        const now = new Date();
        const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 3, 0, 0);
        if (now > next) next.setDate(next.getDate() + 1);
        setTimeout(async () => {
            if (isLoggedIn.value && isAutoUpdateEnabled.value && !isMonitoring.value) await runAutoUpdate(false);
            scheduleUpdateCheck();
        }, next - now);
    };

    const openConfiguration = addon => window.open(addon.transportUrl.replace(/\/manifest.json$/, '') + '/configure', '_blank');

    const copyManifestUrl = async addon => {
        try { await navigator.clipboard.writeText(addon.transportUrl); showToast(t.value('addon.copyUrlSuccess'), 'success'); }
        catch { showToast(t.value('addon.copyUrlError'), 'error'); }
    };

    const initAutoUpdate = () => {
        try {
            isAutoUpdateEnabled.value = localStorage.getItem('stremioAutoUpdateEnabled') === 'true';
            lastUpdateCheck.value = localStorage.getItem('stremioLastAutoUpdate');
        } catch {}
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
