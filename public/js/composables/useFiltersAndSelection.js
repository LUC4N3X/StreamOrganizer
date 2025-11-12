export function useFiltersAndSelection(ref, computed, watch, nextTick, addons, isMonitoring, hasUnsavedChanges, isMobile, recordAction, showToast, t, debounce) {
    const activeFilter = ref('all');
    const searchQuery = ref('');
    const actualSearchQuery = ref('');
    const showSearchInput = ref(false);
    const searchInputRef = ref(null);

    const debouncedSearchHandler = debounce(q => actualSearchQuery.value = q, 300);
    watch(searchQuery, debouncedSearchHandler);

    const toggleSearch = () => {
        showSearchInput.value = !showSearchInput.value;
        if (showSearchInput.value) nextTick(() => searchInputRef.value?.focus());
    };

    const hideSearchOnBlur = e => {
        const container = e.currentTarget.closest('.list-controls-header');
        if (!container || (!container.contains(e.relatedTarget) && e.relatedTarget?.closest('.search-icon-btn') !== e.currentTarget.parentElement.querySelector('.search-icon-btn'))) {
            showSearchInput.value = false;
        }
    };

    const filteredAddons = computed(() => {
        let list = addons.value;
        if (activeFilter.value === 'enabled') list = list.filter(a => a.isEnabled);
        if (activeFilter.value === 'disabled') list = list.filter(a => !a.isEnabled);
        if (activeFilter.value === 'errors') list = list.filter(a => a.status === 'error');
        if (!actualSearchQuery.value) return list;
        const q = actualSearchQuery.value.toLowerCase();
        return list.filter(a => a.manifest.name.toLowerCase().includes(q));
    });

    const draggableList = computed({
        get: () => filteredAddons.value,
        set(newList) {
            if (isMonitoring.value) return;
            const map = new Map(filteredAddons.value.map(a => [a.transportUrl, a]));
            let i = 0;
            const merged = addons.value.map(a => map.has(a.transportUrl) ? newList[i++] : a);
            if (JSON.stringify(addons.value.map(a => a.transportUrl)) !== JSON.stringify(merged.map(a => a.transportUrl))) {
                addons.value = merged;
                hasUnsavedChanges.value = true;
            }
        }
    });

    const dragOptions = computed(() => ({
        animation: 150,
        ghostClass: "ghost-class",
        handle: ".drag-handle",
        forceFallback: true,
        scrollSensitivity: 150,
        bubbleScroll: true,
        delay: isMobile.value ? 400 : 300,
        delayOnTouchOnly: true,
        touchStartThreshold: 15,
        fallbackTolerance: 5,
        filter: '.no-drag'
    }));

    const enabledCount = computed(() => addons.value.filter(a => a.isEnabled).length);
    const disabledCount = computed(() => addons.value.filter(a => !a.isEnabled).length);
    const errorCount = computed(() => addons.value.filter(a => a.status === 'error').length);

    const selectedAddons = computed(() => addons.value.filter(a => a.selected));
    const allSelected = computed(() => addons.value.length > 0 && selectedAddons.value.length === addons.value.length);

    const toggleSelectAll = () => {
        const state = !allSelected.value;
        addons.value.forEach(a => a.selected = state);
    };

    const enableSelected = () => {
        if (isMonitoring.value) return;
        let count = 0;
        selectedAddons.value.forEach(a => { if (!a.isEnabled) { a.isEnabled = true; count++; } a.selected = false; });
        if (count > 0) { recordAction(t.value('actions.bulkEnabled', { count })); showToast(t.value('bulkActions.enabledSuccess', { count }), 'success'); hasUnsavedChanges.value = true; }
        else showToast(t.value('bulkActions.noneToEnable'), 'info');
    };

    const disableSelected = () => {
        if (isMonitoring.value) return;
        let count = 0;
        selectedAddons.value.forEach(a => { if (a.isEnabled) { a.isEnabled = false; count++; } a.selected = false; });
        if (count > 0) { recordAction(t.value('actions.bulkDisabled', { count })); showToast(t.value('bulkActions.disabledSuccess', { count }), 'success'); hasUnsavedChanges.value = true; }
        else showToast(t.value('bulkActions.noneToDisable'), 'info');
    };

    const removeSelected = () => {
        if (isMonitoring.value || selectedAddons.value.length === 0) return;
        if (!confirm(t.value('bulkActions.removeConfirm', { count: selectedAddons.value.length }))) return;
        const urls = new Set(selectedAddons.value.map(a => a.transportUrl));
        const originalLength = addons.value.length;
        addons.value = addons.value.filter(a => !urls.has(a.transportUrl));
        const removedCount = originalLength - addons.value.length;
        if (removedCount > 0) { recordAction(t.value('actions.bulkRemoved', { count: removedCount })); showToast(t.value('bulkActions.removeSuccess', { count: removedCount }), 'success'); hasUnsavedChanges.value = true; }
    };

    return {
        activeFilter,
        searchQuery,
        showSearchInput,
        searchInputRef,
        toggleSearch,
        hideSearchOnBlur,
        filteredAddons,
        draggableList,
        dragOptions,
        enabledCount,
        disabledCount,
        errorCount,
        selectedAddons,
        allSelected,
        toggleSelectAll,
        enableSelected,
        disableSelected,
        removeSelected
    };
}
