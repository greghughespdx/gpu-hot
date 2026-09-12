/**
 * Browser-local settings storage and settings panel behavior.
 *
 * This script loads in the document head so future visual settings can be
 * applied before the page is painted.
 */
(function initializeSettingsModule(global) {
    'use strict';

    const STORAGE_KEY = 'gpu-hot.settings.v1';
    const STORAGE_VERSION = 1;
    const DEFAULT_SETTINGS = Object.freeze({});
    const CHART_WIDTHS = Object.freeze(['auto', 'wide', 'full']);
    const ALLOWED_SETTINGS = Object.freeze({
        overviewMiniChartWidth: value => CHART_WIDTHS.includes(value)
    });

    function defaultSettings() {
        return { ...DEFAULT_SETTINGS };
    }

    function sanitizeSettings(candidate) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            return defaultSettings();
        }

        const clean = {};
        Object.entries(ALLOWED_SETTINGS).forEach(([key, isAllowed]) => {
            if (isAllowed(candidate[key])) clean[key] = candidate[key];
        });
        return clean;
    }

    function decodeSettings(raw) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        if (raw.version > STORAGE_VERSION) return null;
        if (raw.version !== 0 && raw.version !== STORAGE_VERSION) return null;
        return {
            settings: sanitizeSettings(raw.settings),
            migrated: raw.version === 0
        };
    }

    function loadSettings() {
        try {
            const stored = global.localStorage.getItem(STORAGE_KEY);
            if (stored === null) return defaultSettings();
            const decoded = decodeSettings(JSON.parse(stored));
            if (!decoded) return defaultSettings();
            if (decoded.migrated) saveSettings(decoded.settings);
            return decoded.settings;
        } catch (error) {
            return defaultSettings();
        }
    }

    function saveSettings(settings) {
        try {
            const clean = sanitizeSettings(settings);
            global.localStorage.setItem(STORAGE_KEY, JSON.stringify({
                version: STORAGE_VERSION,
                settings: clean
            }));
            return true;
        } catch (error) {
            return false;
        }
    }

    function resetSettings() {
        try {
            global.localStorage.removeItem(STORAGE_KEY);
            return true;
        } catch (error) {
            return false;
        }
    }

    function resizeOverviewMiniCharts(documentRef) {
        if (!global.Chart || typeof global.Chart.getChart !== 'function') return;
        documentRef.querySelectorAll('.overview-mini-chart canvas').forEach(canvas => {
            const chart = global.Chart.getChart(canvas);
            if (chart && typeof chart.resize === 'function') {
                try { chart.resize(); } catch (error) { }
            }
        });
    }

    function applyOverviewMiniChartWidth(width, documentRef = global.document, resize = true) {
        if (!documentRef) return;
        const selected = CHART_WIDTHS.includes(width) ? width : 'auto';
        const root = documentRef.documentElement;
        root.classList.toggle('overview-chart-width-wide', selected === 'wide');
        root.classList.toggle('overview-chart-width-full', selected === 'full');
        if (resize) resizeOverviewMiniCharts(documentRef);
    }

    function initSettingsPanel(documentRef = global.document) {
        const openButton = documentRef.getElementById('settings-open');
        const closeButton = documentRef.getElementById('settings-close');
        const resetButton = documentRef.getElementById('settings-reset');
        const overlay = documentRef.getElementById('settings-overlay');
        const panel = documentRef.getElementById('settings-panel');
        const status = documentRef.getElementById('settings-status');
        const chartWidth = documentRef.getElementById('settings-overview-chart-width');
        if (!openButton || !closeButton || !resetButton || !overlay || !panel || !status) return;
        if (panel.dataset.settingsInitialized === 'true') return;
        panel.dataset.settingsInitialized = 'true';

        if (chartWidth) {
            chartWidth.value = settings.overviewMiniChartWidth || 'auto';
            chartWidth.addEventListener('change', () => {
                const previous = settings.overviewMiniChartWidth || 'auto';
                const nextSettings = sanitizeSettings({
                    ...settings,
                    overviewMiniChartWidth: chartWidth.value
                });
                const requested = nextSettings.overviewMiniChartWidth || 'auto';
                if (!saveSettings(nextSettings)) {
                    chartWidth.value = previous;
                    status.textContent = 'This display change could not be saved. Try again.';
                    return;
                }
                Object.keys(settings).forEach(key => delete settings[key]);
                Object.assign(settings, nextSettings);
                chartWidth.value = requested;
                applyOverviewMiniChartWidth(requested, documentRef);
                status.textContent = '';
            });
        }

        function isOpen() {
            return !panel.hidden;
        }

        function closePanel() {
            if (!isOpen()) return;
            panel.hidden = true;
            panel.setAttribute('inert', '');
            panel.setAttribute('aria-hidden', 'true');
            overlay.hidden = true;
            openButton.setAttribute('aria-expanded', 'false');
            openButton.focus();
        }

        function openPanel() {
            if (isOpen()) return;
            panel.hidden = false;
            panel.removeAttribute('inert');
            panel.setAttribute('aria-hidden', 'false');
            overlay.hidden = false;
            openButton.setAttribute('aria-expanded', 'true');
            closeButton.focus();
        }

        openButton.addEventListener('click', openPanel);
        closeButton.addEventListener('click', closePanel);
        overlay.addEventListener('click', closePanel);
        resetButton.addEventListener('click', () => {
            if (!resetSettings()) {
                status.textContent = 'Settings could not be reset. Try again.';
                return;
            }
            Object.keys(settings).forEach(key => delete settings[key]);
            if (chartWidth) chartWidth.value = 'auto';
            applyOverviewMiniChartWidth('auto', documentRef);
            status.textContent = 'Settings reset.';
        });
        panel.addEventListener('keydown', event => {
            if (!isOpen()) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closePanel();
                return;
            }
            if (event.key !== 'Tab') return;

            const focusable = Array.from(panel.querySelectorAll(
                'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )).filter(element => !element.hidden);
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && documentRef.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && documentRef.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });

        return { openPanel, closePanel };
    }

    const settings = loadSettings();
    if (global.document) {
        applyOverviewMiniChartWidth(
            settings.overviewMiniChartWidth || 'auto',
            global.document,
            false
        );
    }
    global.GPUHotSettings = Object.freeze({
        STORAGE_KEY,
        STORAGE_VERSION,
        settings,
        loadSettings,
        saveSettings,
        resetSettings,
        applyOverviewMiniChartWidth,
        initSettingsPanel
    });

    if (global.document) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', () => initSettingsPanel(), { once: true });
        } else {
            initSettingsPanel();
        }
    }
})(window);
