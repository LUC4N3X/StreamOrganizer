// public/js/app.js

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

        // --- 5. Funzione Logout ---
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

        // --- 6. Profili ---
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

        // --- 7. Gestione Addons ---
        const {
            newAddonUrl, retrieveAddonsFromServer, refreshAddonList, saveOrder,
            addNewAddon, startEdit, finishEdit, moveUp, moveDown, moveTop, moveBottom,
            removeAddon, toggleAddonDisableAutoUpdate, onDragEnd,
            setHistory,
            setProfileFns
        } = useAddons(ref, nextTick, addons, apiBaseUrl, authKey, email, isMonitoring, isLoading,
            recordAction, showToast, t, mapAddon, hasUnsavedChanges
        );

        // --- 8. Azioni Addon ---
        const {
            isAutoUpdateEnabled, lastUpdateCheck, isUpdating,
            checkAllAddonsStatus, toggleAddonDetails, testAddonSpeed, runAutoUpdate,
            openConfiguration, copyManifestUrl, initAutoUpdate
        } = useAddonActions(ref, apiBaseUrl, isLoggedIn, isMonitoring, isLoading, showToast, t, addons,
            (updating) => saveOrder(updating)
        );

        // --- 9. Filtri e Selezione ---
        const {
            activeFilter, searchQuery, showSearchInput, searchInputRef,
            toggleSearch, hideSearchOnBlur, filteredAddons, draggableList,
            dragOptions, enabledCount, disabledCount, errorCount, selectedAddons,
            allSelected, toggleSelectAll, enableSelected, disableSelected, removeSelected
        } = useFiltersAndSelection(ref, computed, watch, nextTick, addons, isMonitoring, hasUnsavedChanges, isMobile,
            recordAction, showToast, t, debounce
        );

        // --- 10. Import/Export ---
        const {
            fileInput, shareInput, shareUrl, importedConfigFromUrl,
            showImportConfirm, pendingImportData, importSource, pendingImportNames,
            exportBackup, exportTxt, triggerFileInput, handleFileImport,
            closeImportConfirm, confirmImport, generateShareLink, copyShareLink, checkUrlImport
        } = useImportExport(ref, addons, isMonitoring, recordAction, showToast, t, mapAddon, hasUnsavedChanges);

        // --- 11. Tour & Welcome ---
        const {
            showWelcomeScreen, showWelcomeTourModal, dontShowWelcomeAgain,
            dismissWelcomeScreen, skipTour, beginTour, startTour
        } = useTour(ref, nextTick, isMobile, isMonitoring, hasUnsavedChanges, t,
            showImportConfirm, pendingImportData, pendingImportNames,
            importSource, importedConfigFromUrl
        );

        // --- 12. Completamento funzione Logout ---
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

        // --- 14. Gestione Login ---
        const aEseguiLogin = async () => {
            const success = await login();
            if (success) showWelcomeScreen.value = true;
        };

        const aEseguiMonitorLogin = async () => {
            await monitorLogin(showWelcomeScreen);
        };

        // --- 15. Collegamenti finali ---
        setRetrieveAddons(retrieveAddonsFromServer);
        setLogout(fullLogout);
        setHistory(resetHistory);
        setProfileFns(savedProfiles, saveProfiles);

        // --- 16. Eventi globali (Ottimizzati) ---
        const beforeUnloadHandler = (event) => {
            if (hasUnsavedChanges.value) {
                event.preventDefault();
                event.returnValue = '';
            }
        };
        
        // Debounce per il resize: evita ricalcoli eccessivi su mobile/desktop
        const handleResize = debounce(() => {
            updateIsMobile();
        }, 250);

        // --- 17. Watchers ---
        watch(lang, (newLang) => {
            document.documentElement.lang = newLang;
            document.title = t.value('meta.title');
            try { localStorage.setItem('stremioConsoleLang', newLang); } 
            catch(e) { console.warn("Cannot save lang to localStorage."); }
        });

        watch(isAutoUpdateEnabled, (newValue) => {
            try {
                localStorage.setItem('stremioAutoUpdateEnabled', newValue);
                showToast(t.value(newValue ? 'autoUpdate.enabled' : 'autoUpdate.disabled'), 'info');
            } catch(e) { console.warn("Cannot save auto-update pref to localStorage."); }
        });

        watch(isLightMode, (newValue) => {
            document.body.classList.toggle('light-mode', newValue);
            try {
                localStorage.setItem('stremioTheme', newValue ? 'light' : 'dark');
                showToast(t.value(newValue ? 'core.themeLight' : 'core.themeDark'), 'info');
            } catch(e) { console.warn("Cannot save theme pref to localStorage."); }
        });

        // --- 18. Lifecycle Hooks ---
        onMounted(() => {
            window.addEventListener('beforeunload', beforeUnloadHandler);
            window.addEventListener('resize', handleResize); // Usa la versione debounced

            initTheme();

            // --- AGGIUNTA: Imposta Dark Mode come default ---
            // Se non c'è una preferenza salvata (null), forza isLightMode a false.
            if (localStorage.getItem('stremioTheme') === null) {
                isLightMode.value = false;
            }
            // -----------------------------------------------

            loadProfiles();
            initLang();
            checkUrlImport();
            initAutoUpdate();

            // Restore Sessione con mapAddon aggiornato
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
            window.removeEventListener('resize', handleResize);
        });

        // --- 19. Return ---
        return {
            // Core
            isLoading, isMobile, isLightMode, showInstructions, toasts, showToast,
            t, lang,

            // Auth
            email, password, authKey, isLoggedIn, isMonitoring, adminClickCount,
            showAdminInput, adminKey, targetEmail, loginMode, providedAuthKey,
            login: aEseguiLogin,
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
