// public/js/composables/useHistory.js

// 'ref' viene passato come primo argomento
export function useHistory(ref, addons, isLoading, isMonitoring, showToast, t, deepClone) {
    
    const history = ref([]); 
    const redoStack = ref([]);
    const actionLog = ref([]);
    const redoActionLog = ref([]);
    const hasUnsavedChanges = ref(false); 

    const recordAction = (description) => {
        if (isLoading.value || isMonitoring.value) return; 
        
        history.value.push(deepClone(addons.value)); 
        actionLog.value.push(description);
        
        redoStack.value = []; 
        redoActionLog.value = [];
        
        if (history.value.length > 30) {
            history.value.shift();
            actionLog.value.shift();
        }
        
        hasUnsavedChanges.value = true; 
    };

    const undo = () => { 
        if (history.value.length === 0 || isMonitoring.value) return; 
        if (actionLog.value.length === 0) { console.error("History state and action log out of sync."); return; }

        redoStack.value.push(deepClone(addons.value)); 
        const lastActionUndone = actionLog.value.pop();
        redoActionLog.value.push(lastActionUndone);
        
        addons.value = history.value.pop();
        
        showToast(t.value('actions.undoPerformed', { action: lastActionUndone }), 'info');

        if (history.value.length === 0) hasUnsavedChanges.value = false; 
        addons.value.forEach(a => a.selected = false); 
    };
    
    const redo = () => { 
        if (redoStack.value.length === 0 || isMonitoring.value) return; 
        if (redoActionLog.value.length === 0) { console.error("Redo state and action log out of sync."); return; }

        history.value.push(deepClone(addons.value)); 
        const lastActionRedone = redoActionLog.value.pop();
        actionLog.value.push(lastActionRedone);

        addons.value = redoStack.value.pop(); 

        showToast(t.value('actions.redoPerformed', { action: lastActionRedone }), 'info');

        hasUnsavedChanges.value = true; 
        addons.value.forEach(a => a.selected = false); 
    };

    const resetHistory = () => {
        history.value = [];
        redoStack.value = [];
        actionLog.value = [];
        redoActionLog.value = [];
        hasUnsavedChanges.value = false;
    };

    return {
        history,
        redoStack,
        actionLog,
        redoActionLog,
        hasUnsavedChanges,
        recordAction,
        undo,
        redo,
        resetHistory
    };
}
