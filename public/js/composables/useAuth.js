// public/js/composables/useAuth.js

// 'ref' viene passato come primo argomento
export function useAuth(ref, apiBaseUrl, showToast, t, mapAddon, isLoading, addons) {

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
    let resetHistoryCallback = () => { console.error("resetHistoryCallback not set in useAuth"); };
    const setResetHistory = (fn) => { resetHistoryCallback = fn; };

    // --- Helper interno per centralizzare la logica di successo login ---
    const _handleLoginSuccess = (data, userEmail, isMon = false) => {
        authKey.value = data.authKey;
        email.value = userEmail;
        isLoggedIn.value = true;
        isMonitoring.value = isMon;
        
        const mappedAddons = data.addons.map(mapAddon);
        addons.value = mappedAddons;
        
        // Salva tutto in sessione
        sessionStorage.setItem('stremioAuthKey', authKey.value);
        sessionStorage.setItem('stremioEmail', email.value);
        sessionStorage.setItem('stremioIsMonitoring', String(isMon));
        sessionStorage.setItem('stremioAddonList', JSON.stringify(mappedAddons));
        
        showToast(
            isMon ? t.value('addon.monitorSuccess', { email: userEmail }) : t.value('addon.loginSuccess'),
            isMon ? 'info' : 'success'
        );
        
        resetHistoryCallback(); // Resetta la cronologia per qualsiasi tipo di login
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
            const response = await fetch(`${apiBaseUrl}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await response.json(); // Leggi sempre il JSON
            
            if (!response.ok) {
                const errorMsg = data.error?.message || data.message || 'Login failed.';
                throw new Error(errorMsg);
            }

            // Gestisci placeholder per login con solo token
            const userEmail = (loginMode.value === 'token' && !email.value) 
                ? 'TokenAccessUser' 
                : email.value;
            
            _handleLoginSuccess(data, userEmail, false);
            
            return true; // Segnala successo al setup (per welcome screen)
            
        } catch (err) {
            showToast(err.message, 'error');
            return false;
        } finally {
            isLoading.value = false;
        }
    };

    // 'showWelcomeScreenRef' è stato rimosso dai parametri.
    // La funzione ora restituisce 'true' in caso di successo, come fa 'login'.
    const monitorLogin = async () => {
        isLoading.value = true; 
        try {
            const response = await fetch(`${apiBaseUrl}/api/admin/monitor`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ adminKey: adminKey.value, targetEmail: targetEmail.value }) 
            });
            
            const data = await response.json(); // Leggi sempre il JSON all'inizio
            
            if (!response.ok) {
                const errorMsg = data.error?.message || data.message || 'Access Denied.';
                throw new Error(errorMsg);
            }
            
            _handleLoginSuccess(data, targetEmail.value, true);
            
            return true; // Segnala successo al setup (per welcome screen)

        } catch (err) { 
            showToast(t.value('addon.monitorError', { message: err.message }), 'error'); 
            return false; // Segnala fallimento
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
