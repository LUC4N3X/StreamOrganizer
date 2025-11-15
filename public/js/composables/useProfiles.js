// public/js/composables/useProfiles.js

// 'ref' e 'nextTick' vengono passati come argomenti
export function useProfiles(
    ref,
    nextTick,
    isLoggedIn, 
    isMonitoring, 
    authKey, 
    email, 
    showToast, 
    t
) {
    const savedProfiles = ref([]);
    // const selectedProfileId = ref(null); // Rimosso perché non utilizzato

    // Funzioni che verranno iniettate dal setup principale
    // per evitare dipendenze circolari
    let retrieveAddonsFromServerCallback = () => Promise.resolve(false); // Default a 'false'
    let logoutCallback = () => {};
    
    const setRetrieveAddons = (fn) => { retrieveAddonsFromServerCallback = fn; };
    const setLogout = (fn) => { logoutCallback = fn; };

    const loadProfiles = () => {
        try {
            const profilesJson = localStorage.getItem('stremioConsoleProfiles');
            let loadedProfiles = profilesJson ? JSON.parse(profilesJson) : [];
            if (!Array.isArray(loadedProfiles)) loadedProfiles = [];
            savedProfiles.value = loadedProfiles.filter(p => p.id && p.email).map(p => ({
                ...p,
                isEditing: false,
                newName: p.name || p.email
            }));
        } catch (e) {
            console.error("Error loading profiles:", e);
            savedProfiles.value = [];
        }
    };

    const saveProfiles = () => {
        try {
            const cleanProfiles = savedProfiles.value.map(p => ({
                id: p.id,
                name: p.name, 
                email: p.email,
                authKey: p.authKey,
                isMonitoring: p.isMonitoring
            }));
            localStorage.setItem('stremioConsoleProfiles', JSON.stringify(cleanProfiles));
        } catch (e) {
            console.error("Error saving profiles:", e);
            showToast("Impossibile salvare i profili in locale.", 'error');
        }
    };

    const saveProfile = (newProfileName = null) => {
        if (!isLoggedIn.value || isMonitoring.value) return;

        const profileId = authKey.value;
        const profileEmail = email.value;
        const existingIndex = savedProfiles.value.findIndex(p => p.id === profileId);

        let profileName = newProfileName || profileEmail;
        if (!profileName) profileName = `User ${Date.now()}`;

        const profileData = {
            id: profileId,
            name: profileName,
            email: profileEmail, 
            authKey: authKey.value,
            isMonitoring: isMonitoring.value,
            isEditing: false,
            newName: profileName
        };

        if (existingIndex !== -1) {
            savedProfiles.value[existingIndex] = {
                ...savedProfiles.value[existingIndex], // Preserva stato 'isEditing'
                ...profileData
            };
        } else {
            savedProfiles.value.push(profileData);
        }
        saveProfiles();
        showToast(t.value('profiles.saveSuccess'), 'success');
    };

    // *** MODIFICATO QUI ***
    // Rimossa la logica di manipolazione del DOM.
    // Questa funzione ora gestisce solo lo STATO.
    const startEditProfile = (profile) => {
        // Chiudi altri input di modifica
        savedProfiles.value.forEach(p => {
            if (p.id !== profile.id && p.isEditing) p.isEditing = false;
        });
        profile.newName = profile.name || profile.email;
        profile.isEditing = true;
        
        // La logica di focus/select deve essere gestita nel componente Vue
        // usando 'watch' e 'nextTick'.
    };

    const finishEditProfile = (profile) => {
        const newName = profile.newName.trim();
        if (newName && newName !== profile.name) {
            profile.name = newName;
            saveProfiles();
            showToast(t.value('profiles.renameSuccess'), 'success');
        }
        profile.isEditing = false;
    };

    // *** MODIFICATO QUI ***
    // Resa la funzione 'async' e più robusta.
    const loadProfile = async (profileId) => {
        const profile = savedProfiles.value.find(p => p.id === profileId);
        if (!profile) return;

        // 1. Esegui il logout per pulire lo stato e la sessione
        logoutCallback(); 
        
        // 2. Tenta di caricare gli addon con il nuovo profilo
        // 'retrieveAddonsFromServerCallback' viene da useAddons e
        // gestirà il proprio stato 'isLoading' e i toast di errore.
        const success = await retrieveAddonsFromServerCallback(profile.authKey, profile.email);

        if (success) {
            // 3. Se il caricamento riesce, imposta il nuovo stato di auth
            authKey.value = profile.authKey;
            email.value = profile.email;
            isMonitoring.value = profile.isMonitoring;
            isLoggedIn.value = true;
            
            // 4. Salva il nuovo stato in sessionStorage
            sessionStorage.setItem('stremioAuthKey', profile.authKey);
            sessionStorage.setItem('stremioEmail', profile.email);
            sessionStorage.setItem('stremioIsMonitoring', profile.isMonitoring ? 'true' : 'false');
            
            // Nota: 'stremioAddonList' è già stato salvato da retrieveAddonsFromServer

            showToast(t.value('addon.sessionRestored'), 'success');
        } else {
            // Il caricamento è fallito (es. authKey scaduto).
            // L'utente rimane loggato fuori, che è lo stato corretto.
            // 'retrieveAddonsFromServerCallback' ha già mostrato un toast di errore.
        }
    };

    const deleteProfile = (profileId) => {
        const profileIndex = savedProfiles.value.findIndex(p => p.id === profileId);
        if (profileIndex === -1) return;

        const profileName = savedProfiles.value[profileIndex].name || savedProfiles.value[profileIndex].email;

        if (confirm(t.value('profiles.deleteConfirm', { name: profileName }))) {
            savedProfiles.value.splice(profileIndex, 1);
            saveProfiles();
            showToast(t.value('profiles.deleteSuccess', { name: profileName }), 'info');
            
            if (profileId === authKey.value) {
                // Chiama la funzione iniettata per un logout completo
                logoutCallback();
            }
        }
    };

    return {
        savedProfiles,
        // selectedProfileId, // Rimosso
        loadProfiles,
        saveProfiles,
        saveProfile,
        startEditProfile,
        finishEditProfile,
        loadProfile,
        deleteProfile,
        setRetrieveAddons, // Esponi i setter
        setLogout
    };
}
