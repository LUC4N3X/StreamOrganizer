export function useTranslations(ref, computed) {
    const lang = ref('it');

    const t = computed(() => (key, interpolations = {}) => {
        if (typeof translations === 'undefined') {
            console.error("Variabile 'translations' non trovata.");
            return key;
        }
        const keys = key.split('.');
        let res = translations[lang.value];
        keys.forEach(k => res = res?.[k]);
        let translation = res || key;
        Object.entries(interpolations).forEach(([varName, value]) => {
            translation = translation.replace(new RegExp(`{{${varName}}}`, 'g'), value);
        });
        return translation;
    });

    const initLang = () => {
        try { 
            const savedLang = localStorage.getItem('stremioConsoleLang'); 
            if (savedLang && ['it', 'en'].includes(savedLang)) lang.value = savedLang;
        } catch(e) { 
            console.warn("Error reading lang from localStorage."); 
        }
        document.documentElement.lang = lang.value; 
        document.title = t.value('meta.title');
    };

    return {
        lang,
        t,
        initLang
    };
}
