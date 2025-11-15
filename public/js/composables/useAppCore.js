// 'ref' viene passato come argomento dalla funzione setup principale
export function useAppCore(ref) {
    // --- Refs ---
    const isLoading = ref(false);
    const apiBaseUrl = window.location.origin; // Corretto: non è un ref, è una costante
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

    // Funzione "worker" che applica il tema al DOM e salva nel localStorage
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

    // Modifica: Ora 'toggleTheme' gestisce l'intero processo
    const toggleTheme = () => {
        isLightMode.value = !isLightMode.value; 
        applyTheme(isLightMode.value);          
    };
    
    // Inizializza il tema al caricamento
    const initTheme = () => {
        try {
            const savedTheme = localStorage.getItem('stremioConsoleTheme');
            if (savedTheme) {
                // 1. Priorità: tema salvato dall'utente
                isLightMode.value = savedTheme === 'light';
            } else {
                // 2. Fallback: preferenza di sistema
                isLightMode.value = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
            }
            applyTheme(isLightMode.value); 
        } catch(e) { 
            console.warn("Error reading theme from localStorage or getting system preference.");
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
