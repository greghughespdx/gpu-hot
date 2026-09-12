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
    const THEMES = Object.freeze(['default', 'midnight', 'high-contrast']);
    const OVERVIEW_METRICS = Object.freeze([
        'utilization',
        'temperature',
        'memory',
        'power',
        'chart'
    ]);
    const DEFAULT_SETTINGS = Object.freeze({
        ...Object.fromEntries(
            OVERVIEW_METRICS.map(metric => [`overview.${metric}`, true])
        ),
        theme: 'default'
    });
    const CHART_WIDTHS = Object.freeze(['auto', 'wide', 'full']);
    const SIDEBAR_WIDTHS = Object.freeze({
        standard: null,
        comfortable: '72px',
        wide: '96px'
    });
    const SIDEBAR_LABELS = Object.freeze(['index', 'node-index', 'short-name']);
    const MAX_SIDEBAR_ORDER_ENTRIES = 512;
    const MAX_SIDEBAR_ORDER_KEY_LENGTH = 1024;

    function isSidebarOrderKey(candidate) {
        if (typeof candidate !== 'string' || candidate.length > MAX_SIDEBAR_ORDER_KEY_LENGTH) return false;
        try {
            const parts = JSON.parse(candidate);
            return Array.isArray(parts) && parts.length === 2
                && parts.every(part => typeof part === 'string' && part.length > 0);
        } catch (error) {
            return false;
        }
    }

    function isSidebarOrder(candidate) {
        return Array.isArray(candidate)
            && candidate.length <= MAX_SIDEBAR_ORDER_ENTRIES
            && new Set(candidate).size === candidate.length
            && candidate.every(isSidebarOrderKey);
    }

    const ALLOWED_SETTINGS = Object.freeze({
        ...Object.fromEntries(
            OVERVIEW_METRICS.map(metric => [`overview.${metric}`, value => typeof value === 'boolean'])
        ),
        moveConnectionDetails: value => typeof value === 'boolean',
        overviewMiniChartWidth: value => CHART_WIDTHS.includes(value),
        sidebarWidth: value => Object.prototype.hasOwnProperty.call(SIDEBAR_WIDTHS, value),
        sidebarLabel: value => SIDEBAR_LABELS.includes(value),
        sidebarAutoHide: value => typeof value === 'boolean',
        sidebarPinned: value => typeof value === 'boolean',
        theme: value => THEMES.includes(value),
        sidebarOrder: isSidebarOrder
    });

    function defaultSettings() {
        return { ...DEFAULT_SETTINGS };
    }

    function sanitizeSettings(candidate) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            return defaultSettings();
        }

        const clean = defaultSettings();
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

    function applyConnectionDetailsLocation(moveToSettings, documentRef) {
        documentRef.documentElement.classList.toggle(
            'settings-connection-in-panel',
            moveToSettings
        );
        const dashboardHome = documentRef.getElementById('dashboard-status-home');
        const settingsHome = documentRef.getElementById('settings-connection-details');
        const details = documentRef.getElementById('connection-details');
        if (!dashboardHome || !settingsHome || !details) return;

        const destination = moveToSettings ? settingsHome : dashboardHome;
        if (details.parentElement !== destination) destination.appendChild(details);
        dashboardHome.hidden = moveToSettings;
        settingsHome.hidden = !moveToSettings;
    }

    function isOverviewMetricVisible(metric) {
        return settings[`overview.${metric}`] !== false;
    }

    function applyOverviewMetricVisibility(documentRef = global.document) {
        if (!documentRef) return;
        OVERVIEW_METRICS.forEach(metric => {
            const visible = isOverviewMetricVisible(metric);
            documentRef.querySelectorAll(`[data-overview-metric="${metric}"]`).forEach(element => {
                element.hidden = !visible;
            });
        });
        documentRef.querySelectorAll('.overview-gpu-card').forEach(card => {
            card.classList.toggle('overview-chart-hidden', !isOverviewMetricVisible('chart'));
        });
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

    function applySidebarSettings(documentRef = global.document) {
        if (!documentRef) return;
        const root = documentRef.documentElement;
        const width = SIDEBAR_WIDTHS[settings.sidebarWidth || 'standard'];
        if (width) root.style.setProperty('--sidebar-width', width);
        else root.style.removeProperty('--sidebar-width');
        root.classList.toggle('sidebar-auto-hide', settings.sidebarAutoHide === true);
        root.classList.toggle(
            'sidebar-pinned',
            settings.sidebarAutoHide === true && settings.sidebarPinned === true
        );
        if (typeof global.updateSidebarLabels === 'function') global.updateSidebarLabels();
    }

    function applyTheme(theme, documentRef = global.document, announce = true) {
        if (!documentRef) return 'default';
        const selected = THEMES.includes(theme) ? theme : 'default';
        if (selected === 'default') {
            delete documentRef.documentElement.dataset.theme;
        } else {
            documentRef.documentElement.dataset.theme = selected;
        }
        if (announce && typeof global.dispatchEvent === 'function') {
            global.dispatchEvent(new global.CustomEvent('gpu-hot:themechange', {
                detail: { theme: selected }
            }));
        }
        return selected;
    }

    function initSettingsPanel(documentRef = global.document) {
        const openButton = documentRef.getElementById('settings-open');
        const closeButton = documentRef.getElementById('settings-close');
        const resetButton = documentRef.getElementById('settings-reset');
        const overlay = documentRef.getElementById('settings-overlay');
        const panel = documentRef.getElementById('settings-panel');
        const status = documentRef.getElementById('settings-status');
        const moveConnectionDetails = documentRef.getElementById('settings-move-connection-details');
        const chartWidth = documentRef.getElementById('settings-overview-chart-width');
        const widthSelect = documentRef.getElementById('settings-sidebar-width');
        const labelSelect = documentRef.getElementById('settings-sidebar-label');
        const autoHide = documentRef.getElementById('settings-sidebar-auto-hide');
        const pinned = documentRef.getElementById('settings-sidebar-pinned');
        const themeSelect = documentRef.getElementById('settings-theme');
        if (!openButton || !closeButton || !resetButton || !overlay || !panel || !status) return;
        if (panel.dataset.settingsInitialized === 'true') return;
        panel.dataset.settingsInitialized = 'true';

        function syncSidebarControls() {
            if (widthSelect) widthSelect.value = settings.sidebarWidth || 'standard';
            if (labelSelect) labelSelect.value = settings.sidebarLabel || 'index';
            if (autoHide) autoHide.checked = settings.sidebarAutoHide === true;
            if (pinned) {
                pinned.checked = settings.sidebarAutoHide === true
                    && settings.sidebarPinned === true;
                pinned.disabled = settings.sidebarAutoHide !== true;
            }
        }

        function saveSidebarSetting({ key, value, control, previousValue, relatedSettings = {} }) {
            const nextSettings = { ...settings, [key]: value, ...relatedSettings };
            if (!saveSettings(nextSettings)) {
                if (control.type === 'checkbox') control.checked = previousValue;
                else control.value = previousValue;
                status.textContent = 'This display change could not be saved. Try again.';
                return;
            }
            Object.keys(settings).forEach(existingKey => delete settings[existingKey]);
            Object.assign(settings, sanitizeSettings(nextSettings));
            syncSidebarControls();
            applySidebarSettings(documentRef);
            status.textContent = '';
        }

        if (widthSelect) {
            widthSelect.addEventListener('change', () => saveSidebarSetting({
                key: 'sidebarWidth',
                value: widthSelect.value,
                control: widthSelect,
                previousValue: settings.sidebarWidth || 'standard'
            }));
        }
        if (labelSelect) {
            labelSelect.addEventListener('change', () => saveSidebarSetting({
                key: 'sidebarLabel',
                value: labelSelect.value,
                control: labelSelect,
                previousValue: settings.sidebarLabel || 'index'
            }));
        }
        if (autoHide) {
            autoHide.addEventListener('change', () => saveSidebarSetting({
                key: 'sidebarAutoHide',
                value: autoHide.checked,
                control: autoHide,
                previousValue: settings.sidebarAutoHide === true,
                relatedSettings: autoHide.checked ? {} : { sidebarPinned: false }
            }));
        }
        if (pinned) {
            pinned.addEventListener('change', () => saveSidebarSetting({
                key: 'sidebarPinned',
                value: pinned.checked,
                control: pinned,
                previousValue: settings.sidebarPinned === true
            }));
        }
        syncSidebarControls();
        applySidebarSettings(documentRef);
        const metricInputs = Array.from(panel.querySelectorAll('[data-overview-setting]'));
        metricInputs.forEach(input => {
            const metric = input.dataset.overviewSetting;
            input.checked = isOverviewMetricVisible(metric);
            input.addEventListener('change', () => {
                const previousValue = isOverviewMetricVisible(metric);
                const nextSettings = { ...settings, [`overview.${metric}`]: input.checked };
                if (!saveSettings(nextSettings)) {
                    input.checked = previousValue;
                    status.textContent = 'This setting could not be saved. Try again.';
                    return;
                }
                Object.assign(settings, sanitizeSettings(nextSettings));
                status.textContent = '';
                applyOverviewMetricVisibility(documentRef);
            });
        });
        applyOverviewMetricVisibility(documentRef);

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

        if (moveConnectionDetails) {
            moveConnectionDetails.checked = settings.moveConnectionDetails === true;
            applyConnectionDetailsLocation(moveConnectionDetails.checked, documentRef);
            moveConnectionDetails.addEventListener('change', () => {
                const previous = settings.moveConnectionDetails === true;
                const requested = moveConnectionDetails.checked;
                if (!saveSettings({ ...settings, moveConnectionDetails: requested })) {
                    moveConnectionDetails.checked = previous;
                    status.textContent = 'This display change could not be saved. Try again.';
                    return;
                }
                settings.moveConnectionDetails = requested;
                applyConnectionDetailsLocation(requested, documentRef);
                status.textContent = '';
            });
        }

        if (themeSelect) {
            themeSelect.value = settings.theme;
            themeSelect.addEventListener('change', () => {
                const previous = settings.theme;
                const nextSettings = sanitizeSettings({ ...settings, theme: themeSelect.value });
                if (!saveSettings(nextSettings)) {
                    themeSelect.value = previous;
                    status.textContent = 'This display change could not be saved. Try again.';
                    return;
                }
                Object.assign(settings, nextSettings);
                themeSelect.value = settings.theme;
                applyTheme(settings.theme, documentRef);
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
            if (settings.sidebarAutoHide === true && settings.sidebarPinned !== true) {
                openButton.blur();
            }
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
            Object.assign(settings, defaultSettings());
            if (moveConnectionDetails) {
                moveConnectionDetails.checked = false;
                applyConnectionDetailsLocation(false, documentRef);
            }
            metricInputs.forEach(input => {
                input.checked = isOverviewMetricVisible(input.dataset.overviewSetting);
            });
            applyOverviewMetricVisibility(documentRef);
            if (chartWidth) chartWidth.value = 'auto';
            applyOverviewMiniChartWidth('auto', documentRef);
            syncSidebarControls();
            applySidebarSettings(documentRef);
            if (themeSelect) themeSelect.value = settings.theme;
            applyTheme(settings.theme, documentRef);
            if (typeof global.applySidebarOrder === 'function') global.applySidebarOrder();
            if (typeof global.applyDashboardOrder === 'function') global.applyDashboardOrder();
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
            )).filter(element => {
                for (let current = element; current && panel.contains(current); current = current.parentElement) {
                    const style = global.getComputedStyle(current);
                    if (current.hidden || style.display === 'none' || style.visibility === 'hidden') {
                        return false;
                    }
                }
                return true;
            });
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
        applyConnectionDetailsLocation(settings.moveConnectionDetails === true, global.document);
        applyOverviewMiniChartWidth(
            settings.overviewMiniChartWidth || 'auto',
            global.document,
            false
        );
        applySidebarSettings(global.document);
        applyTheme(settings.theme, global.document, false);
    }
    global.GPUHotSettings = Object.freeze({
        STORAGE_KEY,
        STORAGE_VERSION,
        THEMES,
        settings,
        loadSettings,
        saveSettings,
        resetSettings,
        applyConnectionDetailsLocation,
        isOverviewMetricVisible,
        applyOverviewMetricVisibility,
        applyOverviewMiniChartWidth,
        applySidebarSettings,
        applyTheme,
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
