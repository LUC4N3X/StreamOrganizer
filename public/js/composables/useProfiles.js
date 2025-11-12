export function useProfiles(ref, nextTick, isLoggedIn, isMonitoring, authKey, email, showToast, t) {
    const savedProfiles = ref([]);
    const selectedProfileId = ref(null);

    // Callback iniettate per evitare dipendenze circolari
    let retrieveAddonsFromServerCallback = () => {};
    let logoutCallback = () => {};
    const setRetrieveAddons = (fn) => { retrieveAddonsFromServerCallback = fn; };
    const setLogout = (fn) => { logoutCallback = fn; };

    // --- Load & Save ---
    const loadProfiles = () => {
        try {
            const stored = localStorage.getItem('stremioConsoleProfiles');
            let profiles = stored ? JSON.parse(stored) : [];
            if (!Array.isArray(profiles)) profiles = [];
            savedProfiles.value = profiles.filter(p => p.id && p.email).map(p => ({
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
            showToast("Unable to save profiles locally.", 'error');
        }
    };

    const saveProfile = (newProfileName = null) => {
        if (!isLoggedIn.value || isMonitoring.value) return;

        const profileId = authKey.value;
        const profileEmail = email.value;
        const existingIndex = savedProfiles.value.findIndex(p => p.id === profileId);
        let profileName = newProfileName || profileEmail || `User ${Date.now()}`;

        if (existingIndex !== -1) {
            Object.assign(savedProfiles.value[existingIndex], {
                name: profileName,
                email: profileEmail,
                authKey: authKey.value,
                isMonitoring: isMonitoring.value,
                newName: profileName
            });
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

    // --- Edit ---
    const startEditProfile = (profile) => {
        savedProfiles.value.forEach(p => { if (p.id !== profile.id) p.isEditing = false; });
        profile.newName = profile.name || profile.email;
        profile.isEditing = true;

        nextTick(() => {
            const input = document.querySelector(`.profile-list-item[data-profile-id="${profile.id}"] .profile-name-edit-input`);
            if (input) { input.focus(); input.select(); }
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

    // --- Load Profile / Restore Session ---
    const loadProfile = (profileId) => {
        const profile = savedProfiles.value.find(p => p.id === profileId);
        if (!profile) return;

        sessionStorage.clear();

        Object.assign(authKey, { value: profile.authKey });
        Object.assign(email, { value: profile.email });
        Object.assign(isMonitoring, { value: profile.isMonitoring });
        Object.assign(isLoggedIn, { value: true });

        sessionStorage.setItem('stremioAuthKey', profile.authKey);
        sessionStorage.setItem('stremioEmail', profile.email);
        sessionStorage.setItem('stremioIsMonitoring', profile.isMonitoring ? 'true' : 'false');

        retrieveAddonsFromServerCallback(profile.authKey, profile.email);

        showToast(t.value('addon.sessionRestored'), 'success');
    };

    // --- Delete Profile ---
    const deleteProfile = (profileId) => {
        const index = savedProfiles.value.findIndex(p => p.id === profileId);
        if (index === -1) return;

        const profileName = savedProfiles.value[index].name || savedProfiles.value[index].email;
        if (!confirm(t.value('profiles.deleteConfirm', { name: profileName }))) return;

        savedProfiles.value.splice(index, 1);
        saveProfiles();
        showToast(t.value('profiles.deleteSuccess', { name: profileName }), 'info');

        if (profileId === authKey.value) logoutCallback();
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
        setRetrieveAddons,
        setLogout
    };
}
