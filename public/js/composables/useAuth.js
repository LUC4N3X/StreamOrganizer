// Costanti per le chiavi di Session Storage
const AUTH_KEY_STORAGE = 'stremioAuthKey';
const EMAIL_STORAGE = 'stremioEmail';
const MONITORING_STORAGE = 'stremioIsMonitoring';
const ADDON_LIST_STORAGE = 'stremioAddonList';


import { api } from './services/api.js';

export function useAuth(
    ref,
    // apiBaseUrl rimosso
    showToast,
    t,
    mapAddon,
    isLoading,
    addons
) {

    // --- Auth Refs ---
    const email = ref('');
    const password = ref('');
    const authKey = ref(null);
    const isLoggedIn = ref(false);
    const isMonitoring = ref(false);
    
    // --- Admin Refs ---
    const adminClickCount = ref(0);
    const showAdminInput = ref(false);
    const adminKey = ref('');
    const targetEmail = ref('');
    
    // --- Token Login Refs ---
    const loginMode = ref('password'); 
    const providedAuthKey = ref(''); 
    
    // --- Callback per dipendenza circolare ---
    let resetHistoryCallback = () => {};
    const setResetHistory = (fn) => { resetHistoryCallback = fn; };

 

    const _handleAuthSuccess = (data, isMonitoringUser, providedEmail) => {
        authKey.value = data.authKey;
        isLoggedIn.value = true;
        isMonitoring.value = isMonitoringUser;
        
        if (isMonitoringUser) {
            email.value = providedEmail;
        } else if (loginMode.value === 'token' && !providedEmail) {
            email.value = 'TokenAccessUser';
        }
       
        const mappedAddons = data.addons.map(mapAddon);
        addons.value = mappedAddons;
        
        try {
            sessionStorage.setItem(AUTH_KEY_STORAGE, authKey.value);
            sessionStorage.setItem(EMAIL_STORAGE, email.value);
            sessionStorage.setItem(MONITORING_STORAGE, String(isMonitoringUser));
            sessionStorage.setItem(ADDON_LIST_STORAGE, JSON.stringify(mappedAddons));
        } catch (e) {
            console.warn("Failed to write auth data to sessionStorage.", e);
        }

        resetHistoryCallback(); 
    };

    const login = async () => {
        isLoading.value = true;
        let payload;
        
        if (loginMode.value === 'password') {
            payload = { email: email.value, password: password.value };
        } else {
            payload = { authKey: providedAuthKey.value, email: email.value };
        }

        try {
            
            const data = await api.login(payload);
            
            _handleAuthSuccess(data, false, email.value);
            showToast(t.value('addon.loginSuccess'), 'success');
            return true; 
            
        } catch (err) {
            showToast(err.message, 'error');
            return false;
        } finally {
            isLoading.value = false;
        }
    };

    const monitorLogin = async (showWelcomeScreenRef) => {
        isLoading.value = true; 
        isMonitoring.value = false;
        try {
            
            const data = await api.monitorLogin(adminKey.value, targetEmail.value);
            
            _handleAuthSuccess(data, true, targetEmail.value);
            showToast(t.value('addon.monitorSuccess', { email: targetEmail.value }), 'info');
            showWelcomeScreenRef.value = true; 

        } catch (err) { 
            showToast(t.value('addon.monitorError', { message: err.message }), 'error'); 
        } finally { 
            isLoading.value = false; 
        }
    };

    const toggleLoginMode = () => {
        loginMode.value = (loginMode.value === 'password') ? 'token' : 'password';
        password.value = '';
        providedAuthKey.value = '';
    };

    const incrementAdminClick = () => {
        if(!isLoggedIn.value) adminClickCount.value++;
        if (adminClickCount.value >= 5) {
            showAdminInput.value = true;
            showToast(t.value('addon.monitorModeActive'), 'info');
            adminClickCount.value = 0;
        }
    };

    return {
        email,
        password,
        authKey,
        isLoggedIn,
        isMonitoring,
        adminClickCount,
        showAdminInput,
        adminKey,
        targetEmail,
        loginMode,
        providedAuthKey,
        login,
        monitorLogin,
        toggleLoginMode,
        incrementAdminClick,
        setResetHistory 
    };
}
