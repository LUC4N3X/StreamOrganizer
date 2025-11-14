// public/js/composables/useAppCore.js

// 'ref' viene ora passato come argomento dalla funzione setup principale
export function useAppCore(ref) {
    // --- Refs ---
    const isLoading = ref(false);
    const apiBaseUrl = window.location.origin;
    const isMobile = ref(window.innerWidth <= 960);
    const isLightMode = ref(false);
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
        // Il valore di isLightMode sarà modificato nel setup principale,
        // questa funzione applica solo la modifica.
        applyTheme(isLightMode.value);
    };
    
    // Inizializza il tema al caricamento
    const initTheme = () => {
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
