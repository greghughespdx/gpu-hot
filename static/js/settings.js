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
    const SIDEBAR_WIDTHS = Object.freeze({
        standard: null,
        comfortable: '72px',
        wide: '96px'
    });
    const SIDEBAR_LABELS = Object.freeze(['index', 'node-index', 'short-name']);
    const ALLOWED_SETTINGS = Object.freeze({
        sidebarWidth: value => Object.prototype.hasOwnProperty.call(SIDEBAR_WIDTHS, value),
        sidebarLabel: value => SIDEBAR_LABELS.includes(value),
        sidebarAutoHide: value => typeof value === 'boolean',
        sidebarPinned: value => typeof value === 'boolean'
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

    function applySidebarSettings(documentRef = global.document) {
        if (!documentRef) return;
        const root = documentRef.documentElement;
        const width = SIDEBAR_WIDTHS[settings.sidebarWidth || 'standard'];
        if (width) {
            root.style.setProperty('--sidebar-width', width);
        } else {
            root.style.removeProperty('--sidebar-width');
        }
        root.classList.toggle('sidebar-auto-hide', settings.sidebarAutoHide === true);
        root.classList.toggle(
            'sidebar-pinned',
            settings.sidebarAutoHide === true && settings.sidebarPinned === true
        );
        if (typeof global.updateSidebarLabels === 'function') {
            global.updateSidebarLabels();
        }
    }

    function initSettingsPanel(documentRef = global.document) {
        const openButton = documentRef.getElementById('settings-open');
        const closeButton = documentRef.getElementById('settings-close');
        const resetButton = documentRef.getElementById('settings-reset');
        const overlay = documentRef.getElementById('settings-overlay');
        const panel = documentRef.getElementById('settings-panel');
        const status = documentRef.getElementById('settings-status');
        const widthSelect = documentRef.getElementById('settings-sidebar-width');
        const labelSelect = documentRef.getElementById('settings-sidebar-label');
        const autoHide = documentRef.getElementById('settings-sidebar-auto-hide');
        const pinned = documentRef.getElementById('settings-sidebar-pinned');
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
            widthSelect.addEventListener('change', () => {
                saveSidebarSetting({
                    key: 'sidebarWidth',
                    value: widthSelect.value,
                    control: widthSelect,
                    previousValue: settings.sidebarWidth || 'standard'
                });
            });
        }
        if (labelSelect) {
            labelSelect.addEventListener('change', () => {
                saveSidebarSetting({
                    key: 'sidebarLabel',
                    value: labelSelect.value,
                    control: labelSelect,
                    previousValue: settings.sidebarLabel || 'index'
                });
            });
        }
        if (autoHide) {
            autoHide.addEventListener('change', () => {
                saveSidebarSetting({
                    key: 'sidebarAutoHide',
                    value: autoHide.checked,
                    control: autoHide,
                    previousValue: settings.sidebarAutoHide === true,
                    relatedSettings: autoHide.checked ? {} : { sidebarPinned: false }
                });
            });
        }
        if (pinned) {
            pinned.addEventListener('change', () => {
                saveSidebarSetting({
                    key: 'sidebarPinned',
                    value: pinned.checked,
                    control: pinned,
                    previousValue: settings.sidebarPinned === true
                });
            });
        }
        syncSidebarControls();
        applySidebarSettings(documentRef);

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
            syncSidebarControls();
            applySidebarSettings(documentRef);
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
    if (global.document) applySidebarSettings(global.document);
    global.GPUHotSettings = Object.freeze({
        STORAGE_KEY,
        STORAGE_VERSION,
        settings,
        loadSettings,
        saveSettings,
        resetSettings,
        applySidebarSettings,
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
