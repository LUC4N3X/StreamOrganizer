export function useAppCore(ref) {
    const isLoading = ref(false);
    const apiBaseUrl = window.location.origin;
    const isMobile = ref(window.innerWidth <= 960);
    const isLightMode = ref(false);
    const showInstructions = ref(false);

    const toasts = ref([]);
    let toastIdCounter = 0;
    const showToast = (message, type = 'success', duration = 3000) => {
        const id = toastIdCounter++;
        toasts.value.push({ id, message, type });
        setTimeout(() => toasts.value = toasts.value.filter(t => t.id !== id), duration);
    };

    const updateIsMobile = () => isMobile.value = window.innerWidth <= 960;

    const applyTheme = (light) => {
        document.body.classList.toggle('light-mode', light);
        try { localStorage.setItem('stremioConsoleTheme', light ? 'light' : 'dark'); } catch {}
    };

    const toggleTheme = () => applyTheme(isLightMode.value);

    const initTheme = () => {
        try {
            const saved = localStorage.getItem('stremioConsoleTheme');
            isLightMode.value = saved === 'light';
        } catch { isLightMode.value = false; }
        applyTheme(isLightMode.value);
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
