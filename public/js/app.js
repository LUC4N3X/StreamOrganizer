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
                        
                        // La tua logica per preservare il nome è corretta
                        const currentName = addon.manifest.name;
                        addon.manifest = { ...newManifest, name: currentName };
                        addon.newLocalName = currentName;
                        
                        return { status: 'fulfilled', id: addon.manifest.id };
                    } 
                    return { status: 'fulfilled', id: addon.manifest.id, noChange: true };
                } catch (error) { 
                    console.error(`Failed to update ${addonName}:`, error); 
                    failedCount++; 
                    return { status: 'rejected', id: addon.manifest.id, reason: error.message }; 
                }
            }; // <-- Fine di fetchAndUpdateAddon

            // Il resto della funzione runAutoUpdate (dal tuo snippet)
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
        }; // <-- Questa è la parentesi graffa che chiude runAutoUpdate

        // Le altre funzioni che hai incollato (sono corrette e rimangono invariate)
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
                    addon.disableAutoUpdate = !addon.disableAutoUpdate; // Inverti lo stato
                    // Modificato per usare il nuovo stato
                    recordAction(t.value(addon.disableAutoUpdate ? 'actions.excludedFromUpdate' : 'actions.includedInUpdate', { name: addon.manifest.name })); 
                 }
            };
            // FINE NUOVO

            const openConfiguration = (addon) => { const baseUrl = addon.transportUrl.replace(/\/manifest.json$/, ''); window.open(`${baseUrl}/configure`, '_blank'); };
            const copyManifestUrl = async (addon) => { try { await navigator.clipboard.writeText(addon.transportUrl); showToast(t.value('addon.copyUrlSuccess'), 'success'); } catch(e) { showToast(t.value('addon.copyUrlError'), 'error'); } };
            const startEdit = (addon) => { if (!isMonitoring.value) { addon.newLocalName = addon.manifest.name; addon.isEditing = true; } };
            const finishEdit = (addon) => { 
                if (!isMonitoring.value) { 
                    const oldName = addon.manifest.name; 
                    const newName = addon.newLocalName.trim(); 
                    if (newName && newName !== oldName) { 
                        // MODIFICATO: Chiama recordAction con la descrizione dell'azione
                        recordAction(t.value('actions.renamed', { oldName: oldName, newName: newName })); 
                        addon.manifest.name = newName; 
                        showToast(t.value('addon.renameSuccess'), 'info'); 
                    } 
                    addon.isEditing = false; 
                } else { addon.isEditing = false; }
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
    app.mount('#app');
