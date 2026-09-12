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
    const OVERVIEW_METRICS = Object.freeze([
        'utilization',
        'temperature',
        'memory',
        'power',
        'chart'
    ]);
    const DEFAULT_SETTINGS = Object.freeze(Object.fromEntries(
        OVERVIEW_METRICS.map(metric => [`overview.${metric}`, true])
    ));
    const ALLOWED_SETTINGS = Object.freeze({
        ...Object.fromEntries(
            OVERVIEW_METRICS.map(metric => [`overview.${metric}`, value => typeof value === 'boolean'])
        ),
        moveConnectionDetails: value => typeof value === 'boolean'
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

    function initSettingsPanel(documentRef = global.document) {
        const openButton = documentRef.getElementById('settings-open');
        const closeButton = documentRef.getElementById('settings-close');
        const resetButton = documentRef.getElementById('settings-reset');
        const overlay = documentRef.getElementById('settings-overlay');
        const panel = documentRef.getElementById('settings-panel');
        const status = documentRef.getElementById('settings-status');
        const moveConnectionDetails = documentRef.getElementById('settings-move-connection-details');
        if (!openButton || !closeButton || !resetButton || !overlay || !panel || !status) return;
        if (panel.dataset.settingsInitialized === 'true') return;
        panel.dataset.settingsInitialized = 'true';
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
            Object.assign(settings, defaultSettings());
            if (moveConnectionDetails) {
                moveConnectionDetails.checked = false;
                applyConnectionDetailsLocation(false, documentRef);
            }
            metricInputs.forEach(input => {
                input.checked = isOverviewMetricVisible(input.dataset.overviewSetting);
            });
            applyOverviewMetricVisibility(documentRef);
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
    }
    global.GPUHotSettings = Object.freeze({
        STORAGE_KEY,
        STORAGE_VERSION,
        settings,
        loadSettings,
        saveSettings,
        resetSettings,
        applyConnectionDetailsLocation,
        isOverviewMetricVisible,
        applyOverviewMetricVisibility,
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
