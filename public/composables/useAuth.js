// public/js/composables/useAuth.js

// 'ref' viene passato come primo argomento
export function useAuth(ref, apiBaseUrl, showToast, t, mapAddon, isLoading, addons) { // Rimosso resetHistory da qui

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
    const loginMode = ref('password'); // 'password' o 'token'
    const providedAuthKey = ref(''); // Per l'input del token
    
    // --- Callback per dipendenza circolare ---
    let resetHistoryCallback = () => {};
    const setResetHistory = (fn) => { resetHistoryCallback = fn; };

    const login = async () => {
        isLoading.value = true;
        let payload;
        
        if (loginMode.value === 'password') {
            payload = { email: email.value, password: password.value };
        } else {
            payload = { authKey: providedAuthKey.value, email: email.value };
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
            
            if (loginMode.value === 'token' && !email.value) {
                email.value = 'TokenAccessUser'; // Placeholder
            }
            
            sessionStorage.setItem('stremioAuthKey', authKey.value);
            sessionStorage.setItem('stremioEmail', email.value);
            sessionStorage.setItem('stremioIsMonitoring', 'false');
            sessionStorage.setItem('stremioAddonList', JSON.stringify(data.addons.map(mapAddon)));
            
            addons.value = data.addons.map(mapAddon);
            showToast(t.value('addon.loginSuccess'), 'success');
            
            resetHistoryCallback(); // Usa il callback
            
            // Restituire true per segnalare al setup di mostrare la welcome screen
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
            const response = await fetch(`${apiBaseUrl}/api/admin/monitor`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ adminKey: adminKey.value, targetEmail: targetEmail.value }) 
            });
            if (!response.ok) throw new Error((await response.json()).error.message || 'Access Denied.');
            const data = await response.json();
            
            authKey.value = data.authKey; 
            isLoggedIn.value = true; 
            isMonitoring.value = true; 
            email.value = targetEmail.value;
            
            showToast(t.value('addon.monitorSuccess', { email: targetEmail.value }), 'info');
            sessionStorage.setItem('stremioAuthKey', authKey.value);
            sessionStorage.setItem('stremioEmail', email.value);
            sessionStorage.setItem('stremioIsMonitoring', 'true');
            sessionStorage.setItem('stremioAddonList', JSON.stringify(data.addons.map(mapAddon)));
            
            addons.value = data.addons.map(mapAddon);
            showWelcomeScreenRef.value = true; // Mostra la welcome screen

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
        setResetHistory // Esponi il setter
    };
}
