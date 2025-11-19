// public/js/composables/useProfiles.js

// 'ref' e 'nextTick' vengono passati come argomenti (variabili globali di Vue)
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

    // Callbacks iniettati per evitare dipendenze circolari
    let retrieveAddonsFromServerCallback = () => Promise.resolve(false);
    let logoutCallback = () => {};

    const setRetrieveAddons = (fn) => { if (typeof fn === 'function') retrieveAddonsFromServerCallback = fn; };
    const setLogout = (fn) => { if (typeof fn === 'function') logoutCallback = fn; };

    // ---------- Utility locali ----------
    const _translate = (key, params) => {
        try {
            if (typeof t === 'function') return t(key, params);
            if (t && typeof t.value === 'function') return t.value(key, params);
        } catch (e) { /* ignore */ }
        // fallback testuale
        return key;
    };

    const _show = (msg, type = 'info') => {
        try { showToast && showToast(msg, type); } catch (e) { console.warn('showToast failed', e); }
    };

    // ---------- Load / Save ----------
    const loadProfiles = () => {
        try {
            const profilesJson = localStorage.getItem('stremioConsoleProfiles');
            let loadedProfiles = profilesJson ? JSON.parse(profilesJson) : [];
            if (!Array.isArray(loadedProfiles)) loadedProfiles = [];
            // Normalizza e inizializza campi reattivi mancanti
            savedProfiles.value = loadedProfiles.map(p => ({
                id: p.id || null,
                name: p.name || (p.email || ''),
                email: p.email || '',
                authKey: p.authKey || p.id || null,
                isMonitoring: !!p.isMonitoring,
                // campi per UI
                isEditing: false,
                newName: (p.name || p.email || '').toString()
            })).filter(p => p.id && p.email); // rimuovi profili incompleti
        } catch (e) {
            console.error("Error loading profiles:", e);
            savedProfiles.value = [];
        }
    };

    const saveProfiles = () => {
        try {
            const cleanProfiles = savedProfiles.value.map(p => ({
                id: p.id,
                name: p.name || '',
                email: p.email,
                authKey: p.authKey || p.id,
                isMonitoring: !!p.isMonitoring
            }));
            localStorage.setItem('stremioConsoleProfiles', JSON.stringify(cleanProfiles));
        } catch (e) {
            console.error("Error saving profiles:", e);
            _show(_translate('profiles.saveError') || 'Impossibile salvare i profili in locale.', 'error');
        }
    };

    // ---------- Save single profile (robusto) ----------
    // accetta come arg un nome stringa o un ref (es. email)
    const saveProfile = (maybeName = null) => {
        try {
            const logged = isLoggedIn && !!isLoggedIn.value;
            const monitoring = isMonitoring && !!isMonitoring.value;

            if (!logged) {
                _show(_translate('profiles.notLogged') || 'Devi essere loggato per salvare il profilo.', 'warning');
                return false;
            }
            // Se vuoi permettere il salvataggio anche in monitor mode, rimuovi questa condizione:
            if (monitoring) {
                _show(_translate('profiles.cannotSaveWhileMonitoring') || 'Impossibile salvare in modalità monitoring.', 'warning');
                return false;
            }

            // estrai authKey/email anche se passati come ref o stringa
            const key = (authKey && 'value' in authKey) ? authKey.value : authKey;
            const mail = (email && 'value' in email) ? email.value : email;

            if (!key || !mail) {
                console.error('[useProfiles] saveProfile missing authKey/email', { key, mail });
                _show(_translate('profiles.incompleteInfo') || 'Informazioni profilo incomplete.', 'error');
                return false;
            }

            // calcola nome profilo (accetta ref o stringa)
            let profileName = null;
            if (maybeName) {
                if (typeof maybeName === 'object' && 'value' in maybeName) profileName = maybeName.value;
                else profileName = String(maybeName);
            }
            if (!profileName) profileName = mail;
            if (!profileName) profileName = `User ${Date.now()}`;

            const existingIndex = savedProfiles.value.findIndex(p => p.id === key);

            const profileData = {
                id: key,
                name: profileName,
                email: mail,
                authKey: key,
                isMonitoring: !!isMonitoring.value,
                isEditing: false,
                newName: profileName
            };

            if (existingIndex !== -1) {
                // preserva eventuali campi UI ma aggiorna i dati principali
                savedProfiles.value[existingIndex] = {
                    ...savedProfiles.value[existingIndex],
                    ...profileData
                };
            } else {
                savedProfiles.value.push(profileData);
            }

            saveProfiles();

            _show(_translate('profiles.saveSuccess') || 'Profilo salvato con successo.', 'success');
            return true;
        } catch (err) {
            console.error('[useProfiles] saveProfile error', err);
            _show(_translate('profiles.saveError') || 'Errore durante il salvataggio del profilo.', 'error');
            return false;
        }
    };

    // ---------- Edit helpers ----------
    const startEditProfile = (profile) => {
        if (!profile) return;
        // Chiudi altri input di modifica
        savedProfiles.value.forEach(p => { if (p.id !== profile.id) p.isEditing = false; });
        profile.newName = profile.name || profile.email || '';
        profile.isEditing = true;
        // Il focus/select dell'input deve essere gestito nel componente usando nextTick
    };

    const finishEditProfile = (profile) => {
        if (!profile) return;
        const newName = (profile.newName || '').toString().trim();
        if (newName && newName !== profile.name) {
            profile.name = newName;
            saveProfiles();
            _show(_translate('profiles.renameSuccess') || 'Nome profilo aggiornato.', 'success');
        }
        profile.isEditing = false;
    };

    // ---------- Load a profile (restore session) ----------
    const loadProfile = async (profileId) => {
        const profile = savedProfiles.value.find(p => p.id === profileId);
        if (!profile) return false;

        // Logout per pulire stato precedente
        try {
            logoutCallback && logoutCallback();
        } catch (e) { console.warn('logoutCallback failed', e); }

        // Tenta di recuperare gli addon con le credenziali del profilo
        try {
            const success = await retrieveAddonsFromServerCallback(profile.authKey, profile.email);
            if (success) {
                // aggiorna i refs esterni
                if (authKey && 'value' in authKey) authKey.value = profile.authKey;
                if (email && 'value' in email) email.value = profile.email;
                if (isMonitoring && 'value' in isMonitoring) isMonitoring.value = !!profile.isMonitoring;
                if (isLoggedIn && 'value' in isLoggedIn) isLoggedIn.value = true;

                sessionStorage.setItem('stremioAuthKey', profile.authKey);
                sessionStorage.setItem('stremioEmail', profile.email);
                sessionStorage.setItem('stremioIsMonitoring', profile.isMonitoring ? 'true' : 'false');

                _show(_translate('addon.sessionRestored') || 'Sessione ripristinata.', 'success');
                return true;
            } else {
                // retrieveAddonsFromServerCallback dovrebbe già mostrare toast di errore
                return false;
            }
        } catch (err) {
            console.error('[useProfiles] loadProfile error', err);
            _show(_translate('profiles.loadError') || 'Errore durante il caricamento del profilo.', 'error');
            return false;
        }
    };

    // ---------- Delete ----------
    const deleteProfile = (profileId) => {
        const idx = savedProfiles.value.findIndex(p => p.id === profileId);
        if (idx === -1) return;
        const prof = savedProfiles.value[idx];
        const nameForConfirm = prof.name || prof.email || prof.id;

        const confirmMsg = _translate('profiles.deleteConfirm', { name: nameForConfirm }) || `Eliminare il profilo "${nameForConfirm}"?`;
        if (confirm(confirmMsg)) {
            savedProfiles.value.splice(idx, 1);
            saveProfiles();
            _show(_translate('profiles.deleteSuccess', { name: nameForConfirm }) || `Profilo "${nameForConfirm}" eliminato.`, 'info');
            // Se stai cancellando il profilo corrente, effettua logout completo
            const currentKey = (authKey && 'value' in authKey) ? authKey.value : authKey;
            if (profileId === currentKey) {
                try { logoutCallback && logoutCallback(); } catch (e) { console.warn('logoutCallback failed', e); }
            }
        }
    };

    // Espongo l'API
    return {
        savedProfiles,
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
