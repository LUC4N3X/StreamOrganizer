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
            toasts, showToast, updateIsMobile, toggleTheme, initTheme 
        } = useAppCore(ref);

        // --- 2. Stato Addons (definito qui per essere passato) ---
        const addons = ref([]);

        // --- 3. Autenticazione (CREA 'isMonitoring' PRIMA) ---
        const { 
            email, password, authKey, isLoggedIn, isMonitoring, adminClickCount, 
            showAdminInput, adminKey, targetEmail, loginMode, providedAuthKey, 
            login, monitorLogin, toggleLoginMode, incrementAdminClick,
            setResetHistory // <-- Prendi il setter
        } = useAuth(ref, apiBaseUrl, showToast, t, mapAddon, isLoading, addons); // <-- resetHistory rimosso da qui

        // --- 4. Cronologia (ORA PUÒ LEGGERE 'isMonitoring') ---
        const { 
            history, redoStack, actionLog, redoActionLog, hasUnsavedChanges, 
            recordAction, undo, redo, resetHistory // <-- 'resetHistory' è creato QUI
        } = useHistory(ref, addons, isLoading, isMonitoring, showToast, t, deepClone);
        
        // --- 5. Inietta 'resetHistory' in 'useAuth' per completare il ciclo ---
        setResetHistory(resetHistory);

        // --- 6. Funzione Logout (Orchestratore) ---
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
            
            resetHistory(); // Resetta la cronologia
            
            // Resetta altri stati (es. da filtri, tour, ecc.)
            searchQuery.value = ''; 
            showSearchInput.value = false; 
            showInstructions.value = false; 
            toasts.value = []; 
            showWelcomeScreen.value = false; 
            showWelcomeTourModal.value = false; 
            
            loadProfiles(); // Ricarica i profili salvati
        };
        
        // --- 7. Profili (dipende da auth e funzioni) ---
        const { 
            savedProfiles, selectedProfileId, loadProfiles, saveProfiles, 
            saveProfile, startEditProfile, finishEditProfile, loadProfile, deleteProfile,
            setRetrieveAddons, setLogout 
        } = useProfiles(ref, nextTick, isLoggedIn, isMonitoring, authKey, email, showToast, t);
        
        // --- 8. Gestione Addons (il nucleo) ---
        const { 
            newAddonUrl, retrieveAddonsFromServer, refreshAddonList, saveOrder, 
            addNewAddon, startEdit, finishEdit, moveUp, moveDown, moveTop, moveBottom, 
            removeAddon, toggleAddonEnabled, toggleAddonDisableAutoUpdate, onDragEnd
        } = useAddons(
            ref, nextTick, addons, apiBaseUrl, authKey, email, isMonitoring, isLoading, 
            recordAction, showToast, t, mapAddon, hasUnsavedChanges, resetHistory,
            savedProfiles, saveProfiles
        );
        
        // --- 9. Azioni Addon (dipende da addons e saveOrder) ---
        const { 
            isAutoUpdateEnabled, lastUpdateCheck, isUpdating, 
            checkAllAddonsStatus, toggleAddonDetails, testAddonSpeed, runAutoUpdate, 
            openConfiguration, copyManifestUrl, initAutoUpdate
        } = useAddonActions(
            ref, apiBaseUrl, isLoggedIn, isMonitoring, isLoading, showToast, t, addons, 
            (updating) => saveOrder(updating) // Passa saveOrder come callback
        );
        
        // --- 10. Filtri e Selezione ---
        const { 
            activeFilter, searchQuery, showSearchInput, searchInputRef, 
            toggleSearch, hideSearchOnBlur, filteredAddons, draggableList, 
            dragOptions, enabledCount, disabledCount, errorCount, selectedAddons, 
            allSelected, toggleSelectAll, enableSelected, disableSelected, removeSelected
        } = useFiltersAndSelection(
            ref, computed, watch, nextTick, addons, isMonitoring, hasUnsavedChanges, isMobile, 
            recordAction, showToast, t, debounce
        );
        
        // --- 11. Import/Export ---
        const { 
            fileInput, shareInput, shareUrl, importedConfigFromUrl, 
            showImportConfirm, pendingImportData, importSource, pendingImportNames, 
            exportBackup, exportTxt, triggerFileInput, handleFileImport, 
            closeImportConfirm, confirmImport, generateShareLink, copyShareLink, checkUrlImport
        } = useImportExport(
            ref, addons, isMonitoring, recordAction, showToast, t, mapAddon, hasUnsavedChanges
        );
        
        // --- 12. Tour & Welcome ---
        const { 
            showWelcomeScreen, showWelcomeTourModal, dontShowWelcomeAgain, 
            dismissWelcomeScreen, skipTour, beginTour, startTour
        } = useTour(
            ref, nextTick, isMobile, isMonitoring, hasUnsavedChanges, t,
            showImportConfirm, pendingImportData, pendingImportNames, 
            importSource, importedConfigFromUrl
        );

        // --- 13. Gestione Login (per mostrare Welcome Screen) ---
        const aEseguiLogin = async () => {
            const success = await login();
            if (success) {
                showWelcomeScreen.value = true;
            }
        };

        const aEseguiMonitorLogin = async () => {
            await monitorLogin(showWelcomeScreen); // Passa il ref
        };

        // --- 14. Collegamenti finali per dipendenze circolari ---
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
            try { 
                localStorage.setItem('stremioConsoleLang', newLang); 
            } catch(e) { 
                console.warn("Cannot save lang to localStorage."); 
            } 
        });
        
        watch(isAutoUpdateEnabled, (newValue) => {
            try {
                localStorage.setItem('stremioAutoUpdateEnabled', newValue);
                if (newValue) {
                    showToast(t.value('autoUpdate.enabled'), 'info');
                } else {
                    showToast(t.value('autoUpdate.disabled'), 'info');
                }
            } catch(e) { 
                console.warn("Cannot save auto-update pref to localStorage."); 
            }
        });

        // --- 17. Lifecycle Hooks ---
        onMounted(() => {
            window.addEventListener('beforeunload', beforeUnloadHandler); 
            window.addEventListener('resize', updateIsMobile);
            
            initTheme();
            loadProfiles();
            initLang();
            checkUrlImport(); // Controlla import da URL
            initAutoUpdate(); // Avvia pianificazione auto-update

            // Logica di ripristino sessione
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
                    showWelcomeScreen.value = true; // Mostra welcome screen al ripristino
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
        // Ritorna tutto ciò che serve al template, raggruppato
        return {
            // Core
            isLoading, isMobile, isLightMode, showInstructions, toasts, showToast, 
            toggleTheme, t, lang, 
            // Auth
            email, password, authKey, isLoggedIn, isMonitoring, adminClickCount, 
            showAdminInput, adminKey, targetEmail, loginMode, providedAuthKey, 
            login: aEseguiLogin, // Usa il wrapper
            monitorLogin: aEseguiMonitorLogin, // Usa il wrapper
            toggleLoginMode, incrementAdminClick, logout,
            // Profiles
            savedProfiles, selectedProfileId, saveProfile, startEditProfile, 
            finishEditProfile, loadProfile, deleteProfile,
            // Addons
            addons, newAddonUrl, refreshAddonList, saveOrder, addNewAddon, startEdit, 
            finishEdit, moveUp, moveDown, moveTop, moveBottom, removeAddon, 
            toggleAddonEnabled, toggleAddonDisableAutoUpdate, onDragEnd,
            // Addon Actions
            isAutoUpdateEnabled, lastUpdateCheck, isUpdating, checkAllAddonsStatus, 
            toggleAddonDetails, testAddonSpeed, runAutoUpdate, openConfiguration, 
            copyManifestUrl, getResourceNames, // getResourceNames è da utils
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
            dismissWelcomeScreen, skipTour, beginTour, startTour
        };
    }
});

// Registra il componente draggable (assicurati che vuedraggable sia caricato)
app.component('draggable', window.vuedraggable);

// Monta l'applicazione
app.mount('#app');
