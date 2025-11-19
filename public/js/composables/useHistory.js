export function useHistory(vueDeps, addons, deps, options = {}) {
    
    // Estraiamo 'ref' e 'computed' dall'oggetto passato
    const { ref, computed } = vueDeps;
    
    // Estraiamo le altre dipendenze
    const { isLoading, isMonitoring, showToast, t, deepClone } = deps;
    
    const { historyLimit = 30 } = options;

    const history = ref([]);
    const redoStack = ref([]);
    const actionLog = ref([]);
    const redoActionLog = ref([]);
    const hasUnsavedChanges = ref(false);

    // --- Proprietà Reattive ---

    // Usiamo 'computed' (passato come dipendenza) per esporre lo stato
    const canUndo = computed(() => history.value.length > 0 && !isMonitoring.value);
    const canRedo = computed(() => redoStack.value.length > 0 && !isMonitoring.value);

    // --- Metodi ---

    /**
     * Registra lo stato *corrente* nello storico prima di una modifica.
     * @param {String} description La descrizione dell'azione eseguita.
     */
    const recordAction = (description) => {
        if (isLoading.value || isMonitoring.value) return;

        history.value.push(deepClone(addons.value));
        actionLog.value.push(description);

        // Una nuova azione resetta sempre lo stack di redo.
        redoStack.value = [];
        redoActionLog.value = [];

        // Applica il limite dello storico.
        if (history.value.length > historyLimit) {
            history.value.shift();
            actionLog.value.shift();
        }

        hasUnsavedChanges.value = true;
    };

    /**
     * Annulla l'ultima azione.
     */
    const undo = () => {
        if (!canUndo.value) return;
        if (actionLog.value.length === 0) { console.error("History state and action log out of sync."); return; }

        // Salva lo stato corrente (prima di annullare) nello stack di redo.
        redoStack.value.push(deepClone(addons.value));
        const lastActionUndone = actionLog.value.pop();
        redoActionLog.value.push(lastActionUndone);

        // Ripristina lo stato precedente.
        addons.value = history.value.pop();

        // Usa t.value
        showToast(t.value('actions.undoPerformed', { action: lastActionUndone }), 'info');
        
       
    };
    
    /**
     * Ripete l'ultima azione annullata.
     */
    const redo = () => {
        if (!canRedo.value) return;
        if (redoActionLog.value.length === 0) { console.error("Redo state and action log out of sync."); return; }

        // Salva lo stato corrente (prima di ripetere) nello stack di undo.
        history.value.push(deepClone(addons.value));
        const lastActionRedone = redoActionLog.value.pop();
        actionLog.value.push(lastActionRedone);

        // Ripristina lo stato "futuro".
        addons.value = redoStack.value.pop();

        
        showToast(t.value('actions.redoPerformed', { action: lastActionRedone }), 'info');
        hasUnsavedChanges.value = true;
    }

    /**
     * Resetta completamente lo storico.
     * Chiamare tipicamente dopo un salvataggio o al caricamento iniziale.
     */
    const resetHistory = () => {
        history.value = [];
        redoStack.value = [];
        actionLog.value = [];
        redoActionLog.value = [];
        hasUnsavedChanges.value = false;
    };

    // Esponi le funzioni e le proprietà reattive.
    return {
        history,
        redoStack,
        actionLog,
        redoActionLog,
        hasUnsavedChanges,
        canUndo, 
        canRedo, 
        recordAction,
        undo,
        redo,
        resetHistory
    };
}
