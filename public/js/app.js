// Importa Vue
const { createApp, ref, computed, onMounted, onBeforeUnmount, watch, nextTick } = Vue;
import { debounce, mapAddon, deepClone, getResourceNames } from './utils.js';
import './mobile-scroll-fix.js';
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
        const { lang, t, initLang } = useTranslations(ref, computed);
        const { isLoading, apiBaseUrl, isMobile, isLightMode, showInstructions, toasts, showToast, updateIsMobile, initTheme } = useAppCore(ref);
        const addons = ref([]);
        const isSyncing = ref(false); 

        const {
            email, password, authKey, isLoggedIn, isMonitoring, adminClickCount,
            showAdminInput, adminKey, targetEmail, loginMode, providedAuthKey,
            login, monitorLogin, toggleLoginMode, incrementAdminClick, setResetHistory
        } = useAuth(ref, apiBaseUrl, showToast, t, mapAddon, isLoading, addons);

        const {
            history, redoStack, actionLog, redoActionLog, hasUnsavedChanges,
            canUndo, canRedo, recordAction, undo, redo, resetHistory
        } = useHistory({ ref, computed }, addons, { isLoading, isMonitoring, showToast, t, deepClone });
        setResetHistory(resetHistory);

        const logout = () => { 
            sessionStorage.clear(); email.value = ''; password.value = ''; authKey.value = null;
            addons.value = []; isLoggedIn.value = false; isMonitoring.value = false;
            showAdminInput.value = false; resetHistory();
        };

        const {
            savedProfiles, selectedProfileId, loadProfiles, saveProfiles, saveProfile: originalSaveProfile, 
            startEditProfile, finishEditProfile, loadProfile, deleteProfile, setRetrieveAddons, setLogout 
        } = useProfiles(ref, nextTick, isLoggedIn, isMonitoring, authKey, email, showToast, t);

        const showSaveProfileModal = ref(false);
        const newProfileName = ref('');
        const profileNameInputRef = ref(null);

        const saveProfile = async () => {
            if (isMonitoring.value) { showToast(t.value('monitor.disabledAction'), 'error'); return; }
            const existingProfile = savedProfiles.value.find(p => p.email === email.value);
            newProfileName.value = existingProfile ? (existingProfile.name || email.value) : email.value;
            showSaveProfileModal.value = true;
            await nextTick(); if (profileNameInputRef.value) profileNameInputRef.value.select();
        };
        const cancelSaveProfile = () => { showSaveProfileModal.value = false; newProfileName.value = ''; };
        const confirmSaveProfile = () => {
            const profileName = newProfileName.value;
            if (!profileName || !profileName.trim()) { showToast(t.value('profiles.saveCancelled'), 'info'); return; }
            const existingProfile = savedProfiles.value.find(p => p.email === email.value);
            let profileToSave = existingProfile 
                ? { ...existingProfile, name: profileName.trim(), authKey: providedAuthKey.value || existingProfile.authKey, addons: addons.value.map(a => a.transportUrl) }
                : { id: 'profile-' + Date.now(), email: email.value, name: profileName.trim(), authKey: providedAuthKey.value, addons: addons.value.map(a => a.transportUrl) };
            if (existingProfile) Object.assign(existingProfile, profileToSave); else savedProfiles.value.push(profileToSave);
            saveProfiles(); showToast(t.value('profiles.saveSuccess'), 'success'); cancelSaveProfile();
        };

        const {
            newAddonUrl, retrieveAddonsFromServer, refreshAddonList, saveOrder, addNewAddon, startEdit, finishEdit, 
            moveUp, moveDown, moveTop, moveBottom, removeAddon, toggleAddonDisableAutoUpdate, onDragEnd, setHistory, setProfileFns
        } = useAddons(ref, nextTick, addons, apiBaseUrl, authKey, email, isMonitoring, isLoading,
            recordAction, showToast, t, mapAddon, hasUnsavedChanges
        );

        const {
            isAutoUpdateEnabled, lastUpdateCheck, isUpdating, checkAllAddonsStatus, toggleAddonDetails, testAddonSpeed, 
            runAutoUpdate, openConfiguration, copyManifestUrl, initAutoUpdate
        } = useAddonActions(ref, apiBaseUrl, isLoggedIn, isMonitoring, isLoading, showToast, t, addons,
            (updating) => saveOrder(updating)
        );

        const {
            activeFilter, searchQuery, showSearchInput, searchInputRef, toggleSearch, hideSearchOnBlur, filteredAddons, 
            draggableList, dragOptions, enabledCount, disabledCount, errorCount, selectedAddons, allSelected, toggleSelectAll, 
            enableSelected, disableSelected, removeSelected
        } = useFiltersAndSelection(ref, computed, watch, nextTick, addons, isMonitoring, hasUnsavedChanges, isMobile,
            recordAction, showToast, t, debounce
        );

        const {
            fileInput, shareInput, shareUrl, importedConfigFromUrl, showImportConfirm, pendingImportData, importSource, 
            pendingImportNames, exportBackup, exportTxt, triggerFileInput, handleFileImport, closeImportConfirm, confirmImport, 
            generateShareLink, copyShareLink, checkUrlImport
        } = useImportExport(ref, addons, isMonitoring, recordAction, showToast, t, mapAddon, hasUnsavedChanges);

        const {
            showWelcomeScreen, showWelcomeTourModal, dontShowWelcomeAgain, dismissWelcomeScreen, skipTour, beginTour, startTour
        } = useTour(ref, nextTick, isMobile, isMonitoring, hasUnsavedChanges, t,
            showImportConfirm, pendingImportData, pendingImportNames, importSource, importedConfigFromUrl
        );

        const showAutoUpdateModal = ref(false);
        const handleAutoUpdateToggle = (event) => {
            if (isSyncing.value) return;
            if (event.target.checked) { event.target.checked = false; showAutoUpdateModal.value = true; } 
            else { isAutoUpdateEnabled.value = false; }
        };
        const confirmAutoUpdate = () => { showAutoUpdateModal.value = false; isAutoUpdateEnabled.value = true; };
        const cancelAutoUpdate = () => { showAutoUpdateModal.value = false; isAutoUpdateEnabled.value = false; };

        // --- FIX MOBILE SYNC ---
        const fetchServerPreferences = async () => {
            if (!isLoggedIn.value) return;
            isSyncing.value = true;
            try {
                // FIX: Invia AuthKey nell'Header (per bypassare problemi Cookie su iOS/Android)
                const res = await fetch(`${apiBaseUrl.value}/preferences`, {
                    headers: { 
                        'Authorization': authKey.value,
                        'Content-Type': 'application/json'
                    }
                });
                if (res.ok) {
                    const data = await res.json();
                    isAutoUpdateEnabled.value = data.autoUpdate;
                    localStorage.setItem('stremioAutoUpdateEnabled', data.autoUpdate);
                }
            } catch (e) { console.warn("Sync err:", e); } 
            finally { await nextTick(); setTimeout(() => { isSyncing.value = false; }, 100); }
        };

        const aEseguiLogin = async () => {
            const success = await login();
            if (success) {
                showWelcomeScreen.value = true;
                await fetchServerPreferences();
            }
        };
        const aEseguiMonitorLogin = async () => { await monitorLogin(showWelcomeScreen); };
        
        const fullLogout = () => {
            if (hasUnsavedChanges.value && !confirm(t.value('list.logoutConfirm'))) return;
            logout(); searchQuery.value = ''; showSearchInput.value = false; showInstructions.value = false;
            toasts.value = []; showWelcomeScreen.value = false; showWelcomeTourModal.value = false; loadProfiles();
        };

        const handleToggleEnabled = (addon, event) => {
            if (isMonitoring.value) return;
            addon.isEnabled = event.target.checked;
            recordAction(t.value(addon.isEnabled ? 'actions.enabledAddon' : 'actions.disabledAddon', { name: addon.manifest.name }));
            hasUnsavedChanges.value = true;
        };
        const handleToggleSelected = (addon, event) => { addon.selected = event.target.checked; };

        setRetrieveAddons(retrieveAddonsFromServer); setLogout(fullLogout); setHistory(resetHistory); setProfileFns(savedProfiles, saveProfiles);

        watch(lang, (nl) => { document.documentElement.lang = nl; document.title = t.value('meta.title'); try { localStorage.setItem('stremioConsoleLang', nl); } catch(e) {} });

        watch(isAutoUpdateEnabled, async (newValue) => {
            if (isSyncing.value) return;
            try {
                localStorage.setItem('stremioAutoUpdateEnabled', newValue);
                if (isLoggedIn.value && email.value) {
                    // FIX: Invia email in minuscolo per evitare duplicati
                    await fetch(`${apiBaseUrl.value}/preferences`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                            email: email.value.toLowerCase(), 
                            autoUpdate: newValue, 
                            authKey: authKey.value 
                        })
                    });
                }
                showToast(t.value(newValue ? 'autoUpdate.enabled' : 'autoUpdate.disabled'), 'info');
            } catch(e) { console.warn("Save err:", e); }
        });

        watch(isLightMode, (nv) => { document.body.classList.toggle('light-mode', nv); try { localStorage.setItem('stremioTheme', nv ? 'light' : 'dark'); } catch(e) {} showToast(t.value(nv ? 'core.themeLight' : 'core.themeDark'), 'info'); });

        onMounted(async () => {
            window.addEventListener('beforeunload', beforeUnloadHandler); window.addEventListener('resize', updateIsMobile);
            initTheme(); loadProfiles(); initLang(); checkUrlImport(); initAutoUpdate();
            try {
                const sKey = sessionStorage.getItem('stremioAuthKey');
                const sList = sessionStorage.getItem('stremioAddonList');
                const sEmail = sessionStorage.getItem('stremioEmail');
                const sMon = sessionStorage.getItem('stremioIsMonitoring') === 'true';
                if (sKey && sList) {
                    authKey.value = sKey; email.value = sEmail || ''; isMonitoring.value = sMon;
                    if (sMon) targetEmail.value = sEmail || '';
                    addons.value = JSON.parse(sList).map(a => mapAddon(a));
                    isLoggedIn.value = true;
                    await fetchServerPreferences();
                    showToast(t.value('addon.sessionRestored'), 'info');
                    showWelcomeScreen.value = true;
                }
            } catch(e) { sessionStorage.clear(); }
        });

        onBeforeUnmount(() => { window.removeEventListener('beforeunload', beforeUnloadHandler); window.removeEventListener('resize', updateIsMobile); });

        return {
            isLoading, isMobile, isLightMode, showInstructions, toasts, showToast, t, lang,
            email, password, authKey, isLoggedIn, isMonitoring, adminClickCount, showAdminInput, adminKey, targetEmail, loginMode, providedAuthKey,
            login: aEseguiLogin, monitorLogin: aEseguiMonitorLogin, toggleLoginMode, incrementAdminClick, logout: fullLogout,
            savedProfiles, selectedProfileId, saveProfile, startEditProfile, finishEditProfile, loadProfile, deleteProfile,
            showSaveProfileModal, newProfileName, profileNameInputRef, confirmSaveProfile, cancelSaveProfile,
            addons, newAddonUrl, refreshAddonList, saveOrder, addNewAddon, startEdit, finishEdit, moveUp, moveDown, moveTop, moveBottom, removeAddon, toggleAddonDisableAutoUpdate, onDragEnd,
            isAutoUpdateEnabled, lastUpdateCheck, isUpdating, checkAllAddonsStatus, toggleAddonDetails, testAddonSpeed, runAutoUpdate, openConfiguration, copyManifestUrl, getResourceNames,
            history, redoStack, actionLog, redoActionLog, hasUnsavedChanges, undo, redo, canUndo, canRedo,
            activeFilter, searchQuery, showSearchInput, searchInputRef, toggleSearch, hideSearchOnBlur, filteredAddons, draggableList, dragOptions, enabledCount, disabledCount, errorCount, selectedAddons, allSelected, toggleSelectAll, enableSelected, disableSelected, removeSelected,
            fileInput, shareInput, shareUrl, showImportConfirm, pendingImportData, importSource, pendingImportNames, exportBackup, exportTxt, triggerFileInput, handleFileImport, closeImportConfirm, confirmImport, generateShareLink, copyShareLink,
            showWelcomeScreen, showWelcomeTourModal, dontShowWelcomeAgain, dismissWelcomeScreen, skipTour, beginTour, startTour,
            handleToggleEnabled, handleToggleSelected,
            showAutoUpdateModal, handleAutoUpdateToggle, confirmAutoUpdate, cancelAutoUpdate
        };
    }
});
app.component('draggable', window.vuedraggable);
app.mount('#app');
