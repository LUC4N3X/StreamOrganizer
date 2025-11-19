// public/js/composables/useFiltersAndSelection.js

// 'ref', 'computed', 'watch', 'nextTick' vengono passati come argomenti
export function useFiltersAndSelection(
    ref,
    computed,
    watch,
    nextTick,
    addons,
    isMonitoring,
    hasUnsavedChanges,
    isMobile,
    recordAction,
    showToast,
    t,
    debounce
) {

    // --- Filter & Search Refs ---
    const activeFilter = ref('all');
    const searchQuery = ref(''); 
    const actualSearchQuery = ref('');
    const showSearchInput = ref(false); 
    const searchInputRef = ref(null); 

    // --- Search Logic ---
    const debouncedSearchHandler = debounce((newValue) => {
        actualSearchQuery.value = newValue;
    }, 300);

    watch(searchQuery, (newValue) => {
        debouncedSearchHandler(newValue);
    });

    const toggleSearch = () => { 
        showSearchInput.value = !showSearchInput.value; 
        if (showSearchInput.value) {
            nextTick(() => searchInputRef.value?.focus()); 
        } else {
            // UX FIX: Resetta la ricerca quando si chiude l'input
            searchQuery.value = ''; 
        }
    };
    
    // REFACTOR: Logica di blur semplificata e resa più robusta.
    // Questa logica appartiene al componente (usando @focusout sul contenitore),
    // ma questa versione è più pulita.
    const hideSearchOnBlur = (event) => { 
        const searchContainer = event.currentTarget.closest('.list-controls-header'); 
        
        // Se il focus si sposta su un elemento *al di fuori* del contenitore di ricerca,
        // allora chiudiamo l'input.
        if (searchContainer && !searchContainer.contains(event.relatedTarget)) {
            showSearchInput.value = false;
            searchQuery.value = ''; // Resetta anche qui
        }
    };

    // --- Computed Lists ---
    const filteredAddons = computed(() => { 
        let f = addons.value; 

        if (activeFilter.value === 'enabled') f = addons.value.filter(a => a.isEnabled); 
        if (activeFilter.value === 'disabled') f = addons.value.filter(a => !a.isEnabled); 
        if (activeFilter.value === 'errors') f = addons.value.filter(a => a.status === 'error'); 

        if (!actualSearchQuery.value) return f; 
        const lcq = actualSearchQuery.value.toLowerCase(); 
        return f.filter(a => a.manifest.name.toLowerCase().includes(lcq)); 
    });
    
    const draggableList = computed({ 
        get: () => filteredAddons.value, 
        set(reorderedFilteredList) { 
            if (isMonitoring.value) return; 

            // Questa è un'ottima implementazione per mappare un
            // riordinamento filtrato sull'elenco completo.
            const filteredUrlsMap = new Map(filteredAddons.value.map(a => [a.transportUrl, a]));
            let nextFilteredIndex = 0;
            const newAddonsList = [];

            addons.value.forEach(originalAddon => {
                if (filteredUrlsMap.has(originalAddon.transportUrl)) {
                    if (nextFilteredIndex < reorderedFilteredList.length) {
                        newAddonsList.push(reorderedFilteredList[nextFilteredIndex]);
                        nextFilteredIndex++;
                    }
                } else {
                    newAddonsList.push(originalAddon);
                }
            });
            
            if (JSON.stringify(addons.value.map(a => a.transportUrl)) !== JSON.stringify(newAddonsList.map(a => a.transportUrl))) {
                addons.value = newAddonsList;
                // hasUnsavedChanges è gestito da onDragEnd (da useAddons)
                // che viene attivato nel template dopo questo 'set'.
            }
        } 
    });

    // --- Drag Options ---
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
    
    // --- Computed Counts ---
    const enabledCount = computed(() => addons.value.filter(a => a.isEnabled).length);
    const disabledCount = computed(() => addons.value.filter(a => !a.isEnabled).length);
    const errorCount = computed(() => addons.value.filter(a => a.status === 'error').length);
    
    // --- Selection Logic ---
    const selectedAddons = computed(() => addons.value.filter(a => a.selected));

    // BUG FIX: 'allSelected' ora si basa sull'elenco VISIBILE (filtrato).
    const allSelected = computed(() => {
        // Non ci sono addon visibili, quindi la casella non può essere "selezionata"
        if (filteredAddons.value.length === 0) return false;
        // Controlla se OGNI addon visibile è attualmente selezionato
        return filteredAddons.value.every(a => a.selected);
    });

    // BUG FIX: 'toggleSelectAll' ora opera sull'elenco VISIBILE (filtrato).
    const toggleSelectAll = () => { 
        // Determina lo stato target in base a ciò che è visibile
        const targetState = !allSelected.value; 
        // Applica lo stato solo agli addon visibili
        filteredAddons.value.forEach(addon => addon.selected = targetState); 
    };

    const enableSelected = () => {
        if (isMonitoring.value) return;
        let count = 0;
        selectedAddons.value.forEach(addon => {
            if (!addon.isEnabled) {
                addon.isEnabled = true;
                count++;
            }
            addon.selected = false;
        });
        
        if (count > 0) {
            recordAction(t.value('actions.bulkEnabled', { count: count }));
            showToast(t.value('bulkActions.enabledSuccess', { count: count }), 'success');
            hasUnsavedChanges.value = true;
        } else {
            showToast(t.value('bulkActions.noneToEnable'), 'info');
        }
    };

    const disableSelected = () => { 
        if (isMonitoring.value) return; 
        let count = 0; 
        selectedAddons.value.forEach(addon => { 
            if (addon.isEnabled) { 
                addon.isEnabled = false; 
                count++; 
            } 
            addon.selected = false; 
        }); 
        if (count > 0) { 
            recordAction(t.value('actions.bulkDisabled', { count: count }));
            showToast(t.value('bulkActions.disabledSuccess', { count: count }), 'success'); 
            hasUnsavedChanges.value = true; 
        } else { 
            showToast(t.value('bulkActions.noneToDisable'), 'info'); 
        }
    };

    const removeSelected = () => { 
        if (isMonitoring.value || selectedAddons.value.length === 0) return; 
        if (confirm(t.value('bulkActions.removeConfirm', { count: selectedAddons.value.length }))) { 
            const selectedUrls = new Set(selectedAddons.value.map(a => a.transportUrl)); 
            const originalCount = addons.value.length; 
            const filteredList = addons.value.filter(addon => !selectedUrls.has(addon.transportUrl));
            const removedCount = originalCount - filteredList.length;
            
            if (removedCount > 0) {
                recordAction(t.value('actions.bulkRemoved', { count: removedCount }));
                addons.value = filteredList;
                showToast(t.value('bulkActions.removeSuccess', { count: removedCount }), 'success'); 
                hasUnsavedChanges.value = true; 
            }
        }
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
        allSelected, // Corretto
        toggleSelectAll, // Corretto
        enableSelected,
        disableSelected,
        removeSelected
    };
        }
