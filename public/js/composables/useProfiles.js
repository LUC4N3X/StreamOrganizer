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
    const selectedProfileId = ref(null);
    
    // Funzioni che verranno iniettate dal setup principale
    // per evitare dipendenze circolari
    let retrieveAddonsFromServerCallback = () => {};
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

        if (existingIndex !== -1) {
            savedProfiles.value[existingIndex].name = profileName;
            savedProfiles.value[existingIndex].email = profileEmail;
            savedProfiles.value[existingIndex].authKey = authKey.value;
            savedProfiles.value[existingIndex].isMonitoring = isMonitoring.value;
            savedProfiles.value[existingIndex].newName = profileName;
        } else {
            savedProfiles.value.push({
                id: profileId,
                name: profileName,
                email: profileEmail, 
                authKey: authKey.value,
                isMonitoring: isMonitoring.value,
                isEditing: false,
                newName: profileName
            });
        }
        saveProfiles();
        showToast(t.value('profiles.saveSuccess'), 'success');
    };

    const startEditProfile = (profile) => {
        savedProfiles.value.forEach(p => {
            if (p.id !== profile.id && p.isEditing) p.isEditing = false;
        });
        profile.newName = profile.name || profile.email;
        profile.isEditing = true;
        nextTick(() => {
            const input = document.querySelector(`.profile-list-item[data-profile-id="${profile.id}"] .profile-name-edit-input`);
            if (input) {
                input.focus();
                input.select();
            }
        });
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

    const loadProfile = (profileId) => {
        const profile = savedProfiles.value.find(p => p.id === profileId);
        if (!profile) return;

        sessionStorage.clear();
        
        authKey.value = profile.authKey;
        email.value = profile.email;
        isMonitoring.value = profile.isMonitoring;
        isLoggedIn.value = true;
        
        sessionStorage.setItem('stremioAuthKey', profile.authKey);
        sessionStorage.setItem('stremioEmail', profile.email);
        sessionStorage.setItem('stremioIsMonitoring', profile.isMonitoring ? 'true' : 'false');
        
        // Chiama la funzione iniettata
        retrieveAddonsFromServerCallback(profile.authKey, profile.email);

        showToast(t.value('addon.sessionRestored'), 'success');
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
                // Chiama la funzione iniettata
                logoutCallback();
            }
        }
    };

    return {
        savedProfiles,
        selectedProfileId,
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