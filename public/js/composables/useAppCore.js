export function useAppCore(ref, watch) {
    
    // --- Stato ---
    const isLoading = ref(false);
    const apiBaseUrl = ref('https://stream-organizer-api.onrender.com');
    const isMobile = ref(window.innerWidth <= 768);
    const showInstructions = ref(false);
    const toasts = ref([]);
    
    // --- LOGICA TEMA 
    const validThemes = ['dark', 'light']; 
    const currentTheme = ref('dark'); 

   
    const initTheme = () => {
        try {
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme && validThemes.includes(savedTheme)) {
                currentTheme.value = savedTheme;
            } else {
                currentTheme.value = 'dark'; // Fallback
                localStorage.setItem('theme', 'dark');
            }
        } catch (e) {
            console.warn("Impossibile caricare il tema dal localStorage.", e);
            currentTheme.value = 'dark';
        }
        
        // Imposta il tema sull'HTML all'avvio
        document.documentElement.setAttribute('data-theme', currentTheme.value);
    };


    watch(currentTheme, (newTheme) => {
        if (validThemes.includes(newTheme)) {
            try {
                // Applica il tema all'HTML
                document.documentElement.setAttribute('data-theme', newTheme);
                // Salva la preferenza
                localStorage.setItem('theme', newTheme);
            } catch (e) {
                console.warn("Impossibile salvare il tema nel localStorage.", e);
            }
        }
    });

  
    const toggleTheme = () => {
        currentTheme.value = currentTheme.value === 'light' ? 'dark' : 'light';
    };
    // --- FINE LOGICA TEMA ---


    // --- Funzioni Utilità ---
    const showToast = (message, type = 'info', duration = 3000) => {
        const id = Date.now() + Math.random();
        toasts.value.push({ id, message, type });
        setTimeout(() => {
            toasts.value = toasts.value.filter(t => t.id !== id);
        }, duration);
    };

    const updateIsMobile = () => {
        isMobile.value = window.innerWidth <= 768;
    };

    // --- Ritorno ---
    return {
        isLoading,
        apiBaseUrl,
        isMobile,
        showInstructions,
        toasts,
        showToast,
        updateIsMobile,
        
        currentTheme,
        initTheme,
        toggleTheme 
    };
}
