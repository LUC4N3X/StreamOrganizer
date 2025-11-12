// --- Import Vue dal CDN ---
const { createApp, ref, computed, onMounted, onBeforeUnmount, watch, nextTick } = Vue;

// --- Import utils ---
import { debounce, mapAddon, deepClone, getResourceNames } from './utils.js';

// --- Fix scroll mobile (side effects only) ---
import './mobile-scroll-fix.js';

// --- Composables ---
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

// --- Create Vue App ---
const app = createApp({
    setup() {

        // --- 1. Core utils & state ---
        const { lang, t, initLang } = useTranslations(ref, computed);
        const { 
            isLoading, apiBaseUrl, isMobile, isLightMode, showInstructions,
            toasts, showToast, updateIsMobile, toggleTheme, initTheme
        } = useAppCore(ref);

        // --- 2. Stato addons ---
        const addons = ref([]);

        // --- 3. Auth ---
        const { 
            email, password, authKey, isLoggedIn, isMonitoring, adminClickCount,
            showAdminInput, adminKey, targetEmail, loginMode, providedAuthKey,
            login, monitorLogin, toggleLoginMode, incrementAdminClick,
            setResetHistory
        } = useAuth(ref, showToast, t, mapAddon, isLoading, addons);

        // --- 4. History ---
        const {
            history, redoStack, actionLog, redoActionLog, hasUnsavedChanges,
            recordAction, undo, redo, resetHistory
        } = useHistory(ref, addons, isLoading, isMonitoring, showToast, t, deepClone);

        setResetHistory(resetHistory); 

        // --- 5. Logout ---
        const logout = () => {
            if (hasUnsavedChanges.value && !confirm(t.value('list.logoutConfirm'))) return;

            sessionStorage.clear();
            email.value = '';
            password.value = '';
            authKey.value = null;
            addons.value = [];
            isLoggedIn.value = false;
            isMonitoring.value = false;
            showAdminInput.value = false;

            resetHistory();

            // Reset stati extra
            searchQuery.value = '';
            showSearchInput.value = false;
            showInstructions.value = false;
            toasts.value = [];
            showWelcomeScreen.value = false;
            showWelcomeTourModal.value = false;

            loadProfiles();
        };

        // --- 6. Profiles ---
        const {
            savedProfiles, selectedProfileId, loadProfiles, saveProfiles,
            saveProfile, startEditProfile, finishEditProfile, loadProfile, deleteProfile,
            setRetrieveAddons, setLogout
        } = useProfiles(ref, nextTick, isLoggedIn, isMonitoring, authKey, email, showToast, t);

        // --- 7. Addons ---
        const {
            newAddonUrl, retrieveAddonsFromServer, refreshAddonList, saveOrder,
            addNewAddon, startEdit, finishEdit, moveUp, moveDown, moveTop, moveBottom,
            removeAddon, toggleAddonDisableAutoUpdate, onDragEnd
        } = useAddons(
            ref, nextTick, addons, authKey, email, isMonitoring, isLoading,
            recordAction, showToast, t, mapAddon, hasUnsavedChanges, resetHistory,
            savedProfiles, saveProfiles
        );

        // --- 8. Addon Actions ---
        const {
            isAutoUpdateEnabled, lastUpdateCheck, isUpdating,
            checkAllAddonsStatus, toggleAddonDetails, testAddonSpeed,
            runAutoUpdate, openConfiguration, copyManifestUrl, initAutoUpdate
        } = useAddonActions(
            ref, isLoggedIn, isMonitoring, isLoading, showToast, t, addons,
            (updating) => saveOrder(updating)
        );

        // --- 9. Filters & Selection ---
        const {
            activeFilter, searchQuery, showSearchInput, searchInputRef,
            toggleSearch, hideSearchOnBlur, filteredAddons, draggableList,
            dragOptions, enabledCount, disabledCount, errorCount, selectedAddons,
            allSelected, toggleSelectAll, enableSelected, disableSelected, removeSelected
        } = useFiltersAndSelection(
            ref, computed, watch, nextTick, addons, isMonitoring, hasUnsavedChanges, isMobile,
            recordAction, showToast, t, debounce
        );

        // --- 10. Import / Export ---
        const {
            fileInput, shareInput, shareUrl, importedConfigFromUrl,
            showImportConfirm, pendingImportData, importSource, pendingImportNames,
            exportBackup, exportTxt, triggerFileInput, handleFileImport,
            closeImportConfirm, confirmImport, generateShareLink, copyShareLink, checkUrlImport
        } = useImportExport(
            ref, addons, isMonitoring, recordAction, showToast, t, mapAddon, hasUnsavedChanges
        );

        // --- 11. Tour & Welcome ---
        const {
            showWelcomeScreen, showWelcomeTourModal, dontShowWelcomeAgain,
            dismissWelcomeScreen, skipTour, beginTour, startTour
        } = useTour(
            ref, nextTick, isMobile, isMonitoring, hasUnsavedChanges, t,
            showImportConfirm, pendingImportData, pendingImportNames,
            importSource, importedConfigFromUrl
        );

        // --- 12. Eventi toggle ---
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

        // --- 13. Login wrappers ---
        const aEseguiLogin = async () => {
            const success = await login();
            if (success) showWelcomeScreen.value = true;
        };

        const aEseguiMonitorLogin = async () => {
            await monitorLogin(showWelcomeScreen);
        };

        // --- 14. Dipendenze circolari ---
        setRetrieveAddons(retrieveAddonsFromServer);
        setLogout(logout);

        // --- 15. Eventi globali ---
        const beforeUnloadHandler = (event) => {
            if (hasUnsavedChanges.value) {
                event.preventDefault();
                event.returnValue = '';
            }
        };

        // --- 16. Watchers ---
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

        // --- 17. Lifecycle Hooks ---
        onMounted(() => {
            window.addEventListener('beforeunload', beforeUnloadHandler);
            window.addEventListener('resize', updateIsMobile);

            initTheme();
            loadProfiles();
            initLang();
            checkUrlImport();
            initAutoUpdate();

            // Ripristino sessione
            try {
                const storedKey = sessionStorage.getItem('stremioAuthKey');
                const storedList = sessionStorage.getItem('stremioAddonList');
                const storedEmail = sessionStorage.getItem('stremioEmail');
                const storedMonitoring = sessionStorage.getItem('stremioIsMonitoring') === 'true';

                if (storedKey && storedList) {
                    authKey.value = storedKey;
                    email.value = storedEmail || '';
                    isMonitoring.value = storedMonitoring;
                    if(isMonitoring.value) targetEmail.value = storedEmail || '';

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
            window.removeEventListener('resize', updateIsMobile);
        });

        // --- 18. Return ---
        return {
            // Core
            isLoading, isMobile, isLightMode, showInstructions, toasts, showToast,
            toggleTheme, t, lang,
            // Auth
            email, password, authKey, isLoggedIn, isMonitoring, adminClickCount,
            showAdminInput, adminKey, targetEmail, loginMode, providedAuthKey,
            login: aEseguiLogin, monitorLogin: aEseguiMonitorLogin,
            toggleLoginMode, incrementAdminClick, logout,
            // Profiles
            savedProfiles, selectedProfileId, saveProfile, startEditProfile, finishEditProfile,
            loadProfile, deleteProfile,
            // Addons
            addons, newAddonUrl, refreshAddonList, saveOrder, addNewAddon, startEdit, finishEdit,
            moveUp, moveDown, moveTop, moveBottom, removeAddon,
            toggleAddonDisableAutoUpdate, onDragEnd,
            // Addon Actions
            isAutoUpdateEnabled, lastUpdateCheck, isUpdating, checkAllAddonsStatus,
            toggleAddonDetails, testAddonSpeed, runAutoUpdate, openConfiguration,
            copyManifestUrl, getResourceNames,
            // History
            history, redoStack, actionLog, redoActionLog, hasUnsavedChanges,
            undo, redo,
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
            // Nuove funzioni
            handleToggleEnabled, handleToggleSelected
        };
    }
});

// Registra draggable
app.component('draggable', window.vuedraggable);

// Monta app
app.mount('#app');
