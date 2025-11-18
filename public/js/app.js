// Importa Vue (accede alla variabile globale Vue caricata dal CDN)
const { createApp, ref, computed, onMounted, onBeforeUnmount, watch, nextTick } = Vue;

// Importa utils
import { debounce, mapAddon, deepClone, getResourceNames } from './utils.js';

// Importa il fix per lo scroll (solo per side effects)
import './mobile-scroll-fix.js';

// Importa i Composables
import { useAppCore } from './composables/useAppCore.js';
import { useTranslations } from './composables/useTranslations.js';
import { useHistory } from './composables/useHistory.js';
import { useAuth } from './composables/useAuth.js';
import { useProfiles } from './composables/useProfiles.js';
import { useAddons } from './composables/useAddons.js';
import { useAddonActions } from './composables/useAddonActions.js';
import { useFiltersAndSelection } from './composables/useFiltersAndSelection.js';
import { useImportExport } from './composables/useImportExport.js';
import { useTour } from './composables/useTour.js';

const app = createApp({
    setup() {
        // --- 1. Core Utils & State ---
        const { lang, t, initLang } = useTranslations(ref, computed);
        const { 
            isLoading, apiBaseUrl, isMobile, isLightMode, showInstructions, 
            toasts, showToast, updateIsMobile, initTheme 
        } = useAppCore(ref);

        // --- 2. Stato Addons ---
        const addons = ref([]);

        // --- 3. Autenticazione ---
        const {
            email, password, authKey, isLoggedIn, isMonitoring, adminClickCount,
            showAdminInput, adminKey, targetEmail, loginMode, providedAuthKey,
            login, monitorLogin, toggleLoginMode, incrementAdminClick,
            setResetHistory
        } = useAuth(ref, apiBaseUrl, showToast, t, mapAddon, isLoading, addons);

        // --- 4. Cronologia ---
        const {
            history, redoStack, actionLog, redoActionLog, hasUnsavedChanges,
            canUndo, canRedo,
            recordAction, undo, redo, resetHistory
        } = useHistory({ ref, computed }, addons, { isLoading, isMonitoring, showToast, t, deepClone });

        // Inietta 'resetHistory' in 'useAuth'
        setResetHistory(resetHistory);

        // --- 6. Funzione Logout ---
        const logout = () => { 
            sessionStorage.clear(); 
            email.value = '';
            password.value = '';
            authKey.value = null;
            addons.value = [];
            isLoggedIn.value = false;
            isMonitoring.value = false;
            showAdminInput.value = false;
            resetHistory();
        };

        // --- 7. Profili ---
        const {
            savedProfiles, 
            selectedProfileId, 
            loadProfiles, 
            saveProfiles, 
            saveProfile: originalSaveProfile, 
            startEditProfile, 
            finishEditProfile, 
            loadProfile, 
            deleteProfile,
            setRetrieveAddons, 
            setLogout 
        } = useProfiles(ref, nextTick, isLoggedIn, isMonitoring, authKey, email, showToast, t);

        // Stato per il modal "figo"
        const showSaveProfileModal = ref(false);
        const newProfileName = ref('');
        const profileNameInputRef = ref(null);

        const saveProfile = async () => {
            if (isMonitoring.value) {
                showToast(t.value('monitor.disabledAction'), 'error');
                return;
            }
            const existingProfile = savedProfiles.value.find(p => p.email === email.value);
            const currentName = existingProfile ? (existingProfile.name || email.value) : email.value;
            newProfileName.value = currentName;
            showSaveProfileModal.value = true;

            await nextTick();
            if (profileNameInputRef.value) {
                profileNameInputRef.value.focus();
                profileNameInputRef.value.select();
            }
        };

        const cancelSaveProfile = () => {
            showSaveProfileModal.value = false;
            newProfileName.value = '';
        };

        const confirmSaveProfile = () => {
            const profileName = newProfileName.value;
            if (!profileName || profileName.trim() === '') {
                showToast(t.value('profiles.saveCancelled'), 'info');
                return;
            }

            const existingProfile = savedProfiles.value.find(p => p.email === email.value);
            let profileToSave;

            if (existingProfile) {
                profileToSave = existingProfile;
                profileToSave.name = profileName.trim();
                profileToSave.authKey = providedAuthKey.value || existingProfile.authKey;
                profileToSave.addons = addons.value.map(a => a.transportUrl);
            } else {
                profileToSave = {
                    id: 'profile-' + Date.now(),
                    email: email.value,
                    name: profileName.trim(),
                    authKey: providedAuthKey.value,
                    addons: addons.value.map(a => a.transportUrl)
                };
                savedProfiles.value.push(profileToSave);
            }

            saveProfiles();
            showToast(t.value('profiles.saveSuccess'), 'success');
            cancelSaveProfile();
        };

        // --- 8. Gestione Addons ---
        const {
            newAddonUrl, retrieveAddonsFromServer, refreshAddonList, saveOrder,
            addNewAddon, startEdit, finishEdit, moveUp, moveDown, moveTop, moveBottom,
            removeAddon, toggleAddonDisableAutoUpdate, onDragEnd,
            setHistory,
            setProfileFns
        } = useAddons(ref, nextTick, addons, apiBaseUrl, authKey, email, isMonitoring, isLoading,
            recordAction, showToast, t, mapAddon, hasUnsavedChanges
        );

        // --- 9. Azioni Addon ---
        const {
            isAutoUpdateEnabled, lastUpdateCheck, isUpdating,
            checkAllAddonsStatus, toggleAddonDetails, testAddonSpeed, runAutoUpdate,
            openConfiguration, copyManifestUrl, initAutoUpdate
        } = useAddonActions(ref, apiBaseUrl, isLoggedIn, isMonitoring, isLoading, showToast, t, addons,
            (updating) => saveOrder(updating)
        );

        // --- 10. Filtri e Selezione ---
        const {
            activeFilter, searchQuery, showSearchInput, searchInputRef,
            toggleSearch, hideSearchOnBlur, filteredAddons, draggableList,
            dragOptions, enabledCount, disabledCount, errorCount, selectedAddons,
            allSelected, toggleSelectAll, enableSelected, disableSelected, removeSelected
        } = useFiltersAndSelection(ref, computed, watch, nextTick, addons, isMonitoring, hasUnsavedChanges, isMobile,
            recordAction, showToast, t, debounce
        );

        // --- 11. Import/Export ---
        const {
            fileInput, shareInput, shareUrl, importedConfigFromUrl,
            showImportConfirm, pendingImportData, importSource, pendingImportNames,
            exportBackup, exportTxt, triggerFileInput, handleFileImport,
            closeImportConfirm, confirmImport, generateShareLink, copyShareLink, checkUrlImport
        } = useImportExport(ref, addons, isMonitoring, recordAction, showToast, t, mapAddon, hasUnsavedChanges);

        // --- 12. Tour & Welcome ---
        const {
            showWelcomeScreen, showWelcomeTourModal, dontShowWelcomeAgain,
            dismissWelcomeScreen, skipTour, beginTour, startTour
        } = useTour(ref, nextTick, isMobile, isMonitoring, hasUnsavedChanges, t,
            showImportConfirm, pendingImportData, pendingImportNames,
            importSource, importedConfigFromUrl
        );

        // --- 6b. Completamento funzione Logout ---
        const originalLogout = logout;
        const fullLogout = () => {
            if (hasUnsavedChanges.value && !confirm(t.value('list.logoutConfirm'))) return;
            originalLogout();
            searchQuery.value = '';
            showSearchInput.value = false;
            showInstructions.value = false;
            toasts.value = [];
            showWelcomeScreen.value = false;
            showWelcomeTourModal.value = false;
            loadProfiles();
        };

        // --- 13. Gestori eventi ---
        const handleToggleEnabled = (addon, event) => {
            if (isMonitoring.value) return;
            const newState = event.target.checked;
            addon.isEnabled = newState;
            const actionKey = newState ? 'actions.enabledAddon' : 'actions.disabledAddon';
            recordAction(t.value(actionKey, { name: addon.manifest.name }));
            hasUnsavedChanges.value = true;
        };

        const handleToggleSelected = (addon, event) => {
            addon.selected = event.target.checked;
        };

        // --- NUOVO: Helper per Sincronizzare Preferenze ---
        const fetchServerPreferences = async () => {
            if (!isLoggedIn.value) return;
            try {
                const res = await fetch(`${apiBaseUrl.value}/preferences`, {
                    headers: { 'Content-Type': 'application/json' }
                    // I cookie vengono inviati automaticamente grazie a credentials: true (set in index.js CORS) o default browser
                });
                if (res.ok) {
                    const data = await res.json();
                    // Aggiorna lo stato locale con quello del server (PC/Smartphone sync)
                    isAutoUpdateEnabled.value = data.autoUpdate;
                    // Salva anche in locale per sicurezza
                    localStorage.setItem('stremioAutoUpdateEnabled', data.autoUpdate);
                    console.log("Preferenze sincronizzate dal cloud:", data.autoUpdate);
                }
            } catch (e) {
                console.warn("Errore sync preferenze:", e);
            }
        };

        // --- 14. Gestione Login ---
        const aEseguiLogin = async () => {
            const success = await login();
            if (success) {
                showWelcomeScreen.value = true;
                // Appena loggati, sincronizziamo con MongoDB
                await fetchServerPreferences();
            }
        };

        const aEseguiMonitorLogin = async () => {
            await monitorLogin(showWelcomeScreen);
        };

        // --- 15. Collegamenti finali ---
        setRetrieveAddons(retrieveAddonsFromServer);
        setLogout(fullLogout);
        setHistory(resetHistory);
        setProfileFns(savedProfiles, saveProfiles);

        // --- 16. Eventi globali ---
        const beforeUnloadHandler = (event) => {
            if (hasUnsavedChanges.value) {
                event.preventDefault();
                event.returnValue = '';
            }
        };

        // --- 17. Watchers ---
        watch(lang, (newLang) => {
            document.documentElement.lang = newLang;
            document.title = t.value('meta.title');
            try { localStorage.setItem('stremioConsoleLang', newLang); } 
            catch(e) { console.warn("Cannot save lang to localStorage."); }
        });

        // --- MODIFICATO: Watcher Auto Update per Salvare su MongoDB ---
        watch(isAutoUpdateEnabled, async (newValue) => {
            try {
                // 1. Salva in locale (cache veloce)
                localStorage.setItem('stremioAutoUpdateEnabled', newValue);
                
                // 2. Se loggati, salva sul Server (MongoDB)
                if (isLoggedIn.value && email.value) {
                    await fetch(`${apiBaseUrl.value}/preferences`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            email: email.value, 
                            autoUpdate: newValue,
                            authKey: authKey.value // Invia anche la chiave per sicurezza
                        })
                    });
                }
                
                showToast(t.value(newValue ? 'autoUpdate.enabled' : 'autoUpdate.disabled'), 'info');
            } catch(e) { 
                console.warn("Errore salvataggio preferenze server:", e); 
            }
        });

        watch(isLightMode, (newValue) => {
            document.body.classList.toggle('light-mode', newValue);
            try {
                localStorage.setItem('stremioTheme', newValue ? 'light' : 'dark');
                showToast(t.value(newValue ? 'core.themeLight' : 'core.themeDark'), 'info');
            } catch(e) { console.warn("Cannot save theme pref to localStorage."); }
        });

        // --- 18. Lifecycle Hooks ---
        onMounted(async () => { // Aggiunto async
            window.addEventListener('beforeunload', beforeUnloadHandler);
            window.addEventListener('resize', updateIsMobile);

            initTheme();
            loadProfiles();
            initLang();
            checkUrlImport();
            initAutoUpdate();

            try {
                const storedKey = sessionStorage.getItem('stremioAuthKey');
                const storedList = sessionStorage.getItem('stremioAddonList');
                const storedEmail = sessionStorage.getItem('stremioEmail');
                const storedMonitoring = sessionStorage.getItem('stremioIsMonitoring') === 'true';

                if (storedKey && storedList) {
                    authKey.value = storedKey;
                    email.value = storedEmail || '';
                    isMonitoring.value = storedMonitoring;
                    if (isMonitoring.value) targetEmail.value = storedEmail || '';
                    addons.value = JSON.parse(storedList).map(a => mapAddon(a));
                    isLoggedIn.value = true;

                    // --- NUOVO: Sincronizza stato Cloud al riavvio pagina ---
                    await fetchServerPreferences();

                    showToast(t.value('addon.sessionRestored'), 'info');
                    showWelcomeScreen.value = true;
                }
            } catch(e) {
                console.error("Error restoring session:", e);
                sessionStorage.clear();
            }
        });

        onBeforeUnmount(() => {
            window.removeEventListener('beforeunload', beforeUnloadHandler);
            window.removeEventListener('resize', updateIsMobile);
        });

        // --- 19. Return ---
        return {
            // Core
            isLoading, isMobile, isLightMode, showInstructions, toasts, showToast,
            t, lang,

            // Auth
            email, password, authKey, isLoggedIn, isMonitoring, adminClickCount,
            showAdminInput, adminKey, targetEmail, loginMode, providedAuthKey,
            login: aEseguiLogin, // Usa la versione con sync
            monitorLogin: aEseguiMonitorLogin,
            toggleLoginMode, incrementAdminClick, 
            logout: fullLogout,

            // Profiles
            savedProfiles, selectedProfileId, saveProfile,
            startEditProfile, finishEditProfile, loadProfile, deleteProfile,
            showSaveProfileModal, newProfileName, profileNameInputRef,
            confirmSaveProfile, cancelSaveProfile,

            // Addons
            addons, newAddonUrl, refreshAddonList, saveOrder, addNewAddon, startEdit,
            finishEdit, moveUp, moveDown, moveTop, moveBottom, removeAddon,
            toggleAddonDisableAutoUpdate, onDragEnd,

            // Addon Actions
            isAutoUpdateEnabled, lastUpdateCheck, isUpdating, checkAllAddonsStatus,
            toggleAddonDetails, testAddonSpeed, runAutoUpdate, openConfiguration,
            copyManifestUrl, getResourceNames,

            // History
            history, redoStack, actionLog, redoActionLog, hasUnsavedChanges,
            undo, redo, canUndo, canRedo,

            // Filters & Selection
            activeFilter, searchQuery, showSearchInput, searchInputRef,
            toggleSearch, hideSearchOnBlur, filteredAddons, draggableList,
            dragOptions, enabledCount, disabledCount, errorCount, selectedAddons,
            allSelected, toggleSelectAll, enableSelected, disableSelected, removeSelected,

            // Import/Export
            fileInput, shareInput, shareUrl, showImportConfirm, pendingImportData,
            importSource, pendingImportNames, exportBackup, exportTxt,
            triggerFileInput, handleFileImport, closeImportConfirm, confirmImport,
            generateShareLink, copyShareLink,

            // Tour
            showWelcomeScreen, showWelcomeTourModal, dontShowWelcomeAgain,
            dismissWelcomeScreen, skipTour, beginTour, startTour,

            // Event Handlers
            handleToggleEnabled, handleToggleSelected
        };
    }
});

// Registra il componente draggable
app.component('draggable', window.vuedraggable);

// Monta l'applicazione
app.mount('#app');
