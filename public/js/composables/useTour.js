export function useTour(
    ref,
    nextTick,
    isMobile,
    isMonitoring,
    hasUnsavedChanges,
    t,
    showImportConfirm,
    pendingImportData,
    pendingImportNames,
    importSource,
    importedConfigFromUrl
) {
    const showWelcomeScreen = ref(false);
    const showWelcomeTourModal = ref(false);
    const dontShowWelcomeAgain = ref(false);

    const dismissWelcomeScreen = () => {
        showWelcomeScreen.value = false;

        // Se c'è un'importazione URL in sospeso, aprila
        if (importedConfigFromUrl.value) {
            const importedData = importedConfigFromUrl.value;
            pendingImportData.value = importedData;
            pendingImportNames.value = importedData.map(a => a?.manifest?.name || 'Addon Sconosciuto');
            importSource.value = 'url';
            showImportConfirm.value = true;
            importedConfigFromUrl.value = null;
            return;
        }

        try {
            const tourCompleted = localStorage.getItem('stremioConsoleWelcomeCompleted') === 'true';
            if (!tourCompleted) showWelcomeTourModal.value = true;
        } catch (e) {
            console.warn("Cannot read tour preference from localStorage.");
        }
    };

    const skipTour = () => {
        if (dontShowWelcomeAgain.value) {
            try { localStorage.setItem('stremioConsoleWelcomeCompleted', 'true'); } catch(e) { console.warn("Cannot save tour preference."); }
        }
        showWelcomeTourModal.value = false;
    };

    const beginTour = () => {
        if (dontShowWelcomeAgain.value) {
            try { localStorage.setItem('stremioConsoleWelcomeCompleted', 'true'); } catch(e) { console.warn("Cannot save tour preference."); }
        }
        showWelcomeTourModal.value = false;

        nextTick(() => startTour());
    };

    const startTour = () => {
        if (typeof introJs === 'undefined') {
            console.error("intro.js not found.");
            return;
        }

        const originalHasUnsaved = hasUnsavedChanges.value;
        if (!isMonitoring.value && !hasUnsavedChanges.value) hasUnsavedChanges.value = true;

        const steps = [
            { element: document.querySelector('[data-tour="step-1"]'), intro: t.value('tour.steps.s1'), position: 'bottom' },
            { element: document.querySelector('[data-tour="step-2"]'), intro: t.value('tour.steps.s2'), position: isMobile.value ? 'bottom' : 'left' },
            { element: document.querySelector('[data-tour="step-3"]'), intro: t.value('tour.steps.s3'), position: 'bottom' },
            { element: document.querySelector('[data-tour="step-4"]'), intro: t.value('tour.steps.s4'), position: 'top' }
        ];

        const firstAddonItem = document.querySelector('.addon-item');
        if (firstAddonItem && !isMobile.value) {
            steps.push({ element: firstAddonItem.querySelector('[data-tour="step-5"]'), intro: t.value('tour.steps.s5'), position: 'right' });
            steps.push({ element: firstAddonItem.querySelector('[data-tour="step-6"]'), intro: t.value('tour.steps.s6'), position: 'left' });
        }

        const step7 = document.querySelector('[data-tour="step-7"]');
        if (step7) steps.push({ element: step7, intro: t.value('tour.steps.s7'), position: 'bottom' });

        const floatingButton = document.querySelector('[data-tour="step-8"]');
        if (!isMonitoring.value && floatingButton?.classList.contains('visible')) {
            steps.push({ element: floatingButton, intro: t.value('tour.steps.s8'), position: 'left' });
        }

        introJs().setOptions({
            steps: steps.filter(s => s.element),
            tooltipClass: 'introjs-tooltip',
            highlightClass: 'introjs-helperLayer',
            nextLabel: t.value('tour.welcome.startButton').includes('Start') ? 'Next →' : 'Avanti →',
            prevLabel: t.value('tour.welcome.startButton').includes('Start') ? '← Back' : '← Indietro',
            doneLabel: t.value('tour.welcome.startButton').includes('Start') ? 'Done' : 'Fatto',
            exitOnOverlayClick: false,
            showBullets: false
        }).oncomplete(() => {
            if (!isMonitoring.value && !originalHasUnsaved) hasUnsavedChanges.value = false;
        }).onexit(() => {
            if (!isMonitoring.value && !originalHasUnsaved) hasUnsavedChanges.value = false;
        }).start();
    };

    return {
        showWelcomeScreen,
        showWelcomeTourModal,
        dontShowWelcomeAgain,
        dismissWelcomeScreen,
        skipTour,
        beginTour,
        startTour
    };
}
