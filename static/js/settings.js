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
    const MAX_LABEL_OVERRIDES = 512;
    const MAX_LABEL_IDENTITY_LENGTH = 256;
    const MAX_LABEL_LENGTH = 80;
    const labelTargets = new Map();

    function labelKey(kind, nodeName, gpuId = '') {
        return JSON.stringify([kind, String(nodeName), String(gpuId)]);
    }

    function isLabelOverride(candidate) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
        if (!['node', 'gpu'].includes(candidate.kind)) return false;
        if (typeof candidate.node !== 'string' || candidate.node.length === 0
            || candidate.node.length > MAX_LABEL_IDENTITY_LENGTH) return false;
        if (candidate.kind === 'gpu' && (typeof candidate.gpu !== 'string' || candidate.gpu.length === 0
            || candidate.gpu.length > MAX_LABEL_IDENTITY_LENGTH)) return false;
        return typeof candidate.label === 'string'
            && candidate.label.length > 0
            && candidate.label.length <= MAX_LABEL_LENGTH;
    }

    function isLabelOverrides(candidate) {
        if (!Array.isArray(candidate) || candidate.length > MAX_LABEL_OVERRIDES) return false;
        const keys = candidate.map(item => labelKey(item?.kind, item?.node, item?.gpu));
        return candidate.every(isLabelOverride) && new Set(keys).size === keys.length;
    }

    const ALLOWED_SETTINGS = Object.freeze({
        labelOverrides: isLabelOverrides
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

    function overrideMap() {
        return new Map((settings.labelOverrides || []).map(item => [
            labelKey(item.kind, item.node, item.gpu),
            item.label
        ]));
    }

    function displayLabel(key, fallback) {
        return overrideMap().get(key) || fallback;
    }

    function bindLabel(element, key, fallback, output = 'text') {
        if (!element) return;
        element.dataset.displayLabelKey = key;
        element.dataset.displayLabelDefault = fallback;
        element.dataset.displayLabelOutput = output;
        const label = displayLabel(key, fallback);
        if (output === 'title' || output === 'both') element.title = label;
        if (output === 'text' || output === 'both') element.textContent = label;
    }

    function applyDisplayLabels(documentRef = global.document) {
        if (!documentRef) return;
        documentRef.querySelectorAll('[data-display-label-key]').forEach(element => {
            const label = displayLabel(
                element.dataset.displayLabelKey,
                element.dataset.displayLabelDefault || ''
            );
            const output = element.dataset.displayLabelOutput;
            if (output === 'title' || output === 'both') element.title = label;
            if (output === 'text' || output === 'both') element.textContent = label;
        });
    }

    function bindNodeLabel(element, nodeName, fallback = String(nodeName), output = 'text') {
        bindLabel(element, labelKey('node', nodeName), fallback, output);
    }

    function bindGpuLabel(element, nodeName, gpuId, fallback = `GPU ${gpuId}`, output = 'text') {
        bindLabel(element, labelKey('gpu', nodeName, gpuId), fallback, output);
    }

    function renderLabelControls(documentRef = global.document) {
        const list = documentRef?.getElementById('settings-label-list');
        if (!list) return;
        list.replaceChildren();
        const overrides = overrideMap();
        if (labelTargets.size === 0) {
            const empty = documentRef.createElement('p');
            empty.className = 'settings-help';
            empty.textContent = 'Connected GPUs will appear here.';
            list.appendChild(empty);
            return;
        }

        labelTargets.forEach(target => {
            const field = documentRef.createElement('label');
            field.className = 'settings-label-field';
            const caption = documentRef.createElement('span');
            caption.textContent = target.kind === 'node'
                ? `Node: ${target.node}`
                : `GPU: ${target.node} / ${target.gpu}`;
            const input = documentRef.createElement('input');
            input.type = 'text';
            input.maxLength = MAX_LABEL_LENGTH;
            input.placeholder = target.fallback;
            input.value = overrides.get(target.key) || '';
            input.addEventListener('change', () => {
                const previousLabel = overrideMap().get(target.key) || '';
                const label = input.value.trim().slice(0, MAX_LABEL_LENGTH);
                input.value = label;
                const next = (settings.labelOverrides || [])
                    .filter(item => labelKey(item.kind, item.node, item.gpu) !== target.key);
                if (label) next.push({
                    kind: target.kind,
                    node: target.node,
                    ...(target.kind === 'gpu' ? { gpu: target.gpu } : {}),
                    label
                });
                const nextSettings = { ...settings };
                if (next.length > 0) nextSettings.labelOverrides = next;
                else delete nextSettings.labelOverrides;
                if (!saveSettings(nextSettings)) {
                    input.value = previousLabel;
                    const status = documentRef.getElementById('settings-status');
                    if (status) status.textContent = 'Labels could not be saved. Try again.';
                    return;
                }
                Object.keys(settings).forEach(key => delete settings[key]);
                Object.assign(settings, nextSettings);
                applyDisplayLabels(documentRef);
                const status = documentRef.getElementById('settings-status');
                if (status) status.textContent = label ? 'Label saved.' : 'Default label restored.';
            });
            field.append(caption, input);
            list.appendChild(field);
        });
    }

    function registerNodeLabelTarget(nodeName, fallback = String(nodeName)) {
        const node = String(nodeName);
        if (node.length === 0 || node.length > MAX_LABEL_IDENTITY_LENGTH) return;
        const key = labelKey('node', node);
        if (labelTargets.get(key)?.fallback === fallback) return;
        if (!labelTargets.has(key) && labelTargets.size >= MAX_LABEL_OVERRIDES) return;
        labelTargets.set(key, { key, kind: 'node', node, fallback });
        renderLabelControls();
    }

    function registerGpuLabelTarget(nodeName, gpuId, fallback = `GPU ${gpuId}`) {
        const node = String(nodeName);
        const gpu = String(gpuId);
        if (node.length === 0 || gpu.length === 0
            || node.length > MAX_LABEL_IDENTITY_LENGTH || gpu.length > MAX_LABEL_IDENTITY_LENGTH) return;
        const key = labelKey('gpu', node, gpu);
        if (labelTargets.get(key)?.fallback === fallback) return;
        if (!labelTargets.has(key) && labelTargets.size >= MAX_LABEL_OVERRIDES) return;
        labelTargets.set(key, { key, kind: 'gpu', node, gpu, fallback });
        renderLabelControls();
    }

    function initSettingsPanel(documentRef = global.document) {
        const openButton = documentRef.getElementById('settings-open');
        const closeButton = documentRef.getElementById('settings-close');
        const resetButton = documentRef.getElementById('settings-reset');
        const overlay = documentRef.getElementById('settings-overlay');
        const panel = documentRef.getElementById('settings-panel');
        const status = documentRef.getElementById('settings-status');
        if (!openButton || !closeButton || !resetButton || !overlay || !panel || !status) return;
        if (panel.dataset.settingsInitialized === 'true') return;
        panel.dataset.settingsInitialized = 'true';
        renderLabelControls(documentRef);

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
            renderLabelControls(documentRef);
            applyDisplayLabels(documentRef);
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
    global.GPUHotSettings = Object.freeze({
        STORAGE_KEY,
        STORAGE_VERSION,
        settings,
        loadSettings,
        saveSettings,
        resetSettings,
        applyDisplayLabels,
        bindGpuLabel,
        bindNodeLabel,
        initSettingsPanel,
        registerGpuLabelTarget,
        registerNodeLabelTarget
    });

    if (global.document) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', () => initSettingsPanel(), { once: true });
        } else {
            initSettingsPanel();
        }
    }
})(window);
