// Importiamo l'oggetto translations dal file modulo
import translations from '../translations.js';

// 'ref' e 'computed' vengono passati come argomenti da Vue
export function useTranslations(ref, computed) {
    const lang = ref('it');

    const t = computed(() => (key, interpolations = {}) => {
        const keys = key.split('.');
        
        // Recupera l'oggetto della lingua corrente
        let res = translations[lang.value];
        
        // Naviga nell'oggetto per trovare la chiave (es. 'welcome.title')
        keys.forEach(k => {
            if (res) res = res[k];
        });

        let translation = res || key;

        // Se non è una stringa (es. chiave mancante), restituisce la chiave stessa
        if (typeof translation !== 'string') return key;

        // Gestione interpolazione variabili {{nomeVariabile}}
        Object.entries(interpolations).forEach(([varName, value]) => {
            translation = translation.replace(new RegExp(`{{${varName}}}`, 'g'), value);
        });

        return translation;
    });

    const initLang = () => {
        try { 
            const savedLang = localStorage.getItem('stremioConsoleLang'); 
            // Verifica dinamica: se la lingua salvata esiste nell'oggetto translations, usala
            if (savedLang && translations[savedLang]) {
                lang.value = savedLang;
            }
        } catch(e) { 
            console.warn("Error reading lang from localStorage."); 
        }
        
        // Imposta attributi documento
        document.documentElement.lang = lang.value; 
        document.title = t.value('meta.title');
    };

    return {
        lang,
        t,
        initLang
    };
}
