export function useHistory(ref, addons, isLoading, isMonitoring, showToast, t, deepClone) {
    const history = ref([]);
    const redoStack = ref([]);
    const actionLog = ref([]);
    const redoActionLog = ref([]);
    const hasUnsavedChanges = ref(false);

    const recordAction = desc => {
        if (isLoading.value || isMonitoring.value) return;
        history.value.push(deepClone(addons.value));
        actionLog.value.push(desc);
        redoStack.value = [];
        redoActionLog.value = [];
        if (history.value.length > 30) { history.value.shift(); actionLog.value.shift(); }
        hasUnsavedChanges.value = true;
    };

    const undo = () => {
        if (!history.value.length || isMonitoring.value) return;
        if (!actionLog.value.length) return console.error("History/action log out of sync.");

        redoStack.value.push(deepClone(addons.value));
        redoActionLog.value.push(actionLog.value.pop());
        addons.value = history.value.pop();
        showToast(t.value('actions.undoPerformed', { action: redoActionLog.value.at(-1) }), 'info');
        if (!history.value.length) hasUnsavedChanges.value = false;
        addons.value.forEach(a => a.selected = false);
    };

    const redo = () => {
        if (!redoStack.value.length || isMonitoring.value) return;
        if (!redoActionLog.value.length) return console.error("Redo/action log out of sync.");

        history.value.push(deepClone(addons.value));
        const action = redoActionLog.value.pop();
        actionLog.value.push(action);
        addons.value = redoStack.value.pop();
        showToast(t.value('actions.redoPerformed', { action }), 'info');
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

    return { history, redoStack, actionLog, redoActionLog, hasUnsavedChanges, recordAction, undo, redo, resetHistory };
}
