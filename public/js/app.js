// === FIX SCROLL MOBILE PER MODALE (Safari & Android) ===
document.addEventListener('touchmove', function(e) {
  const overlay = e.target.closest('.modal-overlay');
  if (overlay) {
    // Se l’utente sta scorrendo nella modale, permetti lo scroll
    return true;
  }
  // Se il tocco è fuori dalla modale, blocca per evitare che scorra lo sfondo
  if (document.body.classList.contains('modal-open')) {
    e.preventDefault();
  }
}, { passive: false });

const { createApp, ref, computed, onMounted, onBeforeUnmount, watch, nextTick } = Vue

    // NUOVO: Funzione di utilità debounce per limitare la frequenza di esecuzione di una funzione
    const debounce = (fn, delay) => {
        let timeoutId;
        return function(...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                fn.apply(this, args);
            }, delay);
        };
    };

    const app = createApp({
        setup() {
            // --- Refs ---
            const email = ref(''); const password = ref(''); const authKey = ref(null); const addons = ref([]);
            const isLoggedIn = ref(false); const isLoading = ref(false);
            const apiBaseUrl = window.location.origin; const newAddonUrl = ref(''); const fileInput = ref(null);
            const adminClickCount = ref(0); const showAdminInput = ref(false); const adminKey = ref(''); const targetEmail = ref('');
            const isMonitoring = ref(false);
            const searchQuery = ref(''); 
            const hasUnsavedChanges = ref(false); 
            const loginMode = ref('password'); // 'password' o 'token'
        const providedAuthKey = ref(''); // Per l'input del token
            // AGGIUNTO: Ref per il valore di ricerca con debounce
            const actualSearchQuery = ref('');
            const debouncedSearchHandler = debounce((newValue) => {
                actualSearchQuery.value = newValue;
            }, 300); // Esegui la ricerca solo dopo 300ms di pausa

            // MODIFICATO: Cronologia e Log delle Azioni
            const history = ref([]); 
            const redoStack = ref([]);
            const actionLog = ref([]);
            const redoActionLog = ref([]); 

            const activeFilter = ref('all');
            const lang = ref('it'); const toasts = ref([]); let toastIdCounter = 0;
            const importedConfigFromUrl = ref(null); const shareInput = ref(null); const shareUrl = ref(null);
            const showSearchInput = ref(false); const searchInputRef = ref(null); const showInstructions = ref(false);
            const showImportConfirm = ref(false); const pendingImportData = ref(null); const importSource = ref('');
            const isMobile = ref(window.innerWidth <= 960);
            const isAutoUpdateEnabled = ref(false);
            const lastUpdateCheck = ref(null);
            const isUpdating = ref(false);
            const showWelcomeScreen = ref(false);
            const isLightMode = ref(false);
            
            // --- Refs per Feature 1: Profili ---
            const savedProfiles = ref([]);
            const selectedProfileId = ref(null);

            // --- Refs per Tour ---
            const showWelcomeTourModal = ref(false);
            const dontShowWelcomeAgain = ref(false);

          // --- Functions ---
            const showToast = (message, type = 'success', duration = 3000) => { const id = toastIdCounter++; toasts.value.push({ id, message, type }); setTimeout(() => { toasts.value = toasts.value.filter(toast => toast.id !== id); }, duration); };
            const updateIsMobile = () => isMobile.value = window.innerWidth <= 960;
             const mapAddon = (addon) => ({ 
                ...addon, 
                isEditing: false, 
                newLocalName: addon.manifest.name, 
                newTransportUrl: addon.transportUrl,
				status: 'unchecked', 
                selected: false, 
                errorDetails: null, 
                isEnabled: addon.isEnabled !== undefined ? addon.isEnabled : true, 
                isExpanded: false,
                // NUOVO: Controllo disabilita auto-update
                disableAutoUpdate: addon.disableAutoUpdate !== undefined ? addon.disableAutoUpdate : false
            });
            const deepClone = (obj) => JSON.parse(JSON.stringify(obj));
            
            // MODIFICATO: Nuova funzione per registrare l'azione e lo stato
            const recordAction = (description) => {
                if (isLoading.value || isMonitoring.value) return; 
                
                // 1. Salva lo stato precedente in history
                history.value.push(deepClone(addons.value)); 
                // 2. Salva la descrizione dell'azione
                actionLog.value.push(description);
                
                // 3. Pulisci la cronologia rifare (redo)
                redoStack.value = []; 
                redoActionLog.value = [];
                
                // 4. Limita la dimensione della cronologia a 30 (mantenendo stato e log sincronizzati)
                if (history.value.length > 30) {
                    history.value.shift();
                    actionLog.value.shift();
                }
                
                hasUnsavedChanges.value = true; 
            };

            const undo = () => { 
                if (history.value.length === 0 || isMonitoring.value) return; 
                if (actionLog.value.length === 0) { console.error("History state and action log out of sync."); return; }

                // 1. Salva stato corrente in redo stack
                redoStack.value.push(deepClone(addons.value)); 
                // 2. Sposta l'ultima descrizione d'azione in redoActionLog
                const lastActionUndone = actionLog.value.pop();
                redoActionLog.value.push(lastActionUndone);
                
                // 3. Ritorna allo stato precedente
                addons.value = history.value.pop();
                
                // 4. Notifica l'azione annullata
                showToast(t.value('actions.undoPerformed', { action: lastActionUndone }), 'info');

                if (history.value.length === 0) hasUnsavedChanges.value = false; 
                addons.value.forEach(a => a.selected = false); 
            };
            
            const redo = () => { 
                if (redoStack.value.length === 0 || isMonitoring.value) return; 
                if (redoActionLog.value.length === 0) { console.error("Redo state and action log out of sync."); return; }

                // 1. Salva stato corrente in history
                history.value.push(deepClone(addons.value)); 
                // 2. Sposta la descrizione d'azione da redoActionLog a actionLog
                const lastActionRedone = redoActionLog.value.pop();
                actionLog.value.push(lastActionRedone);

                // 3. Riapplica lo stato
                addons.value = redoStack.value.pop(); 

                // 4. Notifica l'azione ripristinata
                showToast(t.value('actions.redoPerformed', { action: lastActionRedone }), 'info');

                hasUnsavedChanges.value = true; 
                addons.value.forEach(a => a.selected = false); 
            };
            // FINE MODIFICHE CRONOLOGIA

            const closeImportConfirm = () => { showImportConfirm.value = false; pendingImportData.value = null; importSource.value = ''; };
            const confirmImport = () => {
                try {
                    // MODIFICATO: chiama recordAction con descrizione
                    let importedData = importSource.value === 'file' ? JSON.parse(pendingImportData.value) : pendingImportData.value;
                    if (!Array.isArray(importedData)) throw new Error("Invalid JSON data."); if (importedData.length > 0 && (!importedData[0].manifest || !importedData[0].transportUrl)) throw new Error("Incorrect addon format.");
                    
                    recordAction(t.value('actions.imported', { count: importedData.length })); // Registra l'importazione
                    
                    addons.value = importedData.map(mapAddon); showToast(t.value(importSource.value === 'file' ? 'import.fileSuccess' : 'import.urlSuccess', { count: addons.value.length }), 'success'); hasUnsavedChanges.value = true; addons.value.forEach(a => a.selected = false);
                } catch(err) { showToast(t.value('import.error', { message: err.message }), 'error'); } finally { closeImportConfirm(); }
            };
            
            // --- Feature 1: Profile Management Logic ---
            const loadProfiles = () => {
                try {
                    const profilesJson = localStorage.getItem('stremioConsoleProfiles');
                    // Assicurati che i dati siano un array e abbiano il formato corretto.
                    let loadedProfiles = profilesJson ? JSON.parse(profilesJson) : [];
                    if (!Array.isArray(loadedProfiles)) loadedProfiles = [];
                    // Mappa i profili per aggiungere gli stati di modifica locali
                    savedProfiles.value = loadedProfiles.filter(p => p.id && p.email).map(p => ({
                        ...p,
                        isEditing: false,
                        newName: p.name || p.email
                    }));
                } catch (e) {
                    console.error("Error loading profiles:", e);
                    savedProfiles.value = [];
                }
            };

            const saveProfiles = () => {
                try {
                    // Salva solo i dati essenziali e puliti
                    const cleanProfiles = savedProfiles.value.map(p => ({
                        id: p.id,
                        name: p.name, 
                        email: p.email,
                        authKey: p.authKey,
                        isMonitoring: p.isMonitoring
                    }));
                    localStorage.setItem('stremioConsoleProfiles', JSON.stringify(cleanProfiles));
                } catch (e) {
                    console.error("Error saving profiles:", e);
                    showToast("Impossibile salvare i profili in locale.", 'error');
                }
            };

            const saveProfile = (newProfileName = null) => {
                if (!isLoggedIn.value || isMonitoring.value) return;

                const profileId = authKey.value;
                const profileEmail = email.value;
                const existingIndex = savedProfiles.value.findIndex(p => p.id === profileId);

                // Usa sempre l'email come nome di default se non specificato
                let profileName = newProfileName || profileEmail;
                // Assicurati che non sia vuoto
                if (!profileName) profileName = `User ${Date.now()}`;

                if (existingIndex !== -1) {
                    // Aggiorna un profilo esistente
                    savedProfiles.value[existingIndex].name = profileName;
                    savedProfiles.value[existingIndex].email = profileEmail;
                    savedProfiles.value[existingIndex].authKey = authKey.value;
                    savedProfiles.value[existingIndex].isMonitoring = isMonitoring.value;
                    savedProfiles.value[existingIndex].newName = profileName; // Aggiorna anche newName
                } else {
                    // Aggiungi nuovo profilo
                    savedProfiles.value.push({
                        id: profileId,
                        name: profileName,
                        email: profileEmail, 
                        authKey: authKey.value,
                        isMonitoring: isMonitoring.value,
                        isEditing: false, // Nuovo campo per l'editing
                        newName: profileName
                    });
                }
                saveProfiles();
                showToast(t.value('profiles.saveSuccess'), 'success');
            };

            const startEditProfile = (profile) => {
                // Assicurati che tutti gli altri profili siano in stato non editing
                savedProfiles.value.forEach(p => {
                    if (p.id !== profile.id && p.isEditing) {
                        p.isEditing = false;
                    }
                });
                profile.newName = profile.name || profile.email;
                profile.isEditing = true;
                nextTick(() => {
                    // Metti a fuoco l'input
                    const input = document.querySelector(`.profile-list-item[data-profile-id="${profile.id}"] .profile-name-edit-input`);
                    if (input) {
                        input.focus();
                        input.select();
                    }
                });
            };

            const finishEditProfile = (profile) => {
                const newName = profile.newName.trim();
                if (newName && newName !== profile.name) {
                    profile.name = newName;
                    saveProfiles(); // Salva la modifica immediatamente (non necessita di Save principale)
                    showToast(t.value('profiles.renameSuccess'), 'success');
                }
                profile.isEditing = false;
            };


            const loadProfile = (profileId) => {
                const profile = savedProfiles.value.find(p => p.id === profileId);
                if (!profile) return;

                // Clear current session data (except theme/lang)
                sessionStorage.clear();
                
                // Set Vue refs and Session Storage
                authKey.value = profile.authKey;
                email.value = profile.email;
                isMonitoring.value = profile.isMonitoring;
                isLoggedIn.value = true;
                
                sessionStorage.setItem('stremioAuthKey', profile.authKey);
                sessionStorage.setItem('stremioEmail', profile.email);
                sessionStorage.setItem('stremioIsMonitoring', profile.isMonitoring ? 'true' : 'false');
                
                // Ricarica la lista degli addon dal server per la nuova chiave
                retrieveAddonsFromServer(profile.authKey, profile.email);

                showToast(t.value('addon.sessionRestored'), 'success');
            };

            const deleteProfile = (profileId) => {
                const profileIndex = savedProfiles.value.findIndex(p => p.id === profileId);
                if (profileIndex === -1) return;

                // Usa il nome salvato o l'email come fallback per il confirm dialog
                const profileName = savedProfiles.value[profileIndex].name || savedProfiles.value[profileIndex].email;

                // Utilizzo di confirm() come stabilito nel codice base per azioni distruttive
                if (confirm(t.value('profiles.deleteConfirm', { name: profileName }))) {
                    savedProfiles.value.splice(profileIndex, 1);
                    saveProfiles();
                    showToast(t.value('profiles.deleteSuccess', { name: profileName }), 'info');
                    // Se il profilo eliminato era quello corrente, effettua il logout della sessione
                    if (profileId === authKey.value) {
                        logout();
                    }
                }
            };
            // --- End Feature 1 Logic ---

            const monitorLogin = async () => {
                isLoading.value = true; isMonitoring.value = false;
                try {
                    const response = await fetch(`${apiBaseUrl}/api/admin/monitor`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminKey: adminKey.value, targetEmail: targetEmail.value }) });
                    if (!response.ok) throw new Error((await response.json()).error.message || 'Access Denied.');
                    const data = await response.json();
                    authKey.value = data.authKey; isLoggedIn.value = true; isMonitoring.value = true; email.value = targetEmail.value;
                    showToast(t.value('addon.monitorSuccess', { email: targetEmail.value }), 'info');
                    sessionStorage.setItem('stremioAuthKey', authKey.value); sessionStorage.setItem('stremioEmail', email.value); sessionStorage.setItem('stremioIsMonitoring', 'true'); sessionStorage.setItem('stremioAddonList', JSON.stringify(data.addons.map(mapAddon)));
                    addons.value = data.addons.map(mapAddon);
                    showWelcomeScreen.value = true;
                    // RIMOSSO: saveProfile(targetEmail.value); // Rimosso il salvataggio automatico

                } catch (err) { showToast(t.value('addon.monitorError', { message: err.message }), 'error'); } finally { isLoading.value = false; }
            };
            const exportBackup = () => {
                if (addons.value.length === 0) { showToast("No addons to export.", 'error'); return; }
                try {
                    const addonsToExport = addons.value.map(({ selected, errorDetails, status, isEditing, newLocalName, isExpanded, ...rest }) => rest);
                    const dataStr = JSON.stringify(addonsToExport, null, 2); const dataBlob = new Blob([dataStr], {type: "application/json"}); const url = URL.createObjectURL(dataBlob); const link = document.createElement('a'); link.download = `stremio-addons-backup-${new Date().toISOString().split('T')[0]}.json`; link.href = url; link.click(); URL.revokeObjectURL(url);
                    showToast(t.value('addon.exportSuccess'), 'success');
                } catch(e) { showToast(t.value('addon.exportError', { message: e.message }), 'error'); }
            };
            const exportTxt = () => {
                if (addons.value.length === 0) { showToast("No addons to export.", 'error'); return; }
                const txtContent = addons.value.map(a => `${a.manifest.name}: ${a.transportUrl}`).join('\n');
                const dataBlob = new Blob([txtContent], {type: "text/plain"}); const url = URL.createObjectURL(dataBlob); const link = document.createElement('a'); link.download = `stremio-addons-list-${new Date().toISOString().split('T')[0]}.txt`; link.href = url; link.click(); URL.revokeObjectURL(url);
                showToast(t.value('backup.exportTxtSuccess'), 'success');
            };
            const triggerFileInput = () => { if (!isMonitoring.value) fileInput.value.click(); };
            const handleFileImport = (event) => {
                const file = event.target.files[0]; if (!file || isMonitoring.value) return; const reader = new FileReader();
                reader.onload = e => { pendingImportData.value = e.target.result; importSource.value = 'file'; showImportConfirm.value = true; };
                reader.readAsText(file); event.target.value = null;
            };
            const generateShareLink = () => {
                try {
                    const addonsToShare = addons.value.map(({ selected, errorDetails, status, isEditing, newLocalName, isExpanded, ...rest }) => rest);
                    const data = JSON.stringify(addonsToShare); const compressed = LZString.compressToEncodedURIComponent(data);
                    shareUrl.value = `${window.location.origin}${window.location.pathname}#config=${compressed}`;
                    showToast(t.value('addon.shareGenerated'), 'info');
                } catch (err) { showToast(t.value('addon.shareError', { message: err.message }), 'error'); }
            };
            const copyShareLink = () => {
                if (!shareInput.value) return; try { shareInput.value.select(); document.execCommand('copy'); showToast(t.value('share.copySuccess'), 'success'); } catch (err) { showToast(t.value('addon.copyUrlError'), 'error'); }
            };
            const checkAllAddonsStatus = async () => {
                isLoading.value = true; showToast(t.value('addon.statusCheck'), 'info'); let errorCountLocal = 0;
                await Promise.allSettled(addons.value.map(async (addon) => {
                    addon.status = 'checking'; addon.errorDetails = null;
                    try { const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 5000); const response = await fetch(addon.transportUrl, { signal: controller.signal, mode: 'cors' }); clearTimeout(timeoutId); if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText || 'Server Error'}`); addon.status = 'ok'; }
                    catch (err) { console.error(`Error ${addon.manifest.name}:`, err); addon.status = 'error'; addon.errorDetails = err.name === 'AbortError' ? 'Timeout (5s)' : err.message; errorCountLocal++; throw err; }
                }));
                showToast(t.value('addon.statusCheckComplete', { errorCount: errorCountLocal }), errorCountLocal > 0 ? 'error' : 'success'); isLoading.value = false;
            };
             const toggleAddonDetails = (addon) => { addon.isExpanded = !addon.isExpanded; };
             const getResourceNames = (resources) => {
                 if (!Array.isArray(resources)) return 'N/A'; if (resources.length === 0) return 'None';
                 return resources.map(res => { if (typeof res === 'string') return res; if (typeof res === 'object' && res.name) return res.name; return 'unknown'; }).join(', ');
             };
            const testAddonSpeed = async (addon) => {
                if (isLoading.value) return; showToast(t.value('addon.speedTestRunning', { name: addon.manifest.name }), 'info', 2000); isLoading.value = true; const startTime = performance.now();
                try {
                    const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), 8000);
                    await fetch(addon.transportUrl, { signal: controller.signal, mode: 'cors', cache: 'no-store' }); clearTimeout(timeoutId);
                    const endTime = performance.now(); const duration = Math.round(endTime - startTime);
                    showToast(t.value('addon.speedTestResult', { name: addon.manifest.name, time: duration }), 'success');
                } catch (err) { showToast(t.value(err.name === 'AbortError' ? 'addon.speedTestTimeout' : 'addon.statusCheckError', { name: addon.manifest.name, message: err.message }), 'error'); } finally { isLoading.value = false; }
            };
            const runAutoUpdate = async (isManual = false) => {
                if ((isLoading.value && !isUpdating.value) || isMonitoring.value || !isLoggedIn.value) { if (isManual) showToast(isMonitoring.value ? t.value('addon.monitorModeActive') : "Operazione già in corso o non loggato.", 'error'); return; }
                isLoading.value = true; isUpdating.value = true; showToast(t.value('autoUpdate.running'), 'info');
                let updatedCount = 0; let failedCount = 0; let hasManifestChanges = false;
               const fetchAndUpdateAddon = async (addon) => {
                const transportUrl = addon.transportUrl || '';
                const addonName = addon.manifest?.name || 'Unknown';
                
                // --- LOGICA DI SKIP ---
                const isCinemeta = transportUrl.includes('cinemeta.strem.io');
                const isHttp = transportUrl.startsWith('http://') && !transportUrl.startsWith('https://');
                const isLocked = addon.disableAutoUpdate; // La tua logica esistente

                if (isLocked || isCinemeta || isHttp || !transportUrl) {
                    let reason = 'URL non valido';
                    if (isLocked) reason = 'Bloccato (disableAutoUpdate)';
                    if (isCinemeta) reason = 'Cinemeta (ignorare)';
                    if (isHttp) reason = 'URL HTTP (insicuro)';
                    
                    console.log(`Skipping auto-update for: ${addonName} (${reason})`);
                    return { status: 'fulfilled', id: addon.manifest.id, skipped: true };
                }
                // --- FINE LOGICA SKIP ---

                // Il resto della tua funzione rimane invariato
                try {
                    const response = await fetch(`${apiBaseUrl}/api/fetch-manifest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manifestUrl: addon.transportUrl }) });
                    const responseText = await response.text(); let newManifest; try { newManifest = JSON.parse(responseText); } catch (e) { throw new Error(`Invalid JSON response.`); }
                    if (!response.ok || newManifest.error) throw new Error(newManifest.error?.message || "Failed to fetch");
                    
                    const getComparableManifest = (m) => { const { version, description, logo, types, resources, id, behaviorHints, configurable } = m; return JSON.stringify({ version, description, logo, types, resources, id, behaviorHints, configurable }); };
                    const oldManifestComparable = getComparableManifest(addon.manifest);
                    const newManifestComparable = getComparableManifest(newManifest);
                    
                 if (oldManifestComparable !== newManifestComparable) {
    hasManifestChanges = true; updatedCount++;

    // Conserva un riferimento al vecchio manifesto 
    const oldManifest = addon.manifest;

    // FARE IL MERGE
    addon.manifest = { 
        ...oldManifest,   
        ...newManifest,    
        name: oldManifest.name 
    };

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

            // Il resto della funzione runAutoUpdate 
            const results = await Promise.allSettled(addons.value.map(fetchAndUpdateAddon));
            
            if (hasManifestChanges) { 
                showToast(t.value('autoUpdate.foundChanges', { count: updatedCount, failed: failedCount }), 'info'); 
                hasUnsavedChanges.value = true; 
                await saveOrder(); // saveOrder gestirà isLoading.value = false
            } else { 
                showToast(t.value('autoUpdate.noChanges', { failed: failedCount }), failedCount > 0 ? 'error' : 'success'); 
                isLoading.value = false; // Dobbiamo impostarlo qui se saveOrder non viene chiamato
            }
            
            try { 
                localStorage.setItem('stremioLastAutoUpdate', new Date().toISOString()); 
                lastUpdateCheck.value = new Date().toISOString(); 
            } catch (e) { 
                console.warn("Cannot save last update time to localStorage."); 
            }
            
            isUpdating.value = false;
        }; 

        // 
        const scheduleUpdateCheck = () => {
            const now = new Date(); const nextUpdate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 3, 0, 0, 0);
            if (now.getTime() > nextUpdate.getTime()) { nextUpdate.setDate(nextUpdate.getDate() + 1); }
            const timeToNextUpdate = nextUpdate.getTime() - now.getTime(); console.log(`Next auto-update check scheduled for: ${nextUpdate.toLocaleString()}`);
            setTimeout(async () => { console.log("Running scheduled auto-update check..."); if (isLoggedIn.value && isAutoUpdateEnabled.value && !isMonitoring.value) { await runAutoUpdate(false); } scheduleUpdateCheck(); }, timeToNextUpdate);
        };
        
        const toggleAddonEnabled = (addon) => { 
            if (!isMonitoring.value) {
                // MODIFICATO: Chiama recordAction con la descrizione dell'azione
                recordAction(t.value(addon.isEnabled ? 'actions.disabledAddon' : 'actions.enabledAddon', { name: addon.manifest.name })); 
            }
        };
            // NUOVO: Toggle per disabilitare l'auto-update
            const toggleAddonDisableAutoUpdate = (addon) => {
                 if (!isMonitoring.value) {
                    addon.disableAutoUpdate = !addon.disableAutoUpdate; 
                    
                    recordAction(t.value(addon.disableAutoUpdate ? 'actions.excludedFromUpdate' : 'actions.includedInUpdate', { name: addon.manifest.name })); 
                 }
            };
            // FINE NUOVO

            const openConfiguration = (addon) => { const baseUrl = addon.transportUrl.replace(/\/manifest.json$/, ''); window.open(`${baseUrl}/configure`, '_blank'); };
            const copyManifestUrl = async (addon) => { try { await navigator.clipboard.writeText(addon.transportUrl); showToast(t.value('addon.copyUrlSuccess'), 'success'); } catch(e) { showToast(t.value('addon.copyUrlError'), 'error'); } };
            const startEdit = (addon) => { 
                if (!isMonitoring.value) { 
                    addon.newLocalName = addon.manifest.name; 
                    addon.newTransportUrl = addon.transportUrl; // <-- AGGIUNGI QUESTA
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

                // Se non è cambiato nulla, chiudi e basta
                if (!nameChanged && !urlChanged) {
                    addon.isEditing = false;
                    return;
                }

                // Se l'URL è cambiato, dobbiamo validarlo
                if (urlChanged) {
                    isLoading.value = true;
                    try {
                        // 1. Controlla se il nuovo URL è valido
                        const response = await fetch(`${apiBaseUrl}/api/fetch-manifest`, { 
                            method: 'POST', 
                            headers: { 'Content-Type': 'application/json' }, 
                            body: JSON.stringify({ manifestUrl: newUrl }) 
                        });
                        const responseText = await response.text();
                        let newManifest;
                        try { 
                            newManifest = JSON.parse(responseText); 
                        } catch (e) { 
                            throw new Error(`Risposta JSON non valida dal nuovo URL.`); 
                        }
                        
                        if (!response.ok || newManifest.error) {
                            throw new Error(newManifest.error?.message || "Nuovo URL non valido o irraggiungibile.");
                        }

                        // 2. URL valido! Applica tutte le modifiche.
                        addon.transportUrl = newUrl;
                        // Applica il nuovo manifesto, ma mantieni il nome che l'utente ha inserito
                        addon.manifest = { ...newManifest, name: newName }; 
                        addon.status = 'ok'; // Lo abbiamo appena controllato
                        
                        recordAction(t.value('addon.updateUrlSuccess', { name: oldName, newUrl: newUrl }));
                        showToast(t.value('addon.updateUrlSuccess', { name: oldName, newUrl: newUrl }), 'success');
                        
                    } catch (err) {
                        showToast(t.value('addon.updateUrlError', { message: err.message }), 'error');
                        // Non chiudere l'editor, l'utente deve correggere l'URL
                        isLoading.value = false;
                        return; 
                    }
                
                } else if (nameChanged) {
                    // È cambiato solo il nome, semplice.
                    recordAction(t.value('actions.renamed', { oldName: oldName, newName: newName }));
                    addon.manifest.name = newName;
                    showToast(t.value('addon.renameSuccess'), 'info');
                }

                // Se tutto è andato bene, chiudi
                addon.isEditing = false;
                isLoading.value = false;
            };
            const addNewAddon = async () => {
                if (isMonitoring.value) return; 
                const url = newAddonUrl.value.trim(); 
                if (!url.startsWith('http')) { showToast("Invalid URL.", 'error'); return; } 
                isLoading.value = true;
                try {
                    const response = await fetch(`${apiBaseUrl}/api/fetch-manifest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ manifestUrl: url }) }); const responseText = await response.text(); let manifest; try { manifest = JSON.parse(responseText); } catch (e) { throw new Error(`Invalid JSON response.`); } if (!response.ok || manifest.error) throw new Error(manifest.error?.message || "Invalid manifest.");
                    const cleanManifest = { id: manifest.id || `external-${Date.now()}`, version: manifest.version || '1.0.0', name: manifest.name || `New Addon`, types: manifest.types || ["movie", "series"], resources: manifest.resources || [], idPrefixes: manifest.idPrefixes || [], configurable: manifest.configurable, behaviorHints: manifest.behaviorHints, description: manifest.description || `URL: ${url}`, logo: manifest.logo || '', ...manifest }; const newAddonUrlBase = url.split('?')[0]; 
                    if (addons.value.some(a => a.transportUrl.split('?')[0] === newAddonUrlBase)) { showToast("Addon already exists.", 'error'); return; }
                    
                    // MODIFICATO: Chiama recordAction prima della mutazione
                    recordAction(t.value('actions.added', { name: cleanManifest.name })); 
                    
                    addons.value.push(mapAddon({ transportUrl: url, manifest: cleanManifest, isEnabled: true })); await nextTick(); const listElement = document.querySelector('.main-content'); if (listElement) listElement.scrollTo({ top: listElement.scrollHeight, behavior: 'smooth' }); newAddonUrl.value = ''; showToast(t.value('addon.addSuccess', { name: cleanManifest.name }), 'success'); hasUnsavedChanges.value = true;
                } catch (err) { showToast(t.value('addon.addError', { message: err.message }), 'error'); } finally { isLoading.value = false; }
            };
            const moveAddon = (addon, logicDirection) => { 
                if (isMonitoring.value) return; 
                recordAction(t.value('actions.reordered')); // MODIFICATO: Chiama recordAction con descrizione
                const index = addons.value.indexOf(addon); 
                if (index === -1) return; 
                const item = addons.value[index]; 
                if (logicDirection === 'up' && index > 0) [addons.value[index], addons.value[index - 1]] = [addons.value[index - 1], addons.value[index]]; 
                else if (logicDirection === 'down' && index < addons.value.length - 1) [addons.value[index], addons.value[index + 1]] = [addons.value[index + 1], addons.value[index]]; 
                else if (logicDirection === 'top' && index > 0) { addons.value.splice(index, 1); addons.value.unshift(item); } 
                else if (logicDirection === 'bottom' && index < addons.value.length - 1) { addons.value.splice(index, 1); addons.value.push(item); } 
                hasUnsavedChanges.value = true; 
            };
            const moveUp = (addon) => moveAddon(addon, 'up'); const moveDown = (addon) => moveAddon(addon, 'down'); const moveTop = (addon) => moveAddon(addon, 'top'); const moveBottom = (addon) => moveAddon(addon, 'bottom');
            const removeAddon = (addon) => { 
                if (isMonitoring.value) return; 
                if(confirm(t.value('addon.removeConfirm', { name: addon.manifest.name }))) { 
                    const index = addons.value.findIndex(a => a.transportUrl === addon.transportUrl); 
                    if (index > -1) { 
                        const removedAddonName = addons.value[index].manifest.name;
                        recordAction(t.value('actions.removed', { name: removedAddonName })); // MODIFICATO: Chiama recordAction
                        addons.value.splice(index, 1); 
                        showToast(t.value('addon.removeSuccess'), 'info'); 
                        hasUnsavedChanges.value = true; 
                    }
                }
            };
           const enableSelected = () => {
    if (isMonitoring.value) return;
    
    // Le due righe inutili sono state rimosse da qui.

    let count = 0;
    selectedAddons.value.forEach(addon => {
        if (!addon.isEnabled) {
            addon.isEnabled = true;
            count++;
        }
        addon.selected = false;
    });
    
    if (count > 0) {
        recordAction(t.value('actions.bulkEnabled', { count: count }));
        showToast(t.value('bulkActions.enabledSuccess', { count: count }), 'success');
        hasUnsavedChanges.value = true;
    } else {
        showToast(t.value('bulkActions.noneToEnable'), 'info');
    }
};
            const disableSelected = () => { 
                if (isMonitoring.value) return; 
                let count = 0; 
                selectedAddons.value.forEach(addon => { if (addon.isEnabled) { addon.isEnabled = false; count++; } addon.selected = false; }); 
                if (count > 0) { 
                    recordAction(t.value('actions.bulkDisabled', { count: count })); // MODIFICATO: Chiama recordAction
                    showToast(t.value('bulkActions.disabledSuccess', { count: count }), 'success'); 
                    hasUnsavedChanges.value = true; 
                } else { showToast(t.value('bulkActions.noneToDisable'), 'info'); }
            };
            const removeSelected = () => { 
                if (isMonitoring.value || selectedAddons.value.length === 0) return; 
                if (confirm(t.value('bulkActions.removeConfirm', { count: selectedAddons.value.length }))) { 
                    const selectedUrls = new Set(selectedAddons.value.map(a => a.transportUrl)); 
                    const originalCount = addons.value.length; 
                    const removedCount = originalCount - (addons.value.filter(addon => !selectedUrls.has(addon.transportUrl)).length);
                    
                    if (removedCount > 0) {
                        recordAction(t.value('actions.bulkRemoved', { count: removedCount })); // MODIFICATO: Chiama recordAction
                        addons.value = addons.value.filter(addon => !selectedUrls.has(addon.transportUrl));
                        showToast(t.value('bulkActions.removeSuccess', { count: removedCount }), 'success'); 
                        hasUnsavedChanges.value = true; 
                    }
                }
            };
            const toggleSelectAll = () => { const targetState = !allSelected.value; addons.value.forEach(addon => addon.selected = targetState); };
            const toggleSearch = () => { showSearchInput.value = !showSearchInput.value; if (showSearchInput.value) nextTick(() => searchInputRef.value?.focus()); };
            const hideSearchOnBlur = (event) => { const searchContainer = event.currentTarget.closest('.list-controls-header'); if (!searchContainer || (!searchContainer.contains(event.relatedTarget) && event.relatedTarget?.closest('.search-icon-btn') !== event.currentTarget.parentElement.querySelector('.search-icon-btn'))) showSearchInput.value = false; };
            const saveOrder = async () => {
                if (isMonitoring.value) return; 
                
                // 1. RIMETTI QUESTE DUE RIGHE COME ERANO IN ORIGINE
                const enabledAddons = addons.value.filter(a => a.isEnabled);
                const addonsToSave = enabledAddons.map(({ isEditing, newLocalName, status, isEnabled, selected, errorDetails, isExpanded, ...rest }) => rest);
                
                // 2. IL RESTO DEL CODICE CHE AVEVI INCOLLATO VA BENE
                if (!isLoading.value) isLoading.value = true;
                showToast(t.value('addon.saving'), 'info', 5000);
                try {
                    const response = await fetch(`${apiBaseUrl}/api/set-addons`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authKey: authKey.value, addons: addonsToSave, email: email.value }) });
                    const data = await response.json(); if (!response.ok || data.error) throw new Error(data.error || data.message || 'Save error.'); showToast(t.value('addon.saveSuccess'), 'success'); hasUnsavedChanges.value = false; 
                    
                    history.value = []; redoStack.value = []; actionLog.value = []; redoActionLog.value = []; 
                    
                    addons.value.forEach(a => a.selected = false); sessionStorage.setItem('stremioAddonList', JSON.stringify(addons.value));
                    
                    const profileIndex = savedProfiles.value.findIndex(p => p.id === authKey.value);
                    if (profileIndex !== -1) {
                         savedProfiles.value[profileIndex].addons = addonsToSave;
                         saveProfiles();
                    }
                } catch (err) { showToast(t.value('addon.saveError', { message: err.message }), 'error'); } finally { isLoading.value = false; isUpdating.value = false; }
            };
            
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
                    if (!response.ok || data.error) throw new Error(data.error || 'Refresh failed.');

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
                    
                    // Resetta log e stato
                    history.value = []; redoStack.value = []; actionLog.value = []; redoActionLog.value = [];
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

        // Sostituisci la vecchia funzione login() con questa
const login = async () => {
    isLoading.value = true;
    let payload;
    
    if (loginMode.value === 'password') {
        payload = {
            email: email.value,
            password: password.value
        };
    } else {
        // L'email è opzionale, usata solo per salvare il profilo.
        payload = {
            authKey: providedAuthKey.value,
            email: email.value // Invia anche l'email se fornita
        };
    }

    try {
        const response = await fetch(`${apiBaseUrl}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        
        if (!response.ok) {
            const errorMsg = data.error?.message || data.message || 'Login failed.';
            throw new Error(errorMsg);
        }

        authKey.value = data.authKey;
        isLoggedIn.value = true;
        isMonitoring.value = false;
        
        // Se l'email è vuota dopo il login con token (non fornita), usa un placeholder
        if (loginMode.value === 'token' && !email.value) {
            email.value = 'TokenAccessUser'; // Placeholder
        }
        
        sessionStorage.setItem('stremioAuthKey', authKey.value);
        sessionStorage.setItem('stremioEmail', email.value); // Salva l'email
        sessionStorage.setItem('stremioIsMonitoring', 'false');
        sessionStorage.setItem('stremioAddonList', JSON.stringify(data.addons.map(mapAddon)));
        
        addons.value = data.addons.map(mapAddon);
        showWelcomeScreen.value = true;
        showToast(t.value('addon.loginSuccess'), 'success');
        
        history.value = []; redoStack.value = []; actionLog.value = []; redoActionLog.value = [];
        hasUnsavedChanges.value = false;
        
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        isLoading.value = false;
    }
};

// ▼▼▼ AGGIUNGI ANCHE QUESTA NUOVA FUNZIONE (dopo la funzione login) ▼▼▼
const toggleLoginMode = () => {
    if (loginMode.value === 'password') {
        loginMode.value = 'token';
    } else {
        loginMode.value = 'password';
    }
    // Resetta gli input quando cambi
    password.value = '';
    providedAuthKey.value = '';
    // Non resettare l'email, potrebbe servire in entrambe le modalità
};
            
            // Logica Theme
            const applyTheme = (isLight) => {
                if (isLight) {
                    document.body.classList.add('light-mode');
                } else {
                    document.body.classList.remove('light-mode');
                }
                try {
                    localStorage.setItem('stremioConsoleTheme', isLight ? 'light' : 'dark');
                } catch(e) {
                    console.warn("Cannot save theme pref to localStorage.");
                }
            };

            const toggleTheme = () => {
                applyTheme(isLightMode.value);
            };

            // Logica Tour/Welcome
            const dismissWelcomeScreen = () => {
                showWelcomeScreen.value = false;

                if (importedConfigFromUrl.value) {
                    pendingImportData.value = importedConfigFromUrl.value;
                    importSource.value = 'url';
                    showImportConfirm.value = true;
                    importedConfigFromUrl.value = null; 
                    return;
                }

                try {
                    const tourCompleted = localStorage.getItem('stremioConsoleWelcomeCompleted') === 'true';
                    if (!tourCompleted) {
                        showWelcomeTourModal.value = true;
                    }
                } catch(e) {
                    console.warn("Cannot read tour pref from localStorage.");
                }
            };

            const skipTour = () => {
                if (dontShowWelcomeAgain.value) {
                    try { localStorage.setItem('stremioConsoleWelcomeCompleted', 'true'); } catch(e) { console.warn("Cannot save tour pref to localStorage."); }
                }
                showWelcomeTourModal.value = false;
            };

            const beginTour = () => {
                if (dontShowWelcomeAgain.value) {
                    try { localStorage.setItem('stremioConsoleWelcomeCompleted', 'true'); } catch(e) { console.warn("Cannot save tour pref to localStorage."); }
                }
                showWelcomeTourModal.value = false;
                
                nextTick(() => {
                    startTour();
                });
            };

            const startTour = () => {
                const originalHasUnsaved = hasUnsavedChanges.value;
                if (!isMonitoring.value && hasUnsavedChanges.value) {
                    // Se ci sono già modifiche non salvate, il pulsante è visibile
                } else if (!isMonitoring.value) {
                    hasUnsavedChanges.value = true; // Forza la visualizzazione
                }

                const steps = [
                    { element: document.querySelector('[data-tour="step-1"]'), intro: t.value('tour.steps.s1'), position: 'bottom' },
                    { element: document.querySelector('[data-tour="step-2"]'), intro: t.value('tour.steps.s2'), position: isMobile.value ? 'bottom' : 'left' },
                    { element: document.querySelector('[data-tour="step-3"]'), intro: t.value('tour.steps.s3'), position: 'bottom' },
                    { element: document.querySelector('[data-tour="step-4"]'), intro: t.value('tour.steps.s4'), position: 'top' }
                ];

                const firstAddonItem = document.querySelector('.addon-item');
                if (firstAddonItem && !isMobile.value) { // Mostra drag solo su desktop
                    steps.push({ element: firstAddonItem.querySelector('[data-tour="step-5"]'), intro: t.value('tour.steps.s5'), position: 'right' });
                }
                if (firstAddonItem) {
                     steps.push({ element: firstAddonItem.querySelector('[data-tour="step-6"]'), intro: t.value('tour.steps.s6'), position: 'left' });
                }
                
                steps.push({ element: document.querySelector('[data-tour="step-7"]'), intro: t.value('tour.steps.s7'), position: 'bottom' });
                
                const floatingButton = document.querySelector('[data-tour="step-8"]');
                if (!isMonitoring.value && floatingButton && floatingButton.classList.contains('visible')) {
                    steps.push({ element: floatingButton, intro: t.value('tour.steps.s8'), position: 'left' });
                }

                introJs().setOptions({
                    steps: steps,
                    tooltipClass: 'introjs-tooltip',
                    highlightClass: 'introjs-helperLayer',
                    nextLabel: t.value('tour.welcome.startButton').includes('Start') ? 'Next →' : 'Avanti →',
                    prevLabel: t.value('tour.welcome.startButton').includes('Start') ? '← Back' : '← Indietro',
                    doneLabel: t.value('tour.welcome.startButton').includes('Start') ? 'Done' : 'Fatto',
                    exitOnOverlayClick: false,
                    showBullets: false,
                }).oncomplete(() => {
                    if (!isMonitoring.value && !originalHasUnsaved) hasUnsavedChanges.value = false; 
                }).onexit(() => {
                    if (!isMonitoring.value && !originalHasUnsaved) hasUnsavedChanges.value = false;
                }).start();
            };
            // --- Fine Logica Tour/Welcome ---

            const logout = () => { 
                if (hasUnsavedChanges.value && !confirm(t.value('list.logoutConfirm'))) return; 
                sessionStorage.clear(); 
                email.value = ''; password.value = ''; authKey.value = null; 
                addons.value = []; isLoggedIn.value = false; 
                isMonitoring.value = false; showAdminInput.value = false; 
                hasUnsavedChanges.value = false; 
                
                // Reset cronologia e log
                history.value = []; redoStack.value = []; actionLog.value = []; redoActionLog.value = []; 

                searchQuery.value = ''; showSearchInput.value = false; showInstructions.value = false; 
                toasts.value = []; showWelcomeScreen.value = false; showWelcomeTourModal.value = false; 
                loadProfiles(); // Ricarica i profili salvati dopo il logout
            };
            const beforeUnloadHandler = (event) => { if (hasUnsavedChanges.value) { event.preventDefault(); event.returnValue = ''; } };
            const incrementAdminClick = () => { if(!isLoggedIn.value) adminClickCount.value++; if (adminClickCount.value >= 5) { showAdminInput.value = true; showToast(t.value('addon.monitorModeActive'), 'info'); adminClickCount.value = 0; }};
             const onDragEnd = (event) => { 
                 if (!isMonitoring.value) {
                     // MODIFICATO: Chiama recordAction con la descrizione dell'azione
                     recordAction(t.value('actions.reordered'));
                 }
             };
            // --- Computed ---
            const dragOptions = computed(() => ({ animation: 200, ghostClass: "ghost-class", handle: ".drag-handle", forceFallback: true, scrollSensitivity: 100, bubbleScroll: true, delay: 300, delayOnTouchOnly: true, touchStartThreshold: isMobile.value ? 10 : 3 }));
            
            // MODIFICATO: Usa actualSearchQuery (debounced)
            const filteredAddons = computed(() => { 
                let f = addons.value; 

                // Filtro per stato (eseguito sempre per primo)
                if (activeFilter.value === 'enabled') f = addons.value.filter(a => a.isEnabled); 
                if (activeFilter.value === 'disabled') f = addons.value.filter(a => !a.isEnabled); 
                if (activeFilter.value === 'errors') f = addons.value.filter(a => a.status === 'error'); 

                // Filtro per ricerca (usa il valore debounced per performance)
                if (!actualSearchQuery.value) return f; 
                const lcq = actualSearchQuery.value.toLowerCase(); 
                return f.filter(a => a.manifest.name.toLowerCase().includes(lcq)); 
            });
            
            // Logica draggableList corretta
            const draggableList = computed({ 
                get: () => filteredAddons.value, 
                set(reorderedFilteredList) { 
                    if (isMonitoring.value) return; 

                    const filteredUrlsMap = new Map(filteredAddons.value.map(a => [a.transportUrl, a]));
                    let nextFilteredIndex = 0;
                    const newAddonsList = [];

                    addons.value.forEach(originalAddon => {
                        // Se l'addon era visibile nella lista filtrata
                        if (filteredUrlsMap.has(originalAddon.transportUrl)) {
                            // Sostituisci l'addon originale con il prossimo della lista riordinata
                            if (nextFilteredIndex < reorderedFilteredList.length) {
                                newAddonsList.push(reorderedFilteredList[nextFilteredIndex]);
                                nextFilteredIndex++;
                            }
                        } else {
                            // Se l'addon era nascosto (non filtrato), mantienilo nella posizione relativa
                            newAddonsList.push(originalAddon);
                        }
                    });
                    
                    // Solo aggiorna se l'ordine effettivo è cambiato
                    if (JSON.stringify(addons.value.map(a => a.transportUrl)) !== JSON.stringify(newAddonsList.map(a => a.transportUrl))) {
                        addons.value = newAddonsList;
                        // Nota: recordAction è chiamato in onDragEnd per il drag and drop, 
                        // ma per i move button è chiamato direttamente in moveAddon.
                        // Qui non chiamo recordAction per evitare doppio salvataggio con onDragEnd.
                        hasUnsavedChanges.value = true;
                    }
                } 
            });

            const enabledCount = computed(() => addons.value.filter(a => a.isEnabled).length);
            const disabledCount = computed(() => addons.value.filter(a => !a.isEnabled).length);
            const errorCount = computed(() => addons.value.filter(a => a.status === 'error').length);
            const selectedAddons = computed(() => addons.value.filter(a => a.selected));
            const allSelected = computed(() => addons.value.length > 0 && selectedAddons.value.length === addons.value.length);
            
            const t = computed(() => (key, interpolations = {}) => {
                const keys = key.split('.'); let res = translations[lang.value]; keys.forEach(k => res = res?.[k]); let translation = res || key; Object.entries(interpolations).forEach(([varName, value]) => { translation = translation.replace(new RegExp(`{{${varName}}}`, 'g'), value); }); return translation;
            });

            watch(lang, (newLang) => { document.documentElement.lang = newLang; document.title = t.value('meta.title'); try { localStorage.setItem('stremioConsoleLang', newLang); } catch(e) { console.warn("Cannot save lang to localStorage."); } });
            watch(isAutoUpdateEnabled, (newValue) => {
                try {
                    localStorage.setItem('stremioAutoUpdateEnabled', newValue);
                    if (newValue) {
                        showToast(t.value('autoUpdate.enabled'), 'info');
                    } else {
                        showToast(t.value('autoUpdate.disabled'), 'info');
                    }
                } catch(e) { console.warn("Cannot save auto-update pref to localStorage."); }
            });

            // MODIFICATO: Watcher per il debounce della ricerca
            watch(searchQuery, (newValue) => {
                debouncedSearchHandler(newValue);
            });
            
            // --- Lifecycle ---
            onMounted(() => {
                window.addEventListener('beforeunload', beforeUnloadHandler); window.addEventListener('resize', updateIsMobile);
                
                // INIZIO LOGICA TEMA
                try {
                    const savedTheme = localStorage.getItem('stremioConsoleTheme');
                    if (savedTheme) {
                        isLightMode.value = savedTheme === 'light';
                    } else {
                        isLightMode.value = false;
                    }
                    applyTheme(isLightMode.value);
                } catch(e) { 
                    console.warn("Error reading theme from localStorage or getting system preference.");
                    isLightMode.value = false; // Fallback sicuro
                    applyTheme(isLightMode.value);
                }
                // FINE LOGICA TEMA

                // INIZIO LOGICA PROFILI
                loadProfiles();
                // FINE LOGICA PROFILI

                try { const savedLang = localStorage.getItem('stremioConsoleLang'); if (savedLang && ['it', 'en'].includes(savedLang)) lang.value = savedLang; } catch(e) { console.warn("Error reading lang from localStorage."); }
                document.documentElement.lang = lang.value; document.title = t.value('meta.title');
                if (window.location.hash.startsWith('#config=')) { const compressed = window.location.hash.substring(8); try { const data = LZString.decompressFromEncodedURIComponent(compressed); if (!data) throw new Error(t.value('import.urlErrorInvalid')); const importedData = JSON.parse(data); if (Array.isArray(importedData)) importedConfigFromUrl.value = importedData; window.location.hash = ''; } catch (e) { showToast(t.value('import.error', { message: e.message }), 'error'); window.location.hash = ''; }}
                try {
                    isAutoUpdateEnabled.value = localStorage.getItem('stremioAutoUpdateEnabled') === 'true';
                    lastUpdateCheck.value = localStorage.getItem('stremioLastAutoUpdate');
                } catch (e) { console.warn("Error reading auto-update settings from localStorage."); }
                scheduleUpdateCheck();
                try {
                    const storedKey = sessionStorage.getItem('stremioAuthKey'); const storedList = sessionStorage.getItem('stremioAddonList'); const storedEmail = sessionStorage.getItem('stremioEmail'); const storedMonitoring = sessionStorage.getItem('stremioIsMonitoring') === 'true';
                    if (storedKey && storedList) {
                        authKey.value = storedKey; email.value = storedEmail || ''; isMonitoring.value = storedMonitoring; if(isMonitoring.value) targetEmail.value = storedEmail || '';
                         addons.value = JSON.parse(storedList).map(a => mapAddon(a));
                        isLoggedIn.value = true;
                        showToast(t.value('addon.sessionRestored'), 'info');
                        showWelcomeScreen.value = true;
                    }
                } catch(e) { console.error("Error restoring session:", e); sessionStorage.clear(); }
            });
            onBeforeUnmount(() => { window.removeEventListener('beforeunload', beforeUnloadHandler); window.removeEventListener('resize', updateIsMobile); });
            // --- Return ---
            return { email, password, authKey, addons, isLoggedIn, isLoading, newAddonUrl, fileInput, adminClickCount, showAdminInput, adminKey, targetEmail, isMonitoring, searchQuery, filteredAddons, login, logout, incrementAdminClick, monitorLogin, exportBackup, triggerFileInput, handleFileImport, checkAllAddonsStatus, addNewAddon, saveOrder, startEdit, finishEdit, moveUp, moveDown, moveTop, moveBottom, removeAddon, toggleAddonEnabled, toggleAddonDisableAutoUpdate, openConfiguration, copyManifestUrl, hasUnsavedChanges, history, redoStack, actionLog, redoActionLog, undo, redo, activeFilter, draggableList, onDragEnd, lang, t, shareUrl, shareInput, generateShareLink, copyShareLink, importedConfigFromUrl, selectedAddons, allSelected, toggleSelectAll, enableSelected, disableSelected, removeSelected, showSearchInput, searchInputRef, toggleSearch, hideSearchOnBlur, showInstructions, dragOptions, showImportConfirm, confirmImport, closeImportConfirm, importSource, toasts, showToast, enabledCount, disabledCount, errorCount, testAddonSpeed,
                     toggleAddonDetails, getResourceNames, isAutoUpdateEnabled, lastUpdateCheck, isUpdating, runAutoUpdate,
                     showWelcomeScreen, dismissWelcomeScreen, refreshAddonList, exportTxt,
                     // ▼▼▼ AGGIUNGI QUESTI ALLA LISTA ▼▼▼
                loginMode,
                providedAuthKey,
                toggleLoginMode,
					 // Feature 1
                     savedProfiles, loadProfile, saveProfile, deleteProfile, selectedProfileId, startEditProfile, finishEditProfile,
                     // Tour
                     showWelcomeTourModal, dontShowWelcomeAgain, skipTour, beginTour,
                     // Theme
                     isLightMode, toggleTheme
            };
        }
    });
    app.component('draggable', window.vuedraggable);
    app.mount('#app');            welcome: {
                title: "Benvenuto!",
                p1: "Questa è la tua console di comando personale per Stremio.",
                p2: "Ti piacerebbe un rapido tour delle funzionalità principali?",
                dontShowAgain: "Non mostrare più",
                skipButton: "Salta",
                startButton: "Inizia Tour"
            },
            steps: {
                s1: "Questo è il titolo. Clicca 5 volte (senza essere loggato) per la modalità di monitoraggio segreta.",
                s2: "Qui vedi statistiche veloci dei tuoi addon: totali, attivi e con errori.",
                s3: "Incolla qui un URL .../manifest.json per aggiungere un nuovo addon alla tua lista.",
                s4: "Questa è la tua lista di addon. Puoi riordinarli, abilitarli o disabilitarli.",
                s5: "Su desktop, puoi trascinare gli addon da quest'area per riordinarli rapidamente.",
                s6: "Usa questo interruttore per abilitare o disabilitare un addon. Le modifiche non sono definitive finché non salvi.",
                s7: "Questo è il pulsante PIÙ IMPORTANTE. Clicca per salvare tutte le tue modifiche (ordine, nomi, stati) su Stremio.",
                s8: "Se hai modifiche non salvate, apparirà anche questo pulsante. È un promemoria utile!"
            }
        },
        login: {
    title: "Accesso Utente",
    emailPlaceholder: "E-mail Stremio",
    passwordPlaceholder: "Password Stremio",
    tokenPlaceholder: "Il tuo AuthKey (Token) di Stremio", // <-- NUOVO
    useToken: "Accedi con Token (AuthKey)",             // <-- NUOVO
    usePassword: "Accedi con Email/Password",          // <-- NUOVO
    button: "ACCEDI",
    loading: "Accesso in corso..."
},
        monitor: {
            title: "Modalità Monitoraggio",
            keyPlaceholder: "La tua Chiave di Monitoraggio",
            emailPlaceholder: "E-mail dell'utente da controllare",
            button: "MONITORA UTENTE",
            loading: "Monitoraggio in corso..."
        },
        list: {
            title: "Lista Addon ({{count}})",
            saveButton: "Salva Ordine e Modifiche su Stremio",
            addPlaceholder: "Incolla l'URL del manifesto dell'addon (https://.../manifest.json)",
            addButton: "Aggiungi",
            checkStatusButton: "Verifica Stato Addon",
            noResults: "Nessun addon corrisponde alla tua ricerca.",
            noAddons: "Nessun addon trovato per questo account.",
            logoutButton: "ESCI",
            logoutConfirm: "Hai modifiche non salvate. Sei sicuro di voler uscire?",
            refreshButton: "Aggiorna Lista",
            refreshSuccess: "Lista aggiornata dal server!",
            refreshError: "Errore di aggiornamento: {{message}}"
        },
        backup: {
            title: "Gestione Backup",
            exportButton: "Esporta Backup (.json)",
            importButton: "Importa Backup (.json)",
            shareButton: "Condividi Configurazione (URL)",
            exportTxtButton: "Esporta Lista TXT",
            exportTxtSuccess: "Lista esportata come TXT!"
        },
        share: {
            title: "Link di Condivisione Generato",
            copyButton: "Copia Link",
            copySuccess: "Link copiato negli appunti!"
        },
        import: {
            urlSuccess: "Configurazione importata da URL! {{count}} addon caricati. Clicca SALVA.",
            urlErrorInvalid: "Dati di configurazione in URL non validi o corrotti.",
            fileSuccess: "Backup importato! {{count}} addon caricati. Clicca SALVA.",
            error: "Importazione fallita: {{message}"
        },
        importConfirm: {
            title: "Conferma Importazione",
            p1: "Stai per sovrascrivere la tua lista addon attuale. Questa azione non può essere annullata.",
            p2_file: "Caricamento di questa configurazione da file.",
            p2_url: "Caricamento di questa configurazione da URL condiviso.",
            confirmButton: "Conferma e Sovrascrivi",
            cancelButton: "Annulla"
        },
        search: {
            placeholder: "🔍 Cerca addon per nome...",
            toggleTitle: "Mostra/Nascondi ricerca",
            resultsCount: "Mostrati {{shown}}/{{total}} addon"
        },
        actions: {
            undo: "Annulla ultima azione",
            undoLabel: "Annulla",
            redo: "Ripeti ultima azione",
            redoLabel: "Ripeti",
            undoPerformed: "↩️ Azione annullata: {{action}}",
            redoPerformed: "↪️ Azione ripetuta: {{action}}",
            reordered: "Addon riordinati (trascinamento)",
            renamed: "Rinominato '{{oldName}}' in '{{newName}}'",
            added: "Aggiunto addon '{{name}}'",
            removed: "Rimosso addon '{{name}}'",
            enabledAddon: "Abilitato addon '{{name}}'",
            disabledAddon: "Disabilitato addon '{{name}}'",
            bulkEnabled: "Abilitati {{count}} addon tramite azione massiva",
            bulkDisabled: "Disabilitati {{count}} addon tramite azione massiva",
            bulkRemoved: "Rimossi {{count}} addon tramite azione massiva",
            imported: "Configurazione importata ({{count}} addon)",
            excludedFromUpdate: "Escluso '{{name}}' da Aggiornamento Automatico",
            includedInUpdate: "Incluso '{{name}}' in Aggiornamento Automatico"
        },
        filters: {
            all: "Tutti",
            enabled: "Abilitati",
            disabled: "Disabilitati",
            errors: "Con Errori"
        },
       addon: {
            statusTitle: "Stato: {{status}}",
            errorDetailsTitle: "Dettaglio Errore: {{details}}",
            editTitle: "Modifica Nome",
            saveButton: "Salva",
            noDescription: "Nessuna descrizione",
            toggleTitle: "Abilita/Disabilita Addon",
            configureTitle: "Configura Addon",
            copyTitle: "Copia URL Manifesto",
            moveTopTitle: "Sposta in Cima",
            moveBottomTitle: "Sposta in Fondo",
            moveUpTitle: "Sposta Su",
            moveDownTitle: "Sposta Giù",
            removeTitle: "Rimuovi",
            removeConfirm: "Sei sicuro di voler rimuovere \"{{name}}\"?",
            renameSuccess: "Nome aggiornato. Clicca SALVA.",
            updateUrlSuccess: "URL e Manifesto aggiornati. Clicca SALVA.", // <-- RIGA AGGIUNTA
            updateUrlError: "Nuovo URL non valido: {{message}}", // <-- RIGA AGGIUNTA
            addSuccess: "Addon \"{{name}}\" aggiunto! Clicca SALVA.",
            removeSuccess: "Addon rimosso. Clicca SALVA.",
            copyUrlSuccess: "URL copiato!",
            copyUrlError: "Impossibile copiare l'URL.",
            statusCheck: "📡 Verifica stato avviata.",
            statusCheckComplete: "📡 Verifica completata. Trovati {{errorCount}} errori.",
            statusCheckError: "Errore di verifica: {{message}}",
            sessionRestored: "Sessione ripristinata.",
            loginSuccess: "Accesso effettuato con successo.",
            saveSuccess: "🎉 Ordine salvato!",
            saveError: "Errore durante il salvataggio: {{message}}",
            saving: "Salvataggio in corso...",
            addError: "Errore durante l'aggiunta: {{message}}",
            monitorError: "ERRORE DI MONITORAGGIO: {{message}}",
            monitorSuccess: "MONITORAGGIO: Dati di {{email}} caricati.",
            exportError: "Errore durante la creazione del backup: {{message}}",
            exportSuccess: "Backup esportato!",
            shareError: "Errore durante la creazione del link: {{message}}",
            shareGenerated: "Link di condivisione generato!",
            monitorModeActive: "Modalità Monitoraggio Attiva.",
            speedTestTitle: "Test Velocità Addon",
            speedTestRunning: "Test velocità in corso per {{name}}...",
            speedTestResult: "Risultato Test {{name}}: {{time}}ms",
            speedTestTimeout: "Test fallito {{name}}: Timeout (8s)",
            detailsTitle: "Mostra/Nascondi Dettagli",
            details: {
                title: "Dettagli Manifesto",
                version: "Versione",
                id: "ID",
                types: "Tipi",
                resources: "Risorse",
                url: "URL Manifesto"
            },
            autoUpdateDisabled: "Escluso da Agg. Auto",
            autoUpdateEnabled: "Incluso in Agg. Auto",
            disableAutoUpdateTitle: "Escludi da Aggiornamento Automatico"
        },
        autoUpdate: {
            title: "Aggiornamento Automatico",
            description: "Se attivo, cercherà nuove versioni degli addon ogni notte alle 3:00 AM e le salverà automaticamente.",
            toggleTitle: "Abilita/Disabilita aggiornamento automatico",
            forceButton: "Forza Aggiornamento Ora",
            running: "Aggiornamento in corso...",
            enabled: "Aggiornamento automatico Abilitato.",
            disabled: "Aggiornamento automatico Disabilitato.",
            foundChanges: "Trovati {{count}} aggiornamenti (falliti: {{failed}}). Salvataggio automatico...",
            noChanges: "Nessun aggiornamento trovato (falliti: {{failed}}).",
            lastCheck: "Ultima verifica"
        },
        bulkActions: {
            selected: "{{count}} Selezionati",
            enable: "🟢 Abilita",
            disable: "🔴 Disabilita",
            remove: "🗑️ Rimuovi",
            removeConfirm: "Sei sicuro di voler rimuovere {{count}} addon selezionati?",
            selectAll: "Seleziona Tutti",
            deselectAll: "Deseleziona Tutti",
            enabledSuccess: "Abilitati {{count}} addon selezionati. Clicca Salva.",
            disabledSuccess: "Disabilitati {{count}} addon selezionati. Clicca Salva.",
            removeSuccess: "Rimossi {{count}} addon selezionati. Clicca Salva.",
            noneToEnable: "Nessun addon selezionato da abilitare.",
            noneToDisable: "Nessun addon selezionato da disabilitare."
        },
        stats: {
            title: "Statistiche",
            total: "Totale Addon",
            enabled: "Abilitati",
            disabled: "Disabilitati",
            errors: "Con Errori"
        },
        footer: {
            copyright: "© Stremio Console",
            skin: "Cyberpunk skin • di Luca",
            language: "Lingua",
            lightMode: "Modalità Chiara",
            darkMode: "Modalità Scura"
        },
        instructions: {
            title: "Istruzioni",
            disclaimer: {
                title: "ESCLUSIONE DI RESPONSABILITÀ (DISCLAIMER)",
                p1: "QUESTA APPLICAZIONE È UNO STRUMENTO NON UFFICIALE DI TERZE PARTI. NON CI ASSUMIAMO ALCUNA RESPONSABILITÀ PER L'USO CHE NE FARAI. USARE QUESTA APP POTREBBE POTENZIALMENTE CAUSARE DANNI AL TUO ACCOUNT STREMIO (es. la perdita dell'ordine degli addon o problemi di sincronizzazione). UTILIZZALA A TUO RISCHIO E PERICOLO. NON siamo affiliati, approvati o sponsorizzati da Stremio."
            },
            login: {
                title: "Accesso e Monitoraggio",
                p1: "Inserisci le tue credenziali Stremio. L'app non salva la tua password; genera e usa un 'authKey' temporaneo.",
                p2: "Clicca il titolo 5 volte per sbloccare la 'Modalità Monitoraggio', utile per visualizzare la lista addon di un altro utente (richiede una chiave amministrativa).",
            },
            profiles: {
                title: "Gestione Profili",
                p1: "Salva la tua sessione loggata (Email e Chiave d'Autenticazione) localmente per quick access senza reinserire la password. Clicca sul nome di un profilo per rinominarlo.",
            },
            list: {
                title: "Gestione Addon",
                p1: "La tua lista è salvata in locale (sessione) e viene sincronizzata con Stremio solo quando clicchi 'Salva Ordine'.",
                li1: "Trascina gli addon (zona icona/nome) per cambiarne l'ordine.",
                li2: "L'ordine è fondamentale: gli addon in cima hanno la priorità nella risoluzione dei link.",
                li3: "Clicca la matita per rinominare un addon localmente (il nuovo nome viene salvato su Stremio).",
                li4: "Usa l'interruttore per abilitare/disabilitare rapidamente gli addon senza rimuoverli.",
                li5: "L'icona ⚙️ appare solo se l'addon supporta la configurazione esterna e apre la pagina nel browser.",
                li6: "Il pulsante ⏱️ esegue un test di velocità di base per verificare il tempo di risposta del manifesto.",
                li7: "L'icona ► espande i dettagli del manifesto (Versione, ID, Tipi, Risorse).",
                li8: "Il pulsante **Lucchetto** (🔒/🔓) esclude/include l'addon dall'Aggiornamento Automatico notturno (se la funzione globale è attiva).",
            },
            bulk: {
                title: "Azioni Multiple",
                p1: "Seleziona uno o più addon tramite il checkbox, poi usa i pulsanti 'Attiva', 'Disattiva' o 'Rimuovi' per applicare l'azione a tutti i selezionati contemporaneamente.",
            },
            status: {
                title: "Verifica Stato",
                p1: "Clicca 'Verifica Stato Addon' per controllare se gli URL dei manifesti rispondono correttamente (lo stato diventa 🟢 OK o 🔴 Errore).",
            },
            backup: {
                title: "Backup e Importazione",
                p1: "Esporta un file .json per salvare la tua configurazione completa (ordine, stato, URL) sul tuo computer.",
                p2: "Importa un file .json per ripristinare una configurazione precedente, sovrascrivendo quella attuale (è richiesta conferma).",
                p3: "Esporta Lista TXT è utile per una rapida condivisione degli URL.",
            },
            share: {
                title: "Link di Condivisione",
                p1: "Genera un link URL codificato. Chiunque abbia questo link potrà caricare la tua lista (senza credenziali) direttamente nell'app Console.",
            },
            autoUpdate: {
                title: "Aggiornamento Automatico",
                p1: "L'opzione di Aggiornamento Automatico (Auto-Update) esegue una verifica notturna per trovare nuove versioni dei manifesti degli addon esistenti.",
                p2: "Se vengono trovate differenze, l'app aggiorna automaticamente il manifesto e lo salva su Stremio, mantenendo l'ordine e il nome locale inalterati.",
            },
            other: {
                title: "Note Importanti",
                p1: "Le modifiche (ordine, stato, nome) sono temporanee (vengono salvate solo nella cronologia) finché non clicchi 'Salva Ordine'.",
                p2: "Utilizza i pulsanti Annulla e Ripristina per sfogliare la cronologia delle modifiche locali.",
                p3: "La Modalità Monitoraggio (Admin) non può salvare modifiche.",
                p4: "Il pulsante SALVA flottante appare solo quando hai modifiche non salvate (Chrome/Desktop).",
                p5: "Tutti i dati, tranne le preferenze di interfaccia, sono gestiti tramite 'authKey' di Stremio; se esegui il Logout, devi effettuare il Login nuovamente.",
            }
        }
    },
    en: {
        meta: { title: "StreamOrder ⚡ Addon Command Console" },
        h1: "StreamOrder ⚡ Addon Command Console",
        subtitle: {
            login: "Control the chaos. Dominate your Addons.",
            monitoring: "Monitoring Mode active",
            loggedIn: "Quick console to manage, order, and save addons",
            security: "Secure: Your password is never saved." // <-- AGGIUNGI QUESTA RIGA
        },
       welcome: {
            title: "Welcome to the Addon Console!",
            panel_p1: "Your Stremio addon control center.", 
            p1: "Quickly configure main options or go directly to manage your list.",
            autoUpdateTitle: "Nightly Automatic Updates",
            autoUpdateDesc: "Do you want the console to automatically check and install addon updates every night at 3:00 AM?",
            autoUpdateEnabled: "Enabled",
            autoUpdateDisabled: "Disabled",
            manageTitle: "Manage Your Addons",
            manageDesc: "Go to the full list to add, remove, reorder, and configure your addons.",
            proceedButton: "Manage Addons"
        },
        profiles: {
            title: "Saved Profiles",
            p1: "Select a profile to instantly load credentials and session. Click on the name to rename. (Data saved locally)",
            noProfiles: "No saved profiles.",
            manageTitle: "Manage Profiles",
            saveButton: "Save Session as Profile",
            saveSuccess: "Profile saved!",
            selectButton: "Load",
            deleteConfirm: "Are you sure you want to delete profile '{{name}}'?",
            deleteSuccess: "Profile deleted.",
            renameSuccess: "Profile renamed."
        },
        tour: {
            welcome: {
                title: "Welcome!",
                p1: "This is your personal command console for Stremio.",
                p2: "Would you like a quick tour of the main features?",
                dontShowAgain: "Don't show again",
                skipButton: "Skip",
                startButton: "Start Tour"
            },
            steps: {
                s1: "This is the title. Click it 5 times (when logged out) for the secret Monitoring Mode.",
                s2: "Here you see quick stats of your addons: total, enabled, and errors.",
                s3: "Paste an .../manifest.json URL here to add a new addon to your list.",
                s4: "This is your addon list. You can reorder them, enable or disable them.",
                s5: "On desktop, you can drag addons from this area to quickly reorder them.",
                s6: "Use this switch to enable or disable an addon. Changes are not final until you save.",
                s7: "This is the MOST IMPORTANT button. Click to save all your changes (order, names, statuses) to Stremio.",
                s8: "If you have unsaved changes, this button will also appear. It's a handy reminder!"
            }
        },
      login: {
    title: "User Login",
    emailPlaceholder: "Stremio E-mail",
    passwordPlaceholder: "Stremio Password",
    tokenPlaceholder: "Your Stremio AuthKey (Token)", // <-- NUOVO
    useToken: "Login with Token (AuthKey)",             // <-- NUOVO
    usePassword: "Login with Email/Password",          // <-- NUOVO
    button: "LOGIN",
    loading: "Logging in..."
},
        monitor: {
            title: "Monitoring Mode",
            keyPlaceholder: "Your Monitoring Key",
            emailPlaceholder: "User E-mail to check",
            button: "MONITOR USER",
            loading: "Monitoring..."
        },
        list: {
            title: "Addon List ({{count}})",
            saveButton: "Save Order and Changes to Stremio",
            addPlaceholder: "Paste addon manifest URL (https://.../manifest.json)",
            addButton: "Add",
            checkStatusButton: "Check Addon Status",
            noResults: "No addons match your search.",
            noAddons: "No addons found for this account.",
            logoutButton: "LOGOUT",
            logoutConfirm: "You have unsaved changes. Are you sure you want to log out?",
            refreshButton: "Refresh List",
            refreshSuccess: "List refreshed from server!",
            refreshError: "Refresh error: {{message}}"
        },
        backup: {
            title: "Backup Management",
            exportButton: "Export Backup (.json)",
            importButton: "Import Backup (.json)",
            shareButton: "Share Configuration (URL)",
            exportTxtButton: "Export TXT List",
            exportTxtSuccess: "List exported as TXT!"
        },
        share: {
            title: "Share Link Generated",
            copyButton: "Copy Link",
            copySuccess: "Link copied to clipboard!"
        },
        import: {
            urlSuccess: "Configuration imported from URL! {{count}} addons loaded. Click SAVE.",
            urlErrorInvalid: "Invalid or corrupt configuration data in URL.",
            fileSuccess: "Backup imported! {{count}} addons loaded. Click SAVE.",
            error: "Import failed: {{message}"
        },
        importConfirm: {
            title: "Import Confirmation",
            p1: "You are about to overwrite your current addon list. This action cannot be undone.",
            p2_file: "Loading this configuration from a file.",
            p2_url: "Loading this configuration from a shared URL.",
            confirmButton: "Confirm and Overwrite",
            cancelButton: "Cancel"
        },
        search: {
            placeholder: "🔍 Search addon by name...",
            toggleTitle: "Show/Hide search",
            resultsCount: "Showing {{shown}}/{{total}} addons"
        },
        actions: {
            undo: "Undo last action",
            undoLabel: "Undo",
            redo: "Redo last action",
            redoLabel: "Redo",
            undoPerformed: "↩️ Action undone: {{action}}",
            redoPerformed: "↪️ Action redone: {{action}}",
            reordered: "Addons reordered (drag and drop)",
            renamed: "Renamed '{{oldName}}' to '{{newName}}'",
            added: "Added addon '{{name}}'",
            removed: "Removed addon '{{name}}'",
            enabledAddon: "Enabled addon '{{name}}'",
            disabledAddon: "Disabled addon '{{name}}'",
            bulkEnabled: "Enabled {{count}} addons via bulk action",
            bulkDisabled: "Disabled {{count}} addons via bulk action",
            bulkRemoved: "Removed {{count}} addons via bulk action",
            imported: "Configuration imported ({{count}} addons)",
            excludedFromUpdate: "Excluded '{{name}}' from Auto Update",
            includedInUpdate: "Included '{{name}}' in Auto Update"
        },
        filters: {
            all: "All",
            enabled: "Enabled",
            disabled: "Disabled",
            errors: "With Errors"
        },
        addon: {
            statusTitle: "Status: {{status}}",
            errorDetailsTitle: "Error Detail: {{details}}",
            editTitle: "Edit Name",
            saveButton: "Save",
            noDescription: "No description",
            toggleTitle: "Enable/Disable Addon",
            configureTitle: "Configure Addon",
            copyTitle: "Copy Manifest URL",
            moveTopTitle: "Move to Top",
            moveBottomTitle: "Move to Bottom",
            moveUpTitle: "Move Up",
            moveDownTitle: "Move Down",
            removeTitle: "Remove",
            removeConfirm: "Are you sure you want to remove \"{{name}}\"?",
            renameSuccess: "Name updated. Click SAVE.",
            updateUrlSuccess: "URL and Manifest updated. Click SAVE.", // <-- RIGA AGGIUNTA
            updateUrlError: "New URL invalid: {{message}}", // <-- RIGA AGGIUNTA
            addSuccess: "Addon \"{{name}}\" added! Click SAVE.",
            removeSuccess: "Addon removed. Click SAVE.",
            copyUrlSuccess: "URL copied!",
            copyUrlError: "Could not copy URL.",
            statusCheck: "📡 Status check started.",
            statusCheckComplete: "📡 Check complete. {{errorCount}} errors found.",
            statusCheckError: "Check error: {{message}}",
            sessionRestored: "Session restored.",
            loginSuccess: "Login successful.",
            saveSuccess: "🎉 Order saved!",
            saveError: "Save failed: {{message}}",
            saving: "Saving...",
            addError: "Add error: {{message}}",
            monitorError: "MONITORING ERROR: {{message}}",
            monitorSuccess: "MONITORING: Data for {{email}} loaded.",
            exportError: "Error creating backup: {{message}}",
            exportSuccess: "Backup exported!",
            shareError: "Error creating link: {{message}}",
            shareGenerated: "Share link generated!",
            monitorModeActive: "Monitoring Mode Activated.",
            speedTestTitle: "Addon Speed Test",
            speedTestRunning: "Speed test running for {{name}}...",
            speedTestResult: "Test Result {{name}}: {{time}}ms",
            speedTestTimeout: "Test Failed {{name}}: Timeout (8s)",
            detailsTitle: "Show/Hide Details",
            details: {
                title: "Manifest Details",
                version: "Version",
                id: "ID",
                types: "Types",
                resources: "Resources",
                url: "Manifest URL"
            },
            autoUpdateDisabled: "Excluded from Auto Upd",
            autoUpdateEnabled: "Included in Auto Upd",
            disableAutoUpdateTitle: "Exclude from Automatic Update"
        },
        autoUpdate: {
            title: "Automatic Update",
            description: "If enabled, will check for new addon versions nightly at 3:00 AM and save them automatically.",
            toggleTitle: "Enable/Disable automatic update",
            forceButton: "Force Update Now",
            running: "Update in progress...",
            enabled: "Automatic update Enabled.",
            disabled: "Automatic update Disabled.",
            foundChanges: "{{count}} updates found (failed: {{failed}}). Automatically saving...",
            noChanges: "No updates found (failed: {{failed}}).",
            lastCheck: "Last check"
        },
        bulkActions: {
            selected: "{{count}} Selected",
            enable: "🟢 Enable",
            disable: "🔴 Disable",
            remove: "🗑️ Remove",
            removeConfirm: "Are you sure you want to remove {{count}} selected addons?",
            selectAll: "Select All",
            deselectAll: "Deselect All",
            enabledSuccess: "Enabled {{count}} selected addons. Click Save.",
            disabledSuccess: "Disabled {{count}} selected addons. Click Save.",
            removeSuccess: "Removed {{count}} selected addons. Click Save.",
            noneToEnable: "No selected addons to enable.",
            noneToDisable: "No selected addons to disable."
        },
        stats: {
            title: "Statistics",
            total: "Total Addons",
            enabled: "Enabled",
            disabled: "Disabled",
            errors: "With Errors"
        },
        footer: {
            copyright: "© Stremio Console",
            skin: "Cyberpunk skin • by Luca",
            language: "Language",
            lightMode: "Light Mode",
            darkMode: "Dark Mode"
        },
        instructions: {
            title: "Instructions",
            disclaimer: {
                title: "DISCLAIMER",
                p1: "THIS APPLICATION IS AN UNOFFICIAL THIRD-PARTY TOOL. WE DO NOT ASSUME ANY RESPONSIBILITY FOR YOUR USE OF IT. USING THIS APP COULD POTENTIALLY CAUSE DAMAGE TO YOUR STREMIO ACCOUNT (e.g., loss of addon order or synchronization issues). USE IT AT YOUR OWN RISK. We are NOT affiliated with, endorsed by, or sponsored by Stremio."
            },
            login: {
                title: "Login and Monitoring",
                p1: "Enter your Stremio credentials. The app does not save your password; it generates and uses a temporary 'authKey'.",
                p2: "Click the title 5 times to unlock 'Monitoring Mode', useful for viewing another user's addon list (requires an administrative key).",
            },
            profiles: {
                title: "Profile Management",
                p1: "Save your logged-in session (Email and Authentication Key) locally for quick access without re-entering the password. Click on a profile name to rename it.",
            },
            list: {
                title: "Addon Management",
                p1: "Your list is saved locally (session) and is only synchronized with Stremio when you click 'Save Order'.",
                li1: "Drag addons (icon/name area) to change their order.",
                li2: "Order is crucial: addons at the top have priority in link resolution.",
                li3: "Click the pencil to rename an addon locally (the new name is saved on Stremio).",
                li4: "Use the switch to quickly enable/disable addons without removing them.",
                li5: "The ⚙️ icon appears only if the addon supports external configuration and opens the page in the browser.",
                li6: "The ⏱️ button runs a basic speed test to check the manifest response time.",
                li7: "The ► icon expands the manifest details (Version, ID, Types, Resources).",
                li8: "The **Lock** button (🔒/🔓) excludes/includes the addon from the nightly Automatic Update (if the global feature is active).",
            },
            bulk: {
                title: "Bulk Actions",
                p1: "Select one or more addons via the checkbox, then use the 'Enable', 'Disable', or 'Remove' buttons to apply the action to all selected items simultaneously.",
            },
            status: {
                title: "Status Check",
                p1: "Click 'Check Addon Status' to verify that the manifest URLs respond correctly (the status becomes 🟢 OK or 🔴 Error).",
            },
            backup: {
                title: "Backup and Import",
                p1: "Export a .json file to save your complete configuration (order, status, URL) to your computer.",
                p2: "Import a .json file to restore a previous configuration, overwriting the current one (confirmation required).",
                p3: "Export TXT List is useful for quickly sharing URLs.",
            },
            share: {
                title: "Share Link",
                p1: "Generate an encoded URL link. Anyone with this link can load your list (without credentials) directly into the Console app.",
            },
            autoUpdate: {
                title: "Automatic Update",
                p1: "The Automatic Update option performs a nightly check to find new versions of existing addon manifests.",
                p2: "If differences are found, the app automatically updates the manifest and saves it to Stremio, maintaining the order and local name unchanged.",
            },
            other: {
                title: "Important Notes",
                p1: "Changes (order, status, name) are temporary (only saved in history) until you click 'Save Order'.",
                p2: "Use the Undo and Redo buttons to browse the local changes history.",
                p3: "Monitoring Mode (Admin) cannot save changes.",
                p4: "The floating SAVE button only appears when you have unsaved changes (Chrome/Desktop).",
                p5: "All data, except interface preferences, is managed via Stremio's 'authKey'; if you log out, you must log in again.",
            }
        }
    },
    fr: {
        meta: { title: "StreamOrder ⚡ Console de Commande des Addons" },
        h1: "StreamOrder ⚡ Console de Commande des Addons",
        subtitle: {
            login: "Contrôlez le chaos. Dominez vos addons.", // 
            monitoring: "Mode de surveillance actif",
            loggedIn: "Console rapide pour gérer, ordonner et sauvegarder les addons",
            security: "Sécurisé : Votre mot de passe n'est jamais sauvegardé." // <-- AGGIUNGI QUESTA
        },
       welcome: {
            title: "Bienvenue sur la Console Addon!",
            panel_p1: "Votre centre de contrôle pour les addons Stremio.", 
            p1: "Configurez rapidement les options principales ou allez directement gérer votre liste.",
            autoUpdateTitle: "Mises à jour automatiques nocturnes",
            autoUpdateDesc: "Voulez-vous que la console vérifie et installe automatiquement les mises à jour des addons toutes les nuits à 3h00?",
            autoUpdateEnabled: "Activées",
            autoUpdateDisabled: "Désactivées",
            manageTitle: "Gérez Vos Addons",
            manageDesc: "Allez à la liste complète pour ajouter, supprimer, réordonner et configurer vos addons.",
            proceedButton: "Gérer les Addons"
        },
        profiles: {
            title: "Profils Sauvegardés",
            p1: "Sélectionnez un profil pour charger instantanément les identifiants et la session. Cliquez sur le nom pour renommer. (Données sauvegardées localement)",
            noProfiles: "Aucun profil sauvegardé.",
            manageTitle: "Gérer les Profils",
            saveButton: "Sauvegarder la Session comme Profil",
            saveSuccess: "Profil sauvegardé!",
            selectButton: "Charger",
            deleteConfirm: "Êtes-vous sûr de vouloir supprimer le profil '{{name}}'?",
            deleteSuccess: "Profil supprimé.",
            renameSuccess: "Profil renommé."
        },
        tour: {
            welcome: {
                title: "Bienvenue!",
                p1: "Ceci est votre console de commande personnelle pour Stremio.",
                p2: "Voulez-vous un rapide tour des fonctionnalités principales?",
                dontShowAgain: "Ne plus montrer",
                skipButton: "Passer",
                startButton: "Commencer le Tour"
            },
            steps: {
                s1: "Ceci est le titre. Cliquez 5 fois (lorsque déconnecté) pour le mode de surveillance secret.",
                s2: "Ici, vous voyez des statistiques rapides de vos addons: total, actifs et avec erreurs.",
                s3: "Collez une URL .../manifest.json ici pour ajouter un nouvel addon à votre liste.",
                s4: "Ceci est votre liste d'addons. Vous pouvez les réordonner, les activer ou les désactiver.",
                s5: "Sur bureau, vous pouvez faire glisser les addons de cette zone pour les réordonner rapidement.",
                s6: "Utilisez cet interrupteur pour activer ou désactiver un addon. Les changements ne sont pas définitifs tant que vous n'enregistrez pas.",
                s7: "Ceci est le bouton LE PLUS IMPORTANT. Cliquez pour sauvegarder toutes vos modifications (ordre, noms, statuts) sur Stremio.",
                s8: "Si vous avez des modifications non sauvegardées, ce bouton apparaîtra également. C'est un rappel pratique!"
            }
        },
      login: {
    title: "Connexion Utilisateur",
    emailPlaceholder: "E-mail Stremio",
    passwordPlaceholder: "Mot de passe Stremio",
    tokenPlaceholder: "Votre AuthKey (Token) Stremio", // <-- NUOVO
    useToken: "Connexion avec Token (AuthKey)",       // <-- NUOVO
    usePassword: "Connexion avec Email/Mot de passe", // <-- NUOVO
    button: "CONNEXION",
    loading: "Connexion en cours..."
},
        monitor: {
            title: "Mode de Surveillance",
            keyPlaceholder: "Votre Clé de Surveillance",
            emailPlaceholder: "E-mail de l'utilisateur à vérifier",
            button: "SURVEILLER UTILISATEUR",
            loading: "Surveillance en cours..."
        },
        list: {
            title: "Liste d'Addons ({{count}})",
            saveButton: "Sauvegarder l'Ordre et les Modifications sur Stremio",
            addPlaceholder: "Collez l'URL du manifeste de l'addon (https://.../manifest.json)",
            addButton: "Ajouter",
            checkStatusButton: "Vérifier le Statut des Addons",
            noResults: "Aucun addon ne correspond à votre recherche.",
            noAddons: "Aucun addon trouvé pour ce compte.",
            logoutButton: "DÉCONNEXION",
            logoutConfirm: "Vous avez des modifications non sauvegardées. Êtes-vous sûr de vouloir vous déconnecter?",
            refreshButton: "Actualiser la Liste",
            refreshSuccess: "Liste actualisée depuis le serveur!",
            refreshError: "Erreur d'actualisation: {{message}}"
        },
        backup: {
            title: "Gestion de la Sauvegarde",
            exportButton: "Exporter la Sauvegarde (.json)",
            importButton: "Importer la Sauvegarde (.json)",
            shareButton: "Partager la Configuration (URL)",
            exportTxtButton: "Exporter la Liste TXT",
            exportTxtSuccess: "Liste exportée en TXT!"
        },
        share: {
            title: "Lien de Partage Généré",
            copyButton: "Copier le Lien",
            copySuccess: "Lien copié dans le presse-papiers!"
        },
        import: {
            urlSuccess: "Configuration importée depuis l'URL! {{count}} addons chargés. Cliquez sur SAUVEGARDER.",
            urlErrorInvalid: "Données de configuration dans l'URL invalides ou corrompues.",
            fileSuccess: "Sauvegarde importée! {{count}} addons chargés. Cliquez sur SAUVEGARDER.",
            error: "Échec de l'importation: {{message}"
        },
        importConfirm: {
            title: "Confirmation d'Importation",
            p1: "Vous êtes sur le point d'écraser votre liste d'addons actuelle. Cette action est irréversible.",
            p2_file: "Chargement de cette configuration à partir d'un fichier.",
            p2_url: "Chargement de cette configuration à partir d'un lien partagé.",
            confirmButton: "Confirmer et Écraser",
            cancelButton: "Annuler"
        },
        search: {
            placeholder: "🔍 Rechercher un addon par nom...",
            toggleTitle: "Afficher/Masquer la recherche",
            resultsCount: "Affichage de {{shown}}/{{total}} addons"
        },
        actions: {
            undo: "Annuler la dernière action",
            undoLabel: "Annuler",
            redo: "Rétablir la dernière action",
            redoLabel: "Rétablir",
            undoPerformed: "↩️ Action annulée: {{action}}",
            redoPerformed: "↪️ Action rétablie: {{action}}",
            reordered: "Addons réordonnés (glisser-déposer)",
            renamed: "Renommé '{{oldName}}' en '{{newName}}'",
            added: "Addon '{{name}}' ajouté",
            removed: "Addon '{{name}}' supprimé",
            enabledAddon: "Addon '{{name}}' activé",
            disabledAddon: "Addon '{{name}}' désactivé",
            bulkEnabled: "Activé {{count}} addons par action groupée",
            bulkDisabled: "Désactivé {{count}} addons par action groupée",
            bulkRemoved: "Supprimé {{count}} addons par action groupée",
            imported: "Configuration importée ({{count}} addons)",
            excludedFromUpdate: "Exclu '{{name}}' de la Mise à jour automatique",
            includedInUpdate: "Inclus '{{name}}' dans la Mise à jour automatique"
        },
        filters: {
            all: "Tous",
            enabled: "Activés",
            disabled: "Désactivés",
            errors: "Avec Erreurs"
        },
        addon: {
            statusTitle: "Statut: {{status}}",
            errorDetailsTitle: "Détail de l'Erreur: {{details}}",
            editTitle: "Modifier le Nom",
            saveButton: "Sauvegarder",
            noDescription: "Aucune description",
            toggleTitle: "Activer/Désactiver l'Addon",
            configureTitle: "Configurer l'Addon",
            copyTitle: "Copier l'URL du Manifeste",
            moveTopTitle: "Déplacer en Haut",
            moveBottomTitle: "Déplacer en Bas",
            moveUpTitle: "Monter",
            moveDownTitle: "Descendre",
            removeTitle: "Supprimer",
            removeConfirm: "Êtes-vous sûr de vouloir supprimer \"{{name}}\"?",
            renameSuccess: "Nom mis à jour. Cliquez sur SAUVEGARDER.",
            updateUrlSuccess: "URL et Manifeste mis à jour. Cliquez sur SAUVEGARDER.", // <-- RIGA AGGIUNTA
            updateUrlError: "Nouvelle URL invalide : {{message}}", // <-- RIGA AGGIUNTA
            addSuccess: "Addon \"{{name}}\" ajouté! Cliquez sur SAUVEGARDER.",
            removeSuccess: "Addon supprimé. Cliquez sur SAUVEGARDER.",
            copyUrlSuccess: "URL copiée!",
            copyUrlError: "Impossible de copier l'URL.",
            statusCheck: "📡 Vérification du statut démarrée.",
            statusCheckComplete: "📡 Vérification terminée. {{errorCount}} erreurs trouvées.",
            statusCheckError: "Erreur de vérification: {{message}}",
            sessionRestored: "Session restaurée.",
            loginSuccess: "Connexion réussie.",
            saveSuccess: "🎉 Ordre sauvegardé!",
            saveError: "Échec de la sauvegarde: {{message}}",
            saving: "Sauvegarde en cours...",
            addError: "Erreur d'ajout: {{message}}",
            monitorError: "ERREUR DE SURVEILLANCE: {{message}}",
            monitorSuccess: "SURVEILLANCE: Données pour {{email}} chargées.",
            exportError: "Erreur lors de la création de la sauvegarde: {{message}}",
            exportSuccess: "Sauvegarde exportée!",
            shareError: "Erreur lors de la création du lien: {{message}}",
            shareGenerated: "Lien de partage généré!",
            monitorModeActive: "Mode de Surveillance Activé.",
            speedTestTitle: "Test de Vitesse Addon",
            speedTestRunning: "Test de vitesse en cours pour {{name}}...",
            speedTestResult: "Résultat du Test {{name}}: {{time}}ms",
            speedTestTimeout: "Échec du Test {{name}}: Délai d'attente (8s)",
            detailsTitle: "Afficher/Masquer les Détails",
            details: {
                title: "Détails du Manifeste",
                version: "Version",
                id: "ID",
                types: "Types",
                resources: "Ressources",
                url: "URL du Manifeste"
            },
            autoUpdateDisabled: "Exclu de la M.à.j Auto",
            autoUpdateEnabled: "Inclus dans la M.à.j Auto",
            disableAutoUpdateTitle: "Exclure de la Mise à jour automatique"
        },
        autoUpdate: {
            title: "Mise à jour automatique",
            description: "Si activé, recherchera de nouvelles versions des addons toutes les nuits à 3h00 et les enregistrera automatiquement.",
            toggleTitle: "Activer/Désactiver la mise à jour automatique",
            forceButton: "Forcer la Mise à Jour Maintenant",
            running: "Mise à jour en cours...",
            enabled: "Mise à jour automatique Activée.",
            disabled: "Mise à jour automatique Désactivée.",
            foundChanges: "{{count}} mises à jour trouvées (échecs: {{failed}}). Sauvegarde automatique...",
            noChanges: "Aucune mise à jour trouvée (échecs: {{failed}}).",
            lastCheck: "Dernière vérification"
        },
        bulkActions: {
            selected: "{{count}} Sélectionnés",
            enable: "🟢 Activer",
            disable: "🔴 Désactiver",
            remove: "🗑️ Supprimer",
            removeConfirm: "Êtes-vous sûr de vouloir supprimer {{count}} addons sélectionnés?",
            selectAll: "Sélectionner Tout",
            deselectAll: "Désélectionner Tout",
            enabledSuccess: "Activé {{count}} addons sélectionnés. Cliquez sur Sauvegarder.",
            disabledSuccess: "Désactivé {{count}} addons sélectionnés. Cliquez sur Sauvegarder.",
            removeSuccess: "Supprimé {{count}} addons sélectionnés. Cliquez sur Sauvegarder.",
            noneToEnable: "Aucun addon sélectionné à activer.",
            noneToDisable: "Aucun addon sélectionné à désactiver."
        },
        stats: {
            title: "Statistiques",
            total: "Total Addons",
            enabled: "Activés",
            disabled: "Désactivés",
            errors: "Avec Erreurs"
        },
        footer: {
            copyright: "© Stremio Console",
            skin: "Cyberpunk skin • par Luca",
            language: "Langue",
            lightMode: "Mode Clair",
            darkMode: "Mode Sombre"
        },
        instructions: {
            title: "Instructions",
            disclaimer: {
                title: "AVERTISSEMENT (DISCLAIMER)",
                p1: "CETTE APPLICATION EST UN OUTIL TIERS NON OFFICIEL. NOUS N'ASSUMONS AUCUNE RESPONSABILITÉ QUANT À VOTRE UTILISATION. L'UTILISATION DE CETTE APP PEUT POTENTIELLEMENT ENDOMMAGER VOTRE COMPTE STREMIO (par ex. perte de l'ordre des addons ou problèmes de synchronisation). UTILISEZ-LA À VOS PROPRES RISQUES. Nous ne sommes NI affiliés, ni approuvés, ni sponsorisés par Stremio."
            },
            login: {
                title: "Connexion et Surveillance",
                p1: "Entrez vos identifiants Stremio. L'application ne sauvegarde pas votre mot de passe ; elle génère et utilise une 'authKey' temporaire.",
                p2: "Cliquez 5 fois sur le titre pour débloquer le 'Mode de surveillance', utile pour voir la liste d'addons d'un autre utilisateur (requiert une clé admin).",
            },
            profiles: {
                title: "Gestion des profils",
                p1: "Sauvegardez localement votre session connectée (Email et Clé d'authentification) pour un accès rapide sans resaisir le mot de passe. Cliquez sur le nom d'un profil pour le renommer.",
            },
            list: {
                title: "Gestion des Addons",
                p1: "Votre liste est sauvegardée localement (session) et n'est synchronisée avec Stremio que lorsque vous cliquez sur 'Sauvegarder l'ordre'.",
                li1: "Glissez les addons (zone icône/nom) pour changer leur ordre.",
                li2: "L'ordre est crucial : les addons en haut ont la priorité pour la résolution des liens.",
                li3: "Cliquez sur le crayon pour renommer un addon localement (le nouveau nom est sauvegardé sur Stremio).",
                li4: "Utilisez l'interrupteur pour activer/désactiver rapidement les addons sans les supprimer.",
                li5: "L'icône ⚙️ n'apparaît que si l'addon supporte la configuration externe et ouvre la page dans le navigateur.",
                li6: "Le bouton ⏱️ effectue un test de vitesse de base pour vérifier le temps de réponse du manifeste.",
                li7: "L'icône ► déplie les détails du manifeste (Version, ID, Types, Ressources).",
                li8: "Le bouton **Cadenas** (🔒/🔓) exclut/inclut l'addon de la mise à jour automatique nocturne (si la fonction globale est active).",
            },
            bulk: {
                title: "Actions groupées",
                p1: "Sélectionnez un ou plusieurs addons via la case à cocher, puis utilisez les boutons 'Activer', 'Désactiver' ou 'Supprimer' pour appliquer l'action à tous les éléments sélectionnés.",
            },
            status: {
                title: "Vérification du statut",
                p1: "Cliquez sur 'Vérifier le statut des Addons' pour contrôler si les URL des manifestes répondent correctement (le statut devient 🟢 OK ou 🔴 Erreur).",
            },
            backup: {
                title: "Sauvegarde et Importation",
                p1: "Exportez un fichier .json pour sauvegarder votre configuration complète (ordre, statut, URL) sur votre ordinateur.",
                p2: "Importez un fichier .json pour restaurer une configuration précédente, écrasant l'actuelle (confirmation requise).",
                p3: "Exporter la liste TXT est utile pour un partage rapide des URL.",
            },
            share: {
                title: "Lien de partage",
                p1: "Génère un lien URL codé. Toute personne disposant de ce lien peut charger votre liste (sans identifiants) directement dans l'app Console.",
            },
            autoUpdate: {
                title: "Mise à jour automatique",
                p1: "L'option de mise à jour automatique effectue une vérification nocturne pour trouver de nouvelles versions des manifestes des addons existants.",
                p2: "Si des différences sont trouvées, l'app met à jour automatiquement le manifeste et le sauvegarde sur Stremio, en conservant l'ordre et le nom local inchangés.",
            },
            other: {
                title: "Notes importantes",
                p1: "Les modifications (ordre, statut, nom) sont temporaires (sauvegardées uniquement dans l'historique) jusqu'à ce que vous cliquiez 'Sauvegarder l'ordre'.",
                p2: "Utilisez les boutons Annuler et Rétablir pour naviguer dans l'historique des modifications locales.",
                p3: "Le Mode de surveillance (Admin) ne peut pas sauvegarder les modifications.",
                p4: "Le bouton SAUVEGARDER flottant n'apparaît que lorsque vous avez des modifications non sauvegardées (Chrome/Desktop).",
                p5: "Toutes les données, sauf les préférences d'interface, sont gérées via 'l'authKey' de Stremio ; si vous vous déconnectez, vous devez vous reconnecter.",
            }
        }
    },
    de: {
        meta: { title: "StreamOrder ⚡ Addon-Befehlskonsole" },
        h1: "StreamOrder ⚡ Addon-Befehlskonsole",
       subtitle: {
            login: "Kontrolliere das Chaos. Beherrsche deine Addons.",
            monitoring: "Überwachungsmodus aktiv",
            loggedIn: "Schnellkonsole zum Verwalten, Sortieren und Speichern von Addons",
            security: "Sicher: Ihr Passwort wird niemals gespeichert." // <-- AGGIUNGI QUESTA
        },
       welcome: {
            title: "Willkommen zur Addon-Konsole!",
            panel_p1: "Deine Kontrollzentrale für Stremio-Addons..", 
            p1: "Konfigurieren Sie schnell die wichtigsten Optionen oder gehen Sie direkt zur Verwaltung Ihrer Liste.",
            autoUpdateTitle: "Nächtliche automatische Updates",
            autoUpdateDesc: "Möchten Sie, dass die Konsole Addon-Updates jede Nacht um 3:00 Uhr automatisch prüft und installiert?",
            autoUpdateEnabled: "Aktiviert",
            autoUpdateDisabled: "Deaktiviert",
            manageTitle: "Verwalten Sie Ihre Addons",
            manageDesc: "Gehen Sie zur vollständigen Liste, um Ihre Addons hinzuzufügen, zu entfernen, neu anzuordnen und zu konfigurieren.",
            proceedButton: "Addons verwalten"
        },
        profiles: {
            title: "Gespeicherte Profile",
            p1: "Wählen Sie ein Profil, um Zugangsdaten und Sitzung sofort zu laden. Klicken Sie auf den Namen, um ihn umzubenennen. (Daten lokal gespeichert)",
            noProfiles: "Keine Profile gespeichert.",
            manageTitle: "Profile verwalten",
            saveButton: "Sitzung als Profil speichern",
            saveSuccess: "Profil gespeichert!",
            selectButton: "Laden",
            deleteConfirm: "Sind Sie sicher, dass Sie das Profil '{{name}}' löschen möchten?",
            deleteSuccess: "Profil gelöscht.",
            renameSuccess: "Profil umbenannt."
        },
        tour: {
            welcome: {
                title: "Willkommen!",
                p1: "Dies ist Ihre persönliche Befehlskonsole für Stremio.",
                p2: "Möchten Sie einen kurzen Überblick über die Hauptfunktionen?",
                dontShowAgain: "Nicht mehr anzeigen",
                skipButton: "Überspringen",
                startButton: "Tour starten"
            },
            steps: {
                s1: "Dies ist der Titel. Klicken Sie 5 Mal (wenn Sie ausgeloggt sind), um den geheimen Überwachungsmodus zu aktivieren.",
                s2: "Hier sehen Sie schnelle Statistiken Ihrer Addons: Gesamt, aktiv und mit Fehlern.",
                s3: "Fügen Sie hier eine .../manifest.json URL ein, um ein neues Addon zu Ihrer Liste hinzuzufügen.",
                s4: "Dies ist Ihre Addon-Liste. Sie können sie neu anordnen, aktivieren oder deaktivieren.",
                s5: "Auf dem Desktop können Sie Addons von diesem Bereich ziehen, um sie schnell neu anzuordnen.",
                s6: "Verwenden Sie diesen Schalter, um ein Addon zu aktivieren oder deaktivieren. Änderungen sind erst endgültig, wenn Sie speichern.",
                s7: "Dies ist der WICHTIGSTE Button. Klicken Sie hier, um alle Ihre Änderungen (Reihenfolge, Namen, Status) in Stremio zu speichern.",
                s8: "Wenn Sie ungespeicherte Änderungen haben, erscheint auch dieser Button. Eine nützliche Erinnerung!"
            }
        },
       login: {
    title: "Benutzer-Login",
    emailPlaceholder: "Stremio E-Mail",
    passwordPlaceholder: "Stremio Passwort",
    tokenPlaceholder: "Dein Stremio AuthKey (Token)", // <-- NUOVO
    useToken: "Mit Token (AuthKey) anmelden",         // <-- NUOVO
    usePassword: "Mit E-Mail/Passwort anmelden",     // <-- NUOVO
    button: "EINLOGGEN",
    loading: "Wird eingeloggt..."
},
        monitor: {
            title: "Überwachungsmodus",
            keyPlaceholder: "Ihr Überwachungsschlüssel",
            emailPlaceholder: "E-Mail des zu prüfenden Benutzers",
            button: "BENUTZER ÜBERWACHEN",
            loading: "Wird überwacht..."
        },
        list: {
            title: "Addon-Liste ({{count}})",
            saveButton: "Reihenfolge und Änderungen in Stremio speichern",
            addPlaceholder: "Addon-Manifest-URL einfügen (https://.../manifest.json)",
            addButton: "Hinzufügen",
            checkStatusButton: "Addon-Status prüfen",
            noResults: "Keine Addons entsprechen Ihrer Suche.",
            noAddons: "Keine Addons für dieses Konto gefunden.",
            logoutButton: "AUSLOGGEN",
            logoutConfirm: "Sie haben ungespeicherte Änderungen. Sind Sie sicher, dass Sie sich ausloggen möchten?",
            refreshButton: "Liste aktualisieren",
            refreshSuccess: "Liste vom Server aktualisiert!",
            refreshError: "Aktualisierungsfehler: {{message}}"
        },
        backup: {
            title: "Sicherungsverwaltung",
            exportButton: "Sicherung exportieren (.json)",
            importButton: "Sicherung importieren (.json)",
            shareButton: "Konfiguration teilen (URL)",
            exportTxtButton: "TXT-Liste exportieren",
            exportTxtSuccess: "Liste als TXT exportiert!"
        },
        share: {
            title: "Teil-Link generiert",
            copyButton: "Link kopieren",
            copySuccess: "Link in die Zwischenablage kopiert!"
        },
        import: {
            urlSuccess: "Konfiguration von URL importiert! {{count}} Addons geladen. Klicken Sie auf SPEICHERN.",
            urlErrorInvalid: "Ungültige oder beschädigte Konfigurationsdaten in der URL.",
            fileSuccess: "Sicherung importiert! {{count}} Addons geladen. Klicken Sie auf SPEICHERN.",
            error: "Import fehlgeschlagen: {{message}"
        },
        importConfirm: {
            title: "Importbestätigung",
            p1: "Sie sind dabei, Ihre aktuelle Addon-Liste zu überschreiben. Diese Aktion kann nicht rückgängig gemacht werden.",
            p2_file: "Diese Konfiguration wird aus einer Datei geladen.",
            p2_url: "Diese Konfiguration wird von einem geteilten Link geladen.",
            confirmButton: "Bestätigen und Überschreiben",
            cancelButton: "Abbrechen"
        },
        search: {
            placeholder: "🔍 Addon nach Name suchen...",
            toggleTitle: "Suche anzeigen/ausblenden",
            resultsCount: "Zeige {{shown}}/{{total}} Addons"
        },
        actions: {
            undo: "Letzte Aktion rückgängig machen",
            undoLabel: "Rückgängig",
            redo: "Letzte Aktion wiederherstellen",
            redoLabel: "Wiederholen",
            undoPerformed: "↩️ Aktion rückgängig gemacht: {{action}}",
            redoPerformed: "↪️ Aktion wiederhergestellt: {{action}}",
            reordered: "Addons neu angeordnet (Drag & Drop)",
            renamed: "Umbenannt von '{{oldName}}' in '{{newName}}'",
            added: "Addon '{{name}}' hinzugefügt",
            removed: "Addon '{{name}}' entfernt",
            enabledAddon: "Addon '{{name}}' aktiviert",
            disabledAddon: "Addon '{{name}}' deaktiviert",
            bulkEnabled: "{{count}} Addons per Massenaktion aktiviert",
            bulkDisabled: "{{count}} Addons per Massenaktion deaktiviert",
            bulkRemoved: "{{count}} Addons per Massenaktion entfernt",
            imported: "Konfiguration importiert ({{count}} Addons)",
            excludedFromUpdate: "Addon '{{name}}' von Auto-Update ausgeschlossen",
            includedInUpdate: "Addon '{{name}}' in Auto-Update eingeschlossen"
        },
        filters: {
            all: "Alle",
            enabled: "Aktiviert",
            disabled: "Deaktiviert",
            errors: "Mit Fehlern"
        },
        addon: {
            statusTitle: "Status: {{status}}",
            errorDetailsTitle: "Fehlerdetails: {{details}}",
            editTitle: "Namen bearbeiten",
            saveButton: "Speichern",
            noDescription: "Keine Beschreibung",
            toggleTitle: "Addon aktivieren/deaktivieren",
            configureTitle: "Addon konfigurieren",
            copyTitle: "Manifest-URL kopieren",
            moveTopTitle: "Nach oben verschieben",
            moveBottomTitle: "Nach unten verschieben",
            moveUpTitle: "Nach oben",
            moveDownTitle: "Nach unten",
            removeTitle: "Entfernen",
            removeConfirm: "Sind Sie sicher, dass Sie \"{{name}}\" entfernen möchten?",
            renameSuccess: "Name aktualisiert. Klicken Sie auf SPEICHERN.",
            updateUrlSuccess: "URL und Manifest aktualisiert. Klicken Sie auf SPEICHERN.", // <-- RIGA AGGIUNTA
            updateUrlError: "Neue URL ungültig: {{message}}", // <-- RIGA AGGIUNTA
            addSuccess: "Addon \"{{name}}\" hinzugefügt! Klicken Sie auf SPEICHERN.",
            removeSuccess: "Addon entfernt. Klicken Sie auf SPEICHERN.",
            copyUrlSuccess: "URL kopiert!",
            copyUrlError: "URL konnte nicht kopiert werden.",
            statusCheck: "📡 Statusprüfung gestartet.",
            statusCheckComplete: "📡 Prüfung abgeschlossen. {{errorCount}} Fehler gefunden.",
            statusCheckError: "Prüfungsfehler: {{message}}",
            sessionRestored: "Sitzung wiederhergestellt.",
            loginSuccess: "Anmeldung erfolgreich.",
            saveSuccess: "🎉 Reihenfolge gespeichert!",
            saveError: "Speichern fehlgeschlagen: {{message}}",
            saving: "Wird gespeichert...",
            addError: "Hinzufügefehler: {{message}}",
            monitorError: "ÜBERWACHUNGSFEHLER: {{message}}",
            monitorSuccess: "ÜBERWACHUNG: Daten für {{email}} geladen.",
            exportError: "Fehler beim Erstellen der Sicherung: {{message}}",
            exportSuccess: "Sicherung exportiert!",
            shareError: "Fehler beim Erstellen des Links: {{message}}",
            shareGenerated: "Teil-Link generiert!",
            monitorModeActive: "Überwachungsmodus aktiviert.",
            speedTestTitle: "Addon-Geschwindigkeitstest",
            speedTestRunning: "Geschwindigkeitstest läuft für {{name}}...",
            speedTestResult: "Testergebnis {{name}}: {{time}}ms",
            speedTestTimeout: "Test fehlgeschlagen {{name}}: Timeout (8s)",
            detailsTitle: "Details anzeigen/ausblenden",
            details: {
                title: "Manifest-Details",
                version: "Version",
                id: "ID",
                types: "Typen",
                resources: "Ressourcen",
                url: "Manifest-URL"
            },
            autoUpdateDisabled: "Von Auto-Update ausgeschlossen",
            autoUpdateEnabled: "In Auto-Update eingeschlossen",
            disableAutoUpdateTitle: "Von der automatischen Aktualisierung ausschließen"
        },
        autoUpdate: {
            title: "Automatische Aktualisierung",
            description: "Wenn aktiviert, wird jede Nacht um 3:00 Uhr nach neuen Addon-Versionen gesucht und diese automatisch gespeichert.",
            toggleTitle: "Automatische Aktualisierung aktivieren/deaktivieren",
            forceButton: "Aktualisierung jetzt erzwingen",
            running: "Aktualisierung läuft...",
            enabled: "Automatische Aktualisierung aktiviert.",
            disabled: "Automatische Aktualisierung deaktiviert.",
            foundChanges: "{{count}} Updates gefunden (fehlgeschlagen: {{failed}}). Wird automatisch gespeichert...",
            noChanges: "Keine Updates gefunden (fehlgeschlagen: {{failed}}).",
            lastCheck: "Letzte Prüfung"
        },
        bulkActions: {
            selected: "{{count}} ausgewählt",
            enable: "🟢 Aktivieren",
            disable: "🔴 Deaktivieren",
            remove: "🗑️ Entfernen",
            removeConfirm: "Sind Sie sicher, dass Sie {{count}} ausgewählte Addons entfernen möchten?",
            selectAll: "Alle auswählen",
            deselectAll: "Alle abwählen",
            enabledSuccess: "{{count}} ausgewählte Addons aktiviert. Klicken Sie auf Speichern.",
            disabledSuccess: "{{count}} ausgewählte Addons deaktiviert. Klicken Sie auf Speichern.",
            removeSuccess: "{{count}} ausgewählte Addons entfernt. Klicken Sie auf Speichern.",
            noneToEnable: "Keine ausgewählten Addons zum Aktivieren.",
            noneToDisable: "Keine ausgewählten Addons zum Deaktivieren."
        },
        stats: {
            title: "Statistiken",
            total: "Gesamt-Addons",
            enabled: "Aktiviert",
            disabled: "Deaktiviert",
            errors: "Mit Fehlern"
        },
        footer: {
            copyright: "© Stremio Console",
            skin: "Cyberpunk skin • von Luca",
            language: "Sprache",
            lightMode: "Heller Modus",
            darkMode: "Dunkler Modus"
        },
        instructions: {
            title: "Anweisungen",
            disclaimer: {
                title: "HAFTUNGSAUSSCHLUSS (DISCLAIMER)",
                p1: "DIESE ANWENDUNG IST EIN INOFFIZIELLES DRITTANBIETER-TOOL. WIR ÜBERNEHMEN KEINE VERANTWORTUNG FÜR IHRE NUTZUNG. DIE VERWENDUNG DIESER APP KANN POTENZIELL SCHÄDEN AN IHREM STREMIO-KONTO VERURSACHEN (z.B. Verlust der Addon-Reihenfolge oder Synchronisationsprobleme). DIE NUTZUNG ERFOLGT AUF EIGENE GEFAHR. Wir sind NICHT mit Stremio verbunden, werden nicht von Stremio unterstützt oder gesponsert."
            },
            login: {
                title: "Anmeldung und Überwachung",
                p1: "Geben Sie Ihre Stremio-Anmeldedaten ein. Die App speichert Ihr Passwort nicht; sie generiert und verwendet einen temporären 'authKey'.",
                p2: "Klicken Sie 5 Mal auf den Titel, um den 'Überwachungsmodus' freizuschalten, nützlich, um die Addon-Liste eines anderen Benutzers anzuzeigen (erfordert einen Admin-Schlüssel).",
            },
            profiles: {
                title: "Profilverwaltung",
                p1: "Speichern Sie Ihre angemeldete Sitzung (E-Mail und Authentifizierungsschlüssel) lokal für einen schnellen Zugriff, ohne das Passwort erneut eingeben zu müssen. Klicken Sie auf einen Profilnamen, um ihn umzubenennen.",
            },
            list: {
                title: "Addon-Verwaltung",
                p1: "Ihre Liste wird lokal (Sitzung) gespeichert und nur mit Stremio synchronisiert, wenn Sie auf 'Reihenfolge speichern' klicken.",
                li1: "Ziehen Sie Addons (Icon/Namensbereich), um ihre Reihenfolge zu ändern.",
                li2: "Die Reihenfolge ist entscheidend: Addons an der Spitze haben Priorität bei der Link-Auflösung.",
                li3: "Klicken Sie auf den Stift, um ein Addon lokal umzubenennen (der neue Name wird in Stremio gespeichert).",
                li4: "Verwenden Sie den Schalter, um Addons schnell zu aktivieren/deaktivieren, ohne sie zu entfernen.",
                li5: "Das ⚙️-Symbol erscheint nur, wenn das Addon externe Konfiguration unterstützt und öffnet die Seite im Browser.",
                li6: "Der ⏱️-Button führt einen einfachen Geschwindigkeitstest durch, um die Antwortzeit des Manifests zu prüfen.",
                li7: "Das ►-Symbol erweitert die Manifest-Details (Version, ID, Typen, Ressourcen).",
                li8: "Der **Schloss**-Button (🔒/🔓) schließt das Addon vom nächtlichen automatischen Update aus/ein (sofern die globale Funktion aktiv ist).",
            },
            bulk: {
                title: "Massenaktionen",
                p1: "Wählen Sie ein oder mehrere Addons über das Kontrollkästchen aus und verwenden Sie dann die 'Aktivieren'-, 'Deaktivieren'- oder 'Entfernen'-Buttons, um die Aktion auf alle ausgewählten anzuwenden.",
            },
            status: {
                title: "Statusprüfung",
                p1: "Klicken Sie auf 'Addon-Status prüfen', um zu verifizieren, ob die Manifest-URLs korrekt antworten (der Status wird 🟢 OK oder 🔴 Fehler).",
            },
            backup: {
                title: "Sicherung und Import",
                p1: "Exportieren Sie eine .json-Datei, um Ihre vollständige Konfiguration (Reihenfolge, Status, URL) auf Ihrem Computer zu speichern.",
                p2: "Importieren Sie eine .json-Datei, um eine frühere Konfiguration wiederherzustellen, wobei die aktuelle überschrieben wird (Bestätigung erforderlich).",
                p3: "TXT-Liste exportieren ist nützlich, um URLs schnell zu teilen.",
            },
            share: {
                title: "Teil-Link",
                p1: "Erzeugt einen kodierten URL-Link. Jeder mit diesem Link kann Ihre Liste (ohne Anmeldedaten) direkt in die Konsolen-App laden.",
            },
            autoUpdate: {
                title: "Automatische Aktualisierung",
                p1: "Die Option 'Automatische Aktualisierung' führt eine nächtliche Prüfung durch, um neue Versionen bestehender Addon-Manifeste zu finden.",
                p2: "Wenn Unterschiede gefunden werden, aktualisiert die App das Manifest automatisch und speichert es in Stremio, wobei Reihenfolge und lokaler Name unverändert bleiben.",
            },
            other: {
                title: "Wichtige Hinweise",
                p1: "Änderungen (Reihenfolge, Status, Name) sind temporär (nur im Verlauf gespeichert), bis Sie auf 'Reihenfolge speichern' klicken.",
                p2: "Verwenden Sie die 'Rückgängig'- und 'Wiederholen'-Buttons, um den lokalen Änderungsverlauf zu durchsuchen.",
                p3: "Der Überwachungsmodus (Admin) kann keine Änderungen speichern.",
                p4: "Der schwebende 'SPEICHERN'-Button erscheint nur, wenn Sie ungespeicherte Änderungen haben (Chrome/Desktop).",
                p5: "Alle Daten, außer den Oberflächeneinstellungen, werden über den 'authKey' von Stremio verwaltet; wenn Sie sich ausloggen, müssen Sie sich erneut anmelden.",
            }
        }
    },
    es: {
        meta: { title: "StreamOrder ⚡ Consola de Comando de Addons" },
        h1: "StreamOrder ⚡ Consola de Comando de Addons",
        subtitle: {
            login: "Controla el caos. Domina tus addons.",
            monitoring: "Modo de monitorización activo",
            loggedIn: "Consola rápida para gestionar, ordenar y guardar addons",
            security: "Seguro: Tu contraseña nunca se guarda." // <-- AGGIUNGI QUESTA
        },
        welcome: {
            title: "¡Bienvenido a la Consola de Addons!",
            panel_p1: "Tu centro de control para addons de Stremio.", 
            p1: "Configura rápidamente las opciones principales o ve directamente a gestionar tu lista.",
            autoUpdateTitle: "Actualizaciones Automáticas Nocturnas",
            autoUpdateDesc: "¿Quieres que la consola compruebe e instale automáticamente las actualizaciones de los addons cada noche a las 3:00?",
            autoUpdateEnabled: "Activadas",
            autoUpdateDisabled: "Desactivadas",
            manageTitle: "Gestiona tus Addons",
            manageDesc: "Ve a la lista completa para añadir, eliminar, reordenar y configurar tus addons.",
            proceedButton: "Gestionar Addons"
        },
        profiles: {
            title: "Perfiles Guardados",
            p1: "Selecciona un perfil para cargar instantáneamente las credenciales y la sesión. Haz clic en el nombre para renombrar. (Datos guardados localmente)",
            noProfiles: "No hay perfiles guardados.",
            manageTitle: "Gestionar Perfiles",
            saveButton: "Guardar Sesión como Perfil",
            saveSuccess: "¡Perfil guardado!",
            selectButton: "Cargar",
            deleteConfirm: "¿Estás seguro de que quieres eliminar el perfil '{{name}}'?",
            deleteSuccess: "Perfil eliminado.",
            renameSuccess: "Perfil renombrado."
        },
        tour: {
            welcome: {
                title: "¡Bienvenido!",
                p1: "Esta es tu consola de comandos personal para Stremio.",
                p2: "¿Te gustaría un tour rápido por las características principales?",
                dontShowAgain: "No mostrar de nuevo",
                skipButton: "Saltar",
                startButton: "Iniciar Tour"
            },
            steps: {
                s1: "Este es el título. Haz clic 5 veces (sin iniciar sesión) para el modo de monitorización secreto.",
                s2: "Aquí ves estadísticas rápidas de tus addons: total, activos y con errores.",
                s3: "Pega una URL de .../manifest.json aquí para añadir un nuevo addon a tu lista.",
                s4: "Esta es tu lista de addons. Puedes reordenarlos, activarlos o desactivarlos.",
                s5: "En el escritorio, puedes arrastrar los addons desde esta área para reordenarlos rápidamente.",
                s6: "Usa este interruptor para activar o desactivar un addon. Los cambios no son definitivos hasta que guardes.",
                s7: "Este es el botón MÁS IMPORTANTE. Haz clic para guardar todos tus cambios (orden, nombres, estados) en Stremio.",
                s8: "Si tienes cambios sin guardar, este botón también aparecerá. ¡Es un recordatorio útil!"
            }
        },
      login: {
    title: "Inicio de Sesión de Usuario",
    emailPlaceholder: "E-mail de Stremio",
    passwordPlaceholder: "Contraseña de Stremio",
    tokenPlaceholder: "Tu AuthKey (Token) de Stremio", // <-- NUOVO
    useToken: "Iniciar sesión con Token (AuthKey)",   // <-- NUOVO
    usePassword: "Iniciar sesión con Email/Contraseña", // <-- NUOVO
    button: "INICIAR SESIÓN",
    loading: "Iniciando sesión..."
},
        monitor: {
            title: "Modo de Monitorización",
            keyPlaceholder: "Tu Clave de Monitorización",
            emailPlaceholder: "E-mail del usuario a comprobar",
            button: "MONITORIZAR USUARIO",
            loading: "Monitorizando..."
        },
        list: {
            title: "Lista de Addons ({{count}})",
            saveButton: "Guardar Orden y Cambios en Stremio",
            addPlaceholder: "Pega la URL del manifiesto del addon (https://.../manifest.json)",
            addButton: "Añadir",
            checkStatusButton: "Comprobar Estado de Addons",
            noResults: "Ningún addon coincide con tu búsqueda.",
            noAddons: "No se encontraron addons para esta cuenta.",
            logoutButton: "CERRAR SESIÓN",
            logoutConfirm: "Tienes cambios sin guardar. ¿Estás seguro de que quieres cerrar sesión?",
            refreshButton: "Actualizar Lista",
            refreshSuccess: "¡Lista actualizada desde el servidor!",
            refreshError: "Error de actualización: {{message}}"
        },
        backup: {
            title: "Gestión de Copias de Seguridad",
            exportButton: "Exportar Copia (.json)",
            importButton: "Importar Copia (.json)",
            shareButton: "Compartir Configuración (URL)",
            exportTxtButton: "Exportar Lista TXT",
            exportTxtSuccess: "¡Lista exportada como TXT!"
        },
        share: {
            title: "Enlace para Compartir Generado",
            copyButton: "Copiar Enlace",
            copySuccess: "¡Enlace copiado al portapapeles!"
        },
        import: {
            urlSuccess: "¡Configuración importada desde URL! {{count}} addons cargados. Haz clic en GUARDAR.",
            urlErrorInvalid: "Datos de configuración en la URL no válidos o corruptos.",
            fileSuccess: "¡Copia de seguridad importada! {{count}} addons cargados. Haz clic en GUARDAR.",
            error: "Importación fallida: {{message}"
        },
        importConfirm: {
            title: "Confirmación de Importación",
            p1: "Estás a punto de sobrescribir tu lista de addons actual. Esta acción no se puede deshacer.",
            p2_file: "Cargando esta configuración desde un archivo.",
            p2_url: "Cargando esta configuración desde una URL compartida.",
            confirmButton: "Confirmar y Sobrescribir",
            cancelButton: "Cancelar"
        },
        search: {
            placeholder: "🔍 Buscar addon por nombre...",
            toggleTitle: "Mostrar/Ocultar búsqueda",
            resultsCount: "Mostrando {{shown}}/{{total}} addons"
        },
        actions: {
            undo: "Deshacer última acción",
            undoLabel: "Deshacer",
            redo: "Rehacer última acción",
            redoLabel: "Rehacer",
            undoPerformed: "↩️ Acción deshecha: {{action}}",
            redoPerformed: "↪️ Acción rehecha: {{action}}",
            reordered: "Addons reordenados (arrastrar y soltar)",
            renamed: "Renombrado '{{oldName}}' a '{{newName}}'",
            added: "Añadido addon '{{name}}'",
            removed: "Eliminado addon '{{name}}'",
            enabledAddon: "Activado addon '{{name}}'",
            disabledAddon: "Desactivado addon '{{name}}'",
            bulkEnabled: "Activados {{count}} addons mediante acción masiva",
            bulkDisabled: "Desactivados {{count}} addons mediante acción masiva",
            bulkRemoved: "Eliminados {{count}} addons mediante acción masiva",
            imported: "Configuración importada ({{count}} addons)",
            excludedFromUpdate: "Excluido '{{name}}' de la Actualización Automática",
            includedInUpdate: "Incluido '{{name}}' en la Actualización Automática"
        },
        filters: {
            all: "Todos",
            enabled: "Activados",
            disabled: "Desactivados",
            errors: "Con Errores"
        },
        addon: {
            statusTitle: "Estado: {{status}}",
            errorDetailsTitle: "Detalle del Error: {{details}}",
            editTitle: "Editar Nombre",
            saveButton: "Guardar",
            noDescription: "Sin descripción",
            toggleTitle: "Activar/Desactivar Addon",
            configureTitle: "Configurar Addon",
            copyTitle: "Copiar URL del Manifiesto",
            moveTopTitle: "Mover al Principio",
            moveBottomTitle: "Mover al Final",
            moveUpTitle: "Mover Arriba",
            moveDownTitle: "Mover Abajo",
            removeTitle: "Eliminar",
            removeConfirm: "¿Estás seguro de que quieres eliminar \"{{name}}\"?",
            renameSuccess: "Nombre actualizado. Haz clic en GUARDAR.",
            updateUrlSuccess: "URL y Manifiesto actualizados. Haz clic en GUARDAR.", // <-- RIGA AGGIUNTA
            updateUrlError: "Nueva URL no válida: {{message}}", // <-- RIGA AGGIUNTA
            addSuccess: "¡Addon \"{{name}}\" añadido! Haz clic en GUARDAR.",
            removeSuccess: "Addon eliminado. Haz clic en GUARDAR.",
            copyUrlSuccess: "¡URL copiada!",
            copyUrlError: "No se pudo copiar la URL.",
            statusCheck: "📡 Comprobación de estado iniciada.",
            statusCheckComplete: "📡 Comprobación completa. Se encontraron {{errorCount}} errores.",
            statusCheckError: "Error de comprobación: {{message}}",
            sessionRestored: "Sesión restaurada.",
            loginSuccess: "Inicio de sesión exitoso.",
            saveSuccess: "🎉 ¡Orden guardado!",
            saveError: "Error al guardar: {{message}}",
            saving: "Guardando...",
            addError: "Error al añadir: {{message}}",
            monitorError: "ERROR DE MONITORIZACIÓN: {{message}}",
            monitorSuccess: "MONITORIZACIÓN: Datos de {{email}} cargados.",
            exportError: "Error al crear la copia de seguridad: {{message}}",
            exportSuccess: "¡Copia de seguridad exportada!",
            shareError: "Error al crear el enlace: {{message}}",
            shareGenerated: "¡Enlace para compartir generado!",
            monitorModeActive: "Modo de Monitorización Activado.",
            speedTestTitle: "Prueba de Velocidad del Addon",
            speedTestRunning: "Prueba de velocidad en curso para {{name}}...",
            speedTestResult: "Resultado de la prueba {{name}}: {{time}}ms",
            speedTestTimeout: "Prueba fallida {{name}}: Timeout (8s)",
            detailsTitle: "Mostrar/Ocultar Detalles",
            details: {
                title: "Detalles del Manifiesto",
                version: "Versión",
                id: "ID",
                types: "Tipos",
                resources: "Recursos",
                url: "URL del Manifiesto"
            },
            autoUpdateDisabled: "Excluido de Act. Auto",
            autoUpdateEnabled: "Incluido en Act. Auto",
            disableAutoUpdateTitle: "Excluir de la Actualización Automática"
        },
        autoUpdate: {
            title: "Actualización Automática",
            description: "Si está activado, buscará nuevas versiones de los addons cada noche a las 3:00 AM y las guardará automáticamente.",
            toggleTitle: "Activar/Desactivar actualización automática",
            forceButton: "Forzar Actualización Ahora",
            running: "Actualización en curso...",
            enabled: "Actualización automática Activada.",
            disabled: "Actualización automática Desactivada.",
            foundChanges: "Se encontraron {{count}} actualizaciones (fallidas: {{failed}}). Guardando automáticamente...",
            noChanges: "No se encontraron actualizaciones (fallidas: {{failed}}).",
            lastCheck: "Última comprobación"
        },
        bulkActions: {
            selected: "{{count}} Seleccionados",
            enable: "🟢 Activar",
            disable: "🔴 Desactivar",
            remove: "🗑️ Eliminar",
            removeConfirm: "¿Estás seguro de que quieres eliminar {{count}} addons seleccionados?",
            selectAll: "Seleccionar Todos",
            deselectAll: "Deseleccionar Todos",
            enabledSuccess: "Activados {{count}} addons seleccionados. Haz clic en Guardar.",
            disabledSuccess: "Desactivados {{count}} addons seleccionados. Haz clic en Guardar.",
            removeSuccess: "Eliminados {{count}} addons seleccionados. Haz clic en Guardar.",
            noneToEnable: "No hay addons seleccionados para activar.",
            noneToDisable: "No hay addons seleccionados para desactivar."
        },
        stats: {
            title: "Estadísticas",
            total: "Total Addons",
            enabled: "Activados",
            disabled: "Desactivados",
            errors: "Con Errores"
        },
        footer: {
            copyright: "© Stremio Console",
            skin: "Cyberpunk skin • por Luca",
            language: "Idioma",
            lightMode: "Modo Claro",
            darkMode: "Modo Oscuro"
        },
        instructions: {
            title: "Instrucciones",
            disclaimer: {
                title: "DESCARGO DE RESPONSABILIDAD (DISCLAIMER)",
                p1: "ESTA APLICACIÓN ES UNA HERRAMIENTA DE TERCEROS NO OFICIAL. NO ASUMIMOS NINGUNA RESPONSABILIDAD POR SU USO. USAR ESTA APLICACIÓN PODRÍA CAUSAR DAÑOS A SU CUENTA DE STREMIO (p. ej., pérdida del orden de los addons o problemas de sincronización). ÚSELA BAJO SU PROPIO RIESGO. NO estamos afiliados, respaldados ni patrocinados por Stremio."
            },
            login: {
                title: "Inicio de Sesión y Monitorización",
                p1: "Introduce tus credenciales de Stremio. La aplicación no guarda tu contraseña; genera y utiliza una 'authKey' temporal.",
                p2: "Haz clic en el título 5 veces para desbloquear el 'Modo de Monitorización', útil para ver la lista de addons de otro usuario (requiere una clave administrativa).",
            },
            profiles: {
                title: "Gestión de Perfiles",
                p1: "Guarda tu sesión iniciada (Email y Clave de Autenticación) localmente para un acceso rápido sin volver a introducir la contraseña. Haz clic en el nombre de un perfil para renombrarlo.",
            },
            list: {
                title: "Gestión de Addons",
                p1: "Tu lista se guarda localmente (sesión) y solo se sincroniza con Stremio cuando haces clic en 'Guardar Orden'.",
                li1: "Arrastra los addons (área del icono/nombre) para cambiar su orden.",
                li2: "El orden es crucial: los addons en la parte superior tienen prioridad en la resolución de enlaces.",
                li3: "Haz clic en el lápiz para renombrar un addon localmente (el nuevo nombre se guarda en Stremio).",
                li4: "Usa el interruptor para activar/desactivar rápidamente los addons sin eliminarlos.",
                li5: "El icono ⚙️ solo aparece si el addon admite configuración externa y abre la página en el navegador.",
                li6: "El botón ⏱️ ejecuta una prueba de velocidad básica para verificar el tiempo de respuesta del manifiesto.",
                li7: "El icono ► expande los detalles del manifiesto (Versión, ID, Tipos, Recursos).",
                li8: "El botón de **Candado** (🔒/🔓) excluye/incluye el addon de la Actualización Automática nocturna (si la función global está activa).",
            },
            bulk: {
                title: "Acciones Masivas",
                p1: "Selecciona uno o más addons mediante la casilla de verificación, luego usa los botones 'Activar', 'Desactivar' o 'Eliminar' para aplicar la acción a todos los seleccionados simultáneamente.",
            },
            status: {
                title: "Comprobación de Estado",
                p1: "Haz clic en 'Comprobar Estado de Addons' para verificar que las URL del manifiesto responden correctamente (el estado se convierte en 🟢 OK o 🔴 Error).",
            },
            backup: {
                title: "Copia de Seguridad e Importación",
                p1: "Exporta un archivo .json para guardar tu configuración completa (orden, estado, URL) en tu ordenador.",
                p2: "Importa un archivo .json para restaurar una configuración anterior, sobrescribiendo la actual (se requiere confirmación).",
                p3: "Exportar Lista TXT es útil para compartir rápidamente las URL.",
            },
            share: {
                title: "Enlace para Compartir",
                p1: "Genera un enlace URL codificado. Cualquiera con este enlace puede cargar tu lista (sin credenciales) directamente en la app de la Consola.",
            },
            autoUpdate: {
                title: "Actualización Automática",
                p1: "La opción de Actualización Automática realiza una comprobación nocturna para encontrar nuevas versiones de los manifiestos de los addons existentes.",
                p2: "Si se encuentran diferencias, la app actualiza automáticamente el manifiesto y lo guarda en Stremio, manteniendo el orden y el nombre local sin cambios.",
            },
            other: {
                title: "Notas Importantes",
                p1: "Los cambios (orden, estado, nombre) son temporales (solo se guardan en el historial) hasta que haces clic en 'Guardar Orden'.",
                p2: "Usa los botones Deshacer y Rehacer para navegar por el historial de cambios locales.",
                p3: "El Modo de Monitorización (Admin) no puede guardar cambios.",
                p4: "El botón GUARDAR flotante solo aparece cuando tienes cambios sin guardar (Chrome/Desktop).",
                p5: "Todos los datos, excepto las preferencias de la interfaz, se gestionan a través de la 'authKey' de Stremio; si cierras sesión, debes iniciar sesión de nuevo.",
            }
        }
    },
    uk: {
        meta: { title: "StreamOrder ⚡ Консоль керування додатками" },
        h1: "StreamOrder ⚡ Консоль керування додатками",
        subtitle: {
            login: "Контролюй хаос. Пануй над своїми додатками.",
            monitoring: "Режим моніторингу активний",
            loggedIn: "Швидка консоль для керування, сортування та збереження додатків",
            security: "Безпечно: Ваш пароль ніколи не зберігається." // <-- AGGIUNGI QUESTA
        },
        welcome: {
            title: "Ласкаво просимо до Консолі Додатків!",
            panel_p1: "Ваш центр керування додатками Stremio.",
            p1: "Швидко налаштуйте основні опції або перейдіть безпосередньо до керування списком.",
            autoUpdateTitle: "Нічні автоматичні оновлення",
            autoUpdateDesc: "Бажаєте, щоб консоль автоматично перевіряла та встановлювала оновлення додатків щоночі о 3:00?",
            autoUpdateEnabled: "Увімкнено",
            autoUpdateDisabled: "Вимкнено",
            manageTitle: "Керування вашими додатками",
            manageDesc: "Перейдіть до повного списку, щоб додавати, видаляти, змінювати порядок та налаштовувати ваші додатки.",
            proceedButton: "Керувати додатками"
        },
        profiles: {
            title: "Збережені профілі",
            p1: "Виберіть профіль, щоб миттєво завантажити дані для входу та сесію. Натисніть на ім'я, щоб перейменувати. (Дані зберігаються локально)",
            noProfiles: "Немає збережених профілів.",
            manageTitle: "Керування профілями",
            saveButton: "Зберегти сесію як профіль",
            saveSuccess: "Профіль збережено!",
            selectButton: "Завантажити",
            deleteConfirm: "Ви впевнені, що хочете видалити профіль '{{name}}'?",
            deleteSuccess: "Профіль видалено.",
            renameSuccess: "Профіль перейменовано."
        },
        tour: {
            welcome: {
                title: "Ласкаво просимо!",
                p1: "Це ваша особиста командна консоль для Stremio.",
                p2: "Бажаєте швидкий огляд основних функцій?",
                dontShowAgain: "Більше не показувати",
                skipButton: "Пропустити",
                startButton: "Почати тур"
            },
            steps: {
                s1: "Це заголовок. Натисніть на нього 5 разів (коли ви не в системі), щоб увійти в секретний режим моніторингу.",
                s2: "Тут ви бачите швидку статистику ваших додатків: загальна кількість, активні та з помилками.",
                s3: "Вставте сюди URL-адресу .../manifest.json, щоб додати новий додаток до вашого списку.",
                s4: "Це ваш список додатків. Ви можете змінювати їх порядок, вмикати або вимикати.",
                s5: "На комп'ютері ви можете перетягувати додатки з цієї області, щоб швидко змінювати їх порядок.",
                s6: "Використовуйте цей перемикач, щоб увімкнути або вимкнути додаток. Зміни не є остаточними, доки ви не збережете.",
                s7: "Це НАЙВАЖЛИВІША кнопка. Натисніть її, щоб зберегти всі ваші зміни (порядок, назви, статуси) у Stremio.",
                s8: "Якщо у вас є незбережені зміни, ця кнопка також з'явиться. Це зручне нагадування!"
            }
        },
      login: {
    title: "Вхід користувача",
    emailPlaceholder: "E-mail Stremio",
    passwordPlaceholder: "Пароль Stremio",
    tokenPlaceholder: "Ваш AuthKey (Токен) Stremio", // <-- NUOVO
    useToken: "Увійти з Токеном (AuthKey)",       // <-- NUOVO
    usePassword: "Увійти з Email/Паролем",      // <-- NUOVO
    button: "УВІЙТИ",
    loading: "Вхід..."
},
        monitor: {
            title: "Режим моніторингу",
            keyPlaceholder: "Ваш ключ моніторингу",
            emailPlaceholder: "E-mail користувача для перевірки",
            button: "МОНІТОРИНГ КОРИСТУВАЧА",
            loading: "Моніторинг..."
        },
        list: {
            title: "Список додатків ({{count}})",
            saveButton: "Зберегти порядок та зміни у Stremio",
            addPlaceholder: "Вставте URL-адресу маніфесту додатка (https://.../manifest.json)",
            addButton: "Додати",
            checkStatusButton: "Перевірити статус додатків",
            noResults: "Немає додатків, що відповідають вашому пошуку.",
            noAddons: "Для цього облікового запису не знайдено додатків.",
            logoutButton: "ВИЙТИ",
            logoutConfirm: "У вас є незбережені зміни. Ви впевнені, що хочете вийти?",
            refreshButton: "Оновити список",
            refreshSuccess: "Список оновлено з сервера!",
            refreshError: "Помилка оновлення: {{message}}"
        },
        backup: {
            title: "Керування резервними копіями",
            exportButton: "Експортувати резервну копію (.json)",
            importButton: "Імпортувати резервну копію (.json)",
            shareButton: "Поділитися конфігурацією (URL)",
            exportTxtButton: "Експортувати список TXT",
            exportTxtSuccess: "Список експортовано як TXT!"
        },
        share: {
            title: "Згенеровано посилання для поширення",
            copyButton: "Копіювати посилання",
            copySuccess: "Посилання скопійовано в буфер обміну!"
        },
        import: {
            urlSuccess: "Конфігурацію імпортовано з URL! {{count}} додатків завантажено. Натисніть ЗБЕРЕГТИ.",
            urlErrorInvalid: "Недійсні або пошкоджені дані конфігурації в URL.",
            fileSuccess: "Резервну копію імпортовано! {{count}} додатків завантажено. Натисніть ЗБЕРЕГТИ.",
            error: "Помилка імпорту: {{message}"
        },
        importConfirm: {
            title: "Підтвердження імпорту",
            p1: "Ви збираєтеся перезаписати поточний список додатків. Цю дію не можна скасувати.",
            p2_file: "Завантаження цієї конфігурації з файлу.",
            p2_url: "Завантаження цієї конфігурації з URL-адреси для поширення.",
            confirmButton: "Підтвердити та перезаписати",
            cancelButton: "Скасувати"
        },
        search: {
            placeholder: "🔍 Пошук додатка за назвою...",
            toggleTitle: "Показати/Сховати пошук",
            resultsCount: "Показано {{shown}}/{{total}} додатків"
        },
        actions: {
            undo: "Скасувати останню дію",
            undoLabel: "Скасувати",
            redo: "Повторити останню дію",
            redoLabel: "Повторити",
            undoPerformed: "↩️ Дію скасовано: {{action}}",
            redoPerformed: "↪️ Дію повторено: {{action}}",
            reordered: "Порядок додатків змінено (перетягування)",
            renamed: "Перейменовано '{{oldName}}' на '{{newName}}'",
            added: "Додано додаток '{{name}}'",
            removed: "Видалено додаток '{{name}}'",
            enabledAddon: "Увімкнено додаток '{{name}}'",
            disabledAddon: "Вимкнено додаток '{{name}}'",
            bulkEnabled: "Увімкнено {{count}} додатків через групову дію",
            bulkDisabled: "Вимкнено {{count}} додатків через групову дію",
            bulkRemoved: "Видалено {{count}} додатків через групову дію",
            imported: "Імпортовано конфігурацію ({{count}} додатків)",
            excludedFromUpdate: "Виключено '{{name}}' з автооновлення",
            includedInUpdate: "Включено '{{name}}' до автооновлення"
        },
        filters: {
            all: "Всі",
            enabled: "Увімкнені",
            disabled: "Вимкнені",
            errors: "З помилками"
        },
        addon: {
            statusTitle: "Статус: {{status}}",
            errorDetailsTitle: "Деталі помилки: {{details}}",
            editTitle: "Редагувати назву",
            saveButton: "Зберегти",
            noDescription: "Немає опису",
            toggleTitle: "Увімкнути/Вимкнути додаток",
            configureTitle: "Налаштувати додаток",
            copyTitle: "Копіювати URL маніфесту",
            moveTopTitle: "Перемістити вгору",
            moveBottomTitle: "Перемістити вниз",
            moveUpTitle: "Вгору",
            moveDownTitle: "Вниз",
            removeTitle: "Видалити",
            removeConfirm: "Ви впевнені, що хочете видалити \"{{name}}\"?",
            renameSuccess: "Назву оновлено. Натисніть ЗБЕРЕГТИ.",
            updateUrlSuccess: "URL та Маніфест оновлено. Натисніть ЗБЕРЕГТИ.", // <-- RIGA AGGIUNTA
            updateUrlError: "Нова URL-адреса недійсна: {{message}}", // <-- RIGA AGGIUNTA
            addSuccess: "Додаток \"{{name}}\" додано! Натисніть ЗБЕРЕГТИ.",
            removeSuccess: "Додаток видалено. Натисніть ЗБЕРЕГТИ.",
            copyUrlSuccess: "URL скопійовано!",
            copyUrlError: "Не вдалося скопіювати URL.",
            statusCheck: "📡 Перевірка статусу розпочата.",
            statusCheckComplete: "📡 Перевірку завершено. Знайдено {{errorCount}} помилок.",
            statusCheckError: "Помилка перевірки: {{message}}",
            sessionRestored: "Сесію відновлено.",
            loginSuccess: "Вхід успішний.",
            saveSuccess: "🎉 Порядок збережено!",
            saveError: "Помилка збереження: {{message}}",
            saving: "Збереження...",
            addError: "Помилка додавання: {{message}}",
            monitorError: "ПОМИЛКА МОНІТОРИНГУ: {{message}}",
            monitorSuccess: "МОНІТОРИНГ: Дані для {{email}} завантажено.",
            exportError: "Помилка створення резервної копії: {{message}}",
            exportSuccess: "Резервну копію експортовано!",
            shareError: "Помилка створення посилання: {{message}}",
            shareGenerated: "Посилання для поширення згенеровано!",
            monitorModeActive: "Режим моніторингу активовано.",
            speedTestTitle: "Тест швидкості додатка",
            speedTestRunning: "Триває тест швидкості для {{name}}...",
            speedTestResult: "Результат тесту {{name}}: {{time}}мс",
            speedTestTimeout: "Тест не вдався {{name}}: Час очікування (8с)",
            detailsTitle: "Показати/Сховати деталі",
            details: {
                title: "Деталі маніфесту",
                version: "Версія",
                id: "ID",
                types: "Типи",
                resources: "Ресурси",
                url: "URL маніфесту"
            },
            autoUpdateDisabled: "Виключено з автооновлення",
            autoUpdateEnabled: "Включено до автооновлення",
            disableAutoUpdateTitle: "Виключити з автоматичного оновлення"
        },
        autoUpdate: {
            title: "Автоматичне оновлення",
            description: "Якщо увімкнено, буде перевіряти нові версії додатків щоночі о 3:00 та автоматично їх зберігати.",
            toggleTitle: "Увімкнути/Вимкнути автоматичне оновлення",
            forceButton: "Примусово оновити зараз",
            running: "Оновлення триває...",
            enabled: "Автоматичне оновлення увімкнено.",
            disabled: "Автоматичне оновлення вимкнено.",
            foundChanges: "Знайдено {{count}} оновлень (невдалих: {{failed}}). Автоматичне збереження...",
            noChanges: "Оновлень не знайдено (невдалих: {{failed}}).",
            lastCheck: "Остання перевірка"
        },
        bulkActions: {
            selected: "{{count}} вибрано",
            enable: "🟢 Увімкнути",
            disable: "🔴 Вимкнути",
            remove: "🗑️ Видалити",
            removeConfirm: "Ви впевнені, що хочете видалити {{count}} вибраних додатків?",
            selectAll: "Вибрати все",
            deselectAll: "Зняти вибір з усього",
            enabledSuccess: "Увімкнено {{count}} вибраних додатків. Натисніть Зберегти.",
            disabledSuccess: "Вимкнено {{count}} вибраних додатків. Натисніть Зберегти.",
            removeSuccess: "Видалено {{count}} вибраних додатків. Натисніть Зберегти.",
            noneToEnable: "Немає вибраних додатків для увімкнення.",
            noneToDisable: "Немає вибраних додатків для вимкнення."
        },
        stats: {
            title: "Статистика",
            total: "Всього додатків",
            enabled: "Увімкнені",
            disabled: "Вимкнені",
            errors: "З помилками"
        },
        footer: {
            copyright: "© Stremio Console",
            skin: "Cyberpunk скін • від Luca",
            language: "Мова",
            lightMode: "Світлий режим",
            darkMode: "Темний режим"
        },
        instructions: {
            title: "Інструкції",
            disclaimer: {
                title: "ВІДМОВА ВІД ВІДПОВІДАЛЬНОСТІ (DISCLAIMER)",
                p1: "ЦЕЙ ДОДАТОК Є НЕОФІЦІЙНИМ ІНСТРУМЕНТОМ ВІД ТРЕТІХ ОСІБ. МИ НЕ НЕСЕМО ЖОДНОЇ ВІДПОВІДАЛЬНОСТІ ЗА ЙОГО ВИКОРИСТАННЯ. ВИКОРИСТАННЯ ЦЬОГО ДОДАТКА МОЖЕ ПОТЕНЦІЙНО ЗАШКОДИТИ ВАШОМУ ОБЛІКОВОМУ ЗАПИСУ STREMIO (наприклад, втрата порядку додатків або проблеми з синхронізацією). ВИКОРИСТОВУЙТЕ НА СВІЙ СТРАХ І РИЗИК. Ми НЕ є афілійованими, схваленими або спонсорованими Stremio."
            },
            login: {
                title: "Вхід та моніторинг",
                p1: "Введіть ваші облікові дані Stremio. Додаток не зберігає ваш пароль; він генерує та використовує тимчасовий 'authKey'.",
                p2: "Натисніть на заголовок 5 разів, щоб розблокувати 'Режим моніторингу', корисний для перегляду списку додатків іншого користувача (потрібен адміністративний ключ).",
            },
            profiles: {
                title: "Керування профілями",
                p1: "Збережіть вашу сесію (Email та ключ автентифікації) локально для швидкого доступу без повторного введення пароля. Натисніть на назву профілю, щоб її змінити.",
            },
            list: {
                title: "Керування додатками",
                p1: "Ваш список зберігається локально (у сесії) і синхронізується зі Stremio лише після натискання 'Зберегти порядок'.",
                li1: "Перетягуйте додатки (область іконки/назви), щоб змінити їх порядок.",
                li2: "Порядок є вирішальним: додатки вгорі мають пріоритет у resolving посилань.",
                li3: "Натисніть на олівець, щоб перейменувати додаток локально (нова назва зберігається в Stremio).",
                li4: "Використовуйте перемикач, щоб швидко вмикати/вимикати додатки, не видаляючи їх.",
                li5: "Іконка ⚙️ з'являється, лише якщо додаток підтримує зовнішню конфігурацію, і відкриває сторінку в браузері.",
                li6: "Кнопка ⏱️ запускає базовий тест швидкості для перевірки часу відповіді маніфесту.",
                li7: "Іконка ► розгортає деталі маніфесту (Версія, ID, Типи, Ресурси).",
                li8: "Кнопка **Замок** (🔒/🔓) виключає/включає додаток з нічного автоматичного оновлення (якщо глобальна функція активна).",
            },
            bulk: {
                title: "Групові дії",
                p1: "Виберіть один або кілька додатків за допомогою прапорця, а потім використовуйте кнопки 'Увімкнути', 'Вимкнути' або 'Видалити', щоб застосувати дію до всіх вибраних елементів одночасно.",
            },
            status: {
                title: "Перевірка статусу",
                p1: "Натисніть 'Перевірити статус додатків', щоб перевірити, чи правильно відповідають URL-адреси маніфестів (статус стане 🟢 OK або 🔴 Помилка).",
            },
            backup: {
                title: "Резервне копіювання та імпорт",
                p1: "Експортуйте файл .json, щоб зберегти повну конфігурацію (порядок, статус, URL) на вашому комп'ютері.",
                p2: "Імпортуйте файл .json, щоб відновити попередню конфігурацію, перезаписавши поточну (потрібне підтвердження).",
                p3: "Експорт списку TXT корисний для швидкого обміну URL-адресами.",
            },
            share: {
                title: "Посилання для поширення",
                p1: "Створює закодоване посилання URL. Будь-хто, хто має це посилання, може завантажити ваш список (без облікових даних) безпосередньо в додаток Консолі.",
            },
            autoUpdate: {
                title: "Автоматичне оновлення",
                p1: "Опція автоматичного оновлення виконує нічну перевірку для пошуку нових версій існуючих маніфестів додатків.",
                p2: "Якщо знайдено відмінності, додаток автоматично оновлює маніфест і зберігає його в Stremio, зберігаючи порядок та локальну назву незмінними.",
            },
            other: {
                title: "Важливі примітки",
                p1: "Зміни (порядок, статус, назва) є тимчасовими (зберігаються лише в історії), доки ви не натиснете 'Зберегти порядок'.",
                p2: "Використовуйте кнопки Скасувати та Повторити для перегляду історії локальних змін.",
                p3: "Режим моніторингу (Адмін) не може зберігати зміни.",
                p4: "Плаваюча кнопка ЗБЕРЕГТИ з'являється лише тоді, коли у вас є незбережені зміни (Chrome/Desktop).",
                p5: "Усі дані, крім налаштувань інтерфейсу, керуються через 'authKey' Stremio; якщо ви вийдете з системи, вам доведеться увійти знову.",
            }
        }
    },
    pt: {
        meta: { title: "StreamOrder ⚡ Console de Comando de Addons" },
        h1: "StreamOrder ⚡ Console de Comando de Addons",
       subtitle: {
            login: "Controle o caos. Domine os seus addons.",
            monitoring: "Modo de Monitoramento Ativo",
            loggedIn: "Console rápido para gerenciar, ordenar e salvar addons",
            security: "Seguro: Sua senha nunca é salva." // <-- AGGIUNGI QUESTA
        },
        welcome: {
            title: "Bem-vindo ao Console de Addons!",
            panel_p1: "Seu centro de controle para addons Stremio.",
            p1: "Configure rapidamente as opções principais ou vá direto para o gerenciamento da sua lista.",
            autoUpdateTitle: "Atualizações Automáticas Noturnas",
            autoUpdateDesc: "Você quer que o console verifique e instale atualizações de addons automaticamente todas as noites às 3:00?",
            autoUpdateEnabled: "Ativado",
            autoUpdateDisabled: "Desativado",
            manageTitle: "Gerencie Seus Addons",
            manageDesc: "Vá para a lista completa para adicionar, remover, reordenar e configurar seus addons.",
            proceedButton: "Gerenciar Addons"
        },
        profiles: {
            title: "Perfis Salvos",
            p1: "Selecione um perfil para carregar instantaneamente as credenciais e a sessão. Clique no nome para renomear. (Dados salvos localmente)",
            noProfiles: "Nenhum perfil salvo.",
            manageTitle: "Gerenciar Perfis",
            saveButton: "Salvar Sessão como Perfil",
            saveSuccess: "Perfil salvo!",
            selectButton: "Carregar",
            deleteConfirm: "Tem certeza de que deseja excluir o perfil '{{name}}'?",
            deleteSuccess: "Perfil excluído.",
            renameSuccess: "Perfil renomeado."
        },
        tour: {
            welcome: {
                title: "Bem-vindo!",
                p1: "Este é o seu console de comando pessoal para o Stremio.",
                p2: "Gostaria de um tour rápido pelas principais funcionalidades?",
                dontShowAgain: "Não mostrar novamente",
                skipButton: "Pular",
                startButton: "Iniciar Tour"
            },
            steps: {
                s1: "Este é o título. Clique 5 vezes (quando desconectado) para o modo de monitoramento secreto.",
                s2: "Aqui você vê estatísticas rápidas dos seus addons: total, ativos e com erros.",
                s3: "Cole uma URL de .../manifest.json aqui para adicionar um novo addon à sua lista.",
                s4: "Esta é a sua lista de addons. Você pode reordená-los, ativá-los ou desativá-los.",
                s5: "No desktop, você pode arrastar os addons desta área para reordená-los rapidamente.",
                s6: "Use este interruptor para ativar ou desativar um addon. As alterações não são finais até que você salve.",
                s7: "Este é o botão MAIS IMPORTANTE. Clique nele para salvar todas as suas alterações (ordem, nomes, status) no Stremio.",
                s8: "Se você tiver alterações não salvas, este botão também aparecerá. É um lembrete útil!"
            }
        },
     login: {
    title: "Login de Usuário",
    emailPlaceholder: "E-mail do Stremio",
    passwordPlaceholder: "Senha do Stremio",
    tokenPlaceholder: "Seu AuthKey (Token) do Stremio", // <-- NUOVO
    useToken: "Login com Token (AuthKey)",             // <-- NUOVO
    usePassword: "Login com Email/Senha",              // <-- NUOVO
    button: "LOGIN",
    loading: "Fazendo login..."
},
        monitor: {
            title: "Modo de Monitoramento",
            keyPlaceholder: "Sua Chave de Monitoramento",
            emailPlaceholder: "E-mail do usuário a ser verificado",
            button: "MONITORAR USUÁRIO",
            loading: "Monitorando..."
        },
        list: {
            title: "Lista de Addons ({{count}})",
            saveButton: "Salvar Ordem e Alterações no Stremio",
            addPlaceholder: "Cole a URL do manifesto do addon (https://.../manifest.json)",
            addButton: "Adicionar",
            checkStatusButton: "Verificar Status dos Addons",
            noResults: "Nenhum addon corresponde à sua pesquisa.",
            noAddons: "Nenhum addon encontrado para esta conta.",
            logoutButton: "LOGOUT",
            logoutConfirm: "Você tem alterações não salvas. Tem certeza de que deseja sair?",
            refreshButton: "Atualizar Lista",
            refreshSuccess: "Lista atualizada do servidor!",
            refreshError: "Erro na atualização: {{message}}"
        },
        backup: {
            title: "Gerenciamento de Backup",
            exportButton: "Exportar Backup (.json)",
            importButton: "Importar Backup (.json)",
            shareButton: "Compartilhar Configuração (URL)",
            exportTxtButton: "Exportar Lista TXT",
            exportTxtSuccess: "Lista exportada como TXT!"
        },
        share: {
            title: "Link de Compartilhamento Gerado",
            copyButton: "Copiar Link",
            copySuccess: "Link copiado para a área de transferência!"
        },
        import: {
            urlSuccess: "Configuração importada da URL! {{count}} addons carregados. Clique em SALVAR.",
            urlErrorInvalid: "Dados de configuração na URL inválidos ou corrompidos.",
            fileSuccess: "Backup importado! {{count}} addons carregados. Clique em SALVAR.",
            error: "Falha na importação: {{message}"
        },
        importConfirm: {
            title: "Confirmação de Importação",
            p1: "Você está prestes a substituir sua lista de addons atual. Esta ação não pode ser desfeita.",
            p2_file: "Carregando esta configuração de um arquivo.",
            p2_url: "Carregando esta configuração de uma URL de compartilhamento.",
            confirmButton: "Confirmar e Substituir",
            cancelButton: "Cancelar"
        },
        search: {
            placeholder: "🔍 Pesquisar addon por nome...",
            toggleTitle: "Mostrar/Ocultar pesquisa",
            resultsCount: "Mostrando {{shown}}/{{total}} addons"
        },
        actions: {
            undo: "Desfazer última ação",
            undoLabel: "Desfazer",
            redo: "Refazer última ação",
            redoLabel: "Refazer",
            undoPerformed: "↩️ Ação desfeita: {{action}}",
            redoPerformed: "↪️ Ação refeita: {{action}}",
            reordered: "Addons reordenados (arrastar e soltar)",
            renamed: "Renomeado '{{oldName}}' para '{{newName}}'",
            added: "Adicionado addon '{{name}}'",
            removed: "Removido addon '{{name}}'",
            enabledAddon: "Ativado addon '{{name}}'",
            disabledAddon: "Desativado addon '{{name}}'",
            bulkEnabled: "Ativados {{count}} addons via ação em massa",
            bulkDisabled: "Desativados {{count}} addons via ação em massa",
            bulkRemoved: "Removidos {{count}} addons via ação em massa",
            imported: "Configuração importada ({{count}} addons)",
            excludedFromUpdate: "Excluído '{{name}}' da Atualização Automática",
            includedInUpdate: "Incluído '{{name}}' na Atualização Automática"
        },
        filters: {
            all: "Todos",
            enabled: "Ativados",
            disabled: "Desativados",
            errors: "Com Erros"
        },
        addon: {
            statusTitle: "Status: {{status}}",
            errorDetailsTitle: "Detalhe do Erro: {{details}}",
            editTitle: "Editar Nome",
            saveButton: "Salvar",
            noDescription: "Sem descrição",
            toggleTitle: "Ativar/Desativar Addon",
            configureTitle: "Configurar Addon",
            copyTitle: "Copiar URL do Manifesto",
            moveTopTitle: "Mover para o Topo",
            moveBottomTitle: "Mover para o Fim",
            moveUpTitle: "Mover para Cima",
            moveDownTitle: "Mover para Baixo",
            removeTitle: "Remover",
            removeConfirm: "Tem certeza de que deseja remover \"{{name}}\"?",
            renameSuccess: "Nome atualizado. Clique em SALVAR.",
            updateUrlSuccess: "URL e Manifesto atualizados. Clique em SALVAR.", // <-- RIGA AGGIUNTA
            updateUrlError: "Nova URL inválida: {{message}}", // <-- RIGA AGGIUNTA
            addSuccess: "Addon \"{{name}}\" adicionado! Clique em SALVAR.",
            removeSuccess: "Addon removido. Clique em SALVAR.",
            copyUrlSuccess: "URL copiada!",
            copyUrlError: "Não foi possível copiar a URL.",
            statusCheck: "📡 Verificação de status iniciada.",
            statusCheckComplete: "📡 Verificação concluída. {{errorCount}} erros encontrados.",
            statusCheckError: "Erro na verificação: {{message}}",
            sessionRestored: "Sessão restaurada.",
            loginSuccess: "Login bem-sucedido.",
            saveSuccess: "🎉 Ordem salva!",
            saveError: "Falha ao salvar: {{message}}",
            saving: "Salvando...",
            addError: "Erro ao adicionar: {{message}}",
            monitorError: "ERRO DE MONITORAMENTO: {{message}}",
            monitorSuccess: "MONITORAMENTO: Dados de {{email}} carregados.",
            exportError: "Erro ao criar backup: {{message}}",
            exportSuccess: "Backup exportado!",
            shareError: "Erro ao criar link: {{message}}",
            shareGenerated: "Link de compartilhamento gerado!",
            monitorModeActive: "Modo de Monitoramento Ativado.",
            speedTestTitle: "Teste de Velocidade do Addon",
            speedTestRunning: "Teste de velocidade em andamento para {{name}}...",
            speedTestResult: "Resultado do Teste {{name}}: {{time}}ms",
            speedTestTimeout: "Falha no Teste {{name}}: Timeout (8s)",
            detailsTitle: "Mostrar/Ocultar Detalhes",
            details: {
                title: "Detalhes do Manifesto",
                version: "Versão",
                id: "ID",
                types: "Tipos",
                resources: "Recursos",
                url: "URL do Manifesto"
            },
            autoUpdateDisabled: "Excluído da At. Auto",
            autoUpdateEnabled: "Incluído na At. Auto",
            disableAutoUpdateTitle: "Excluir da Atualização Automática"
        },
        autoUpdate: {
            title: "Atualização Automática",
            description: "Se ativado, verificará novas versões dos addons todas as noites às 3:00 e as salvará automaticamente.",
            toggleTitle: "Ativar/Desativar atualização automática",
            forceButton: "Forçar Atualização Agora",
            running: "Atualização em andamento...",
            enabled: "Atualização automática Ativada.",
            disabled: "Atualização automática Desativada.",
            foundChanges: "{{count}} atualizações encontradas (falhas: {{failed}}). Salvando automaticamente...",
            noChanges: "Nenhuma atualização encontrada (falhas: {{failed}}).",
            lastCheck: "Última verificação"
        },
        bulkActions: {
            selected: "{{count}} Selecionados",
            enable: "🟢 Ativar",
            disable: "🔴 Desativar",
            remove: "🗑️ Remover",
            removeConfirm: "Tem certeza de que deseja remover {{count}} addons selecionados?",
            selectAll: "Selecionar Todos",
            deselectAll: "Desmarcar Todos",
            enabledSuccess: "Ativados {{count}} addons selecionados. Clique em Salvar.",
            disabledSuccess: "Desativados {{count}} addons selecionados. Clique em Salvar.",
            removeSuccess: "Removidos {{count}} addons selecionados. Clique em Salvar.",
            noneToEnable: "Nenhum addon selecionado para ativar.",
            noneToDisable: "Nenhum addon selecionado para desativar."
        },
        stats: {
            title: "Estatísticas",
            total: "Total de Addons",
            enabled: "Ativados",
            disabled: "Desativados",
            errors: "Com Erros"
        },
        footer: {
            copyright: "© Stremio Console",
            skin: "Cyberpunk skin • por Luca",
            language: "Idioma",
            lightMode: "Modo Claro",
            darkMode: "Modo Escuro"
        },
        instructions: {
            title: "Instruções",
            disclaimer: {
                title: "AVISO LEGAL (DISCLAIMER)",
                p1: "ESTA APLICAÇÃO É UMA FERRAMENTA DE TERCEIROS NÃO OFICIAL. NÃO ASSUMIMOS QUALQUER RESPONSABILIDADE PELO SEU USO. O USO DESTE APLICATIVO PODE POTENCIALMENTE CAUSAR DANOS À SUA CONTA STREMIO (ex: perda da ordem dos addons ou problemas de sincronização). USE POR SUA CONTA E RISCO. NÃO somos afiliados, endossados ou patrocinados pelo Stremio."
            },
            login: {
                title: "Login e Monitoramento",
                p1: "Insira suas credenciais do Stremio. O aplicativo não salva sua senha; ele gera e usa uma 'authKey' temporária.",
                p2: "Clique no título 5 vezes para desbloquear o 'Modo de Monitoramento', útil para visualizar a lista de addons de outro usuário (requer uma chave administrativa).",
            },
            profiles: {
                title: "Gerenciamento de Perfis",
                p1: "Salve sua sessão logada (Email e Chave de Autenticação) localmente para acesso rápido sem redigitar a senha. Clique no nome de um perfil para renomeá-lo.",
            },
            list: {
                title: "Gerenciamento de Addons",
                p1: "Sua lista é salva localmente (sessão) e só é sincronizada com o Stremio quando você clica em 'Salvar Ordem'.",
                li1: "Arraste os addons (área do ícone/nome) para alterar sua ordem.",
                li2: "A ordem é crucial: addons no topo têm prioridade na resolução de links.",
                li3: "Clique no lápis para renomear um addon localmente (o novo nome é salvo no Stremio).",
                li4: "Use o interruptor para ativar/desativar rapidamente addons sem removê-los.",
                li5: "O ícone ⚙️ aparece apenas se o addon suportar configuração externa e abre a página no navegador.",
                li6: "O botão ⏱️ executa um teste de velocidade básico para verificar o tempo de resposta do manifesto.",
                li7: "O ícone ► expande os detalhes do manifesto (Versão, ID, Tipos, Recursos).",
                li8: "O botão de **Cadeado** (🔒/🔓) exclui/inclui o addon da Atualização Automática noturna (se o recurso global estiver ativo).",
            },
            bulk: {
                title: "Ações em Massa",
                p1: "Selecione um ou mais addons através da caixa de seleção e, em seguida, use os botões 'Ativar', 'Desativar' ou 'Remover' para aplicar a ação a todos os selecionados simultaneamente.",
            },
            status: {
                title: "Verificação de Status",
                p1: "Clique em 'Verificar Status dos Addons' para verificar se as URLs do manifesto respondem corretamente (o status se torna 🟢 OK ou 🔴 Erro).",
            },
            backup: {
                title: "Backup e Importação",
                p1: "Exporte um arquivo .json para salvar sua configuração completa (ordem, status, URL) em seu computador.",
                p2: "Importe um arquivo .json para restaurar uma configuração anterior, substituindo a atual (confirmação necessária).",
                p3: "Exportar Lista TXT é útil para compartilhar URLs rapidamente.",
            },
            share: {
                title: "Link de Compartilhamento",
                p1: "Gere um link de URL codificado. Qualquer pessoa com este link pode carregar sua lista (sem credenciais) diretamente no aplicativo do Console.",
            },
            autoUpdate: {
                title: "Atualização Automática",
                p1: "A opção de Atualização Automática realiza uma verificação nocturna para encontrar novas versões dos manifestos dos addons existentes.",
                p2: "Se forem encontradas diferenças, o aplicativo atualiza automaticamente o manifesto e o salva no Stremio, mantendo a ordem e o nome local inalterados.",
            },
            other: {
                title: "Notas Importantes",
                p1: "As alterações (ordem, status, nome) são temporárias (salvas apenas no histórico) até que você clique em 'Salvar Ordem'.",
                p2: "Use os botões Desfazer e Refazer para navegar no histórico de alterações locais.",
                p3: "O Modo de Monitoramento (Admin) não pode salvar alterações.",
                p4: "O botão SALVAR flutuante só aparece quando você tem alterações não salvas (Chrome/Desktop).",
                p5: "Todos os dados, exceto as preferências de interface, são gerenciados via 'authKey' do Stremio; se você fizer logout, deverá fazer login novamente.",
            }
        }
    }
};
