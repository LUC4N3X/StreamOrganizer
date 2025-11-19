// public/js/composables/useAppCore.js

export function useAppCore(ref) {
    // --- Refs ---
    const isLoading = ref(false);
    const apiBaseUrl = window.location.origin; 
    const isMobile = ref(window.innerWidth <= 960);
    const isLightMode = ref(false); // DEFAULT: Parte sempre in Dark
    const showInstructions = ref(false);

    // --- Toast Logic ---
    const toasts = ref([]);
    let toastIdCounter = 0;
    const showToast = (message, type = 'success', duration = 3000) => {
        const id = toastIdCounter++;
        toasts.value.push({ id, message, type });
        setTimeout(() => {
            toasts.value = toasts.value.filter(toast => toast.id !== id);
        }, duration);
    };

    // --- Mobile & Theme Logic ---
    const updateIsMobile = () => isMobile.value = window.innerWidth <= 960;

    // Funzione interna per applicare il tema
    const applyTheme = (isLight) => {
        // Applica la classe CSS al body
        if (isLight) {
            document.body.classList.add('light-mode');
        } else {
            document.body.classList.remove('light-mode');
        }
        
        // Salva con la chiave CORRETTA (stremioTheme)
        try {
            localStorage.setItem('stremioTheme', isLight ? 'light' : 'dark');
        } catch(e) {
            console.warn("Cannot save theme pref to localStorage.");
        }
    };

    const toggleTheme = () => {
        isLightMode.value = !isLightMode.value; 
        applyTheme(isLightMode.value);          
    };
    
    // Inizializzazione
    const initTheme = () => {
        try {
            // Usa la chiave CORRETTA: 'stremioTheme'
            const savedTheme = localStorage.getItem('stremioTheme');
            
            if (savedTheme) {
                // Se esiste un salvataggio, usalo
                isLightMode.value = savedTheme === 'light';
            } else {
                // Se NON esiste salvataggio, forza DARK (false)
                isLightMode.value = false;
            }
            
            // Applica subito visivamente
            applyTheme(isLightMode.value); 
        } catch(e) { 
            console.warn("Error reading theme from localStorage.");
            isLightMode.value = false; 
            applyTheme(isLightMode.value);
        }
    };

    return {
        isLoading,
        apiBaseUrl,
        isMobile,
        isLightMode,
        showInstructions,
        toasts,
        showToast,
        updateIsMobile,
        toggleTheme, 
        initTheme
    };
}
