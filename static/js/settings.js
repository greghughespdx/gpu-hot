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
    const NOTICE_SETTINGS = Object.freeze([
        'noticeGpuThrottle',
        'noticeGpuMissing',
        'noticeNodeOffline',
        'noticeExternalFanStopped'
    ]);
    const DEFAULT_SETTINGS = Object.freeze({
        ...Object.fromEntries(
            OVERVIEW_METRICS.map(metric => [`overview.${metric}`, true])
        ),
        theme: 'default',
        showStarPrompt: true,
        overviewMiniChartBehindDim: 30,
        ...Object.fromEntries(NOTICE_SETTINGS.map(key => [key, false]))
    });
    const CHART_WIDTHS = Object.freeze(['auto', 'wide', 'full', 'behind']);
    const SIDEBAR_WIDTHS = Object.freeze({
        standard: null,
        comfortable: '72px',
        wide: '96px'
    });
    const SIDEBAR_LABELS = Object.freeze(['index', 'node-index', 'short-name']);
    const MAX_SIDEBAR_ORDER_ENTRIES = 512;
    const MAX_SIDEBAR_ORDER_KEY_LENGTH = 1024;
    const MAX_LABEL_OVERRIDES = 512;
    const MAX_LABEL_IDENTITY_LENGTH = 256;
    const MAX_LABEL_LENGTH = 80;
    const labelTargets = new Map();

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

    function normalizeLabelOverrides(candidate) {
        if (!Array.isArray(candidate)) return undefined;
        const normalized = [];
        const keys = new Set();
        for (const labelOverride of candidate) {
            if (!isLabelOverride(labelOverride)) continue;
            const key = labelKey(labelOverride.kind, labelOverride.node, labelOverride.gpu);
            if (keys.has(key)) continue;
            keys.add(key);
            normalized.push({
                kind: labelOverride.kind,
                node: labelOverride.node,
                ...(labelOverride.kind === 'gpu' ? { gpu: labelOverride.gpu } : {}),
                label: labelOverride.label
            });
            if (normalized.length === MAX_LABEL_OVERRIDES) break;
        }
        return normalized.length > 0 ? normalized : undefined;
    }

    const ALLOWED_SETTINGS = Object.freeze({
        ...Object.fromEntries(
            OVERVIEW_METRICS.map(metric => [`overview.${metric}`, value => typeof value === 'boolean'])
        ),
        moveConnectionDetails: value => typeof value === 'boolean',
        overviewMiniChartWidth: value => CHART_WIDTHS.includes(value),
        overviewMiniChartBehindDim: value => Number.isInteger(value) && value >= 10 && value <= 100,
        sidebarWidth: value => Object.prototype.hasOwnProperty.call(SIDEBAR_WIDTHS, value),
        sidebarLabel: value => SIDEBAR_LABELS.includes(value),
        sidebarAutoHide: value => typeof value === 'boolean',
        sidebarPinned: value => typeof value === 'boolean',
        showStarPrompt: value => typeof value === 'boolean',
        theme: value => THEMES.includes(value),
        sidebarOrder: isSidebarOrder,
        labelOverrides: normalizeLabelOverrides,
        ...Object.fromEntries(NOTICE_SETTINGS.map(key => [key, value => typeof value === 'boolean']))
    });

    function defaultSettings() {
        return { ...DEFAULT_SETTINGS };
    }

    function sanitizeSettings(candidate) {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
            return defaultSettings();
        }

        const clean = defaultSettings();
        Object.entries(ALLOWED_SETTINGS).forEach(([key, validator]) => {
            if (key === 'labelOverrides') {
                const normalized = validator(candidate[key]);
                if (normalized !== undefined) clean[key] = normalized;
            } else if (validator(candidate[key])) {
                clean[key] = candidate[key];
            }
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

    function visibleOverviewMetricCount() {
        return OVERVIEW_METRICS
            .filter(metric => metric !== 'chart' && isOverviewMetricVisible(metric))
            .length;
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
            card.dataset.overviewVisibleMetrics = String(visibleOverviewMetricCount());
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

    function overrideMap() {
        return new Map((settings.labelOverrides || []).map(item => [
            labelKey(item.kind, item.node, item.gpu),
            item.label
        ]));
    }

    function displayLabel(key, fallback) {
        return overrideMap().get(key) || fallback;
    }

    function nodeDisplayLabel(nodeName, fallback = String(nodeName)) {
        return displayLabel(labelKey('node', nodeName), fallback);
    }

    function gpuDisplayLabel(nodeName, gpuId, fallback = `GPU ${gpuId}`) {
        return displayLabel(labelKey('gpu', nodeName, gpuId), fallback);
    }

    function bindLabel(element, key, fallback, output = 'text') {
        if (!element) return;
        element.dataset.displayLabelKey = key;
        const label = displayLabel(key, fallback);
        if (output === 'title' || output === 'both') {
            element.dataset.displayLabelTitleDefault = fallback;
            element.title = label;
        }
        if (output === 'text' || output === 'both') {
            element.dataset.displayLabelTextDefault = fallback;
            element.textContent = label;
        }
    }

    function applyDisplayLabels(documentRef = global.document) {
        if (!documentRef) return;
        documentRef.querySelectorAll('[data-display-label-key]').forEach(element => {
            const key = element.dataset.displayLabelKey;
            if (element.dataset.displayLabelTitleDefault !== undefined) {
                element.title = displayLabel(key, element.dataset.displayLabelTitleDefault);
            }
            if (element.dataset.displayLabelTextDefault !== undefined) {
                element.textContent = displayLabel(key, element.dataset.displayLabelTextDefault);
            }
        });
    }

    function applyOverviewMiniChartWidth(width, documentRef = global.document, resize = true) {
        if (!documentRef) return;
        const selected = CHART_WIDTHS.includes(width) ? width : 'auto';
        const root = documentRef.documentElement;
        root.classList.toggle('overview-chart-width-wide', selected === 'wide');
        root.classList.toggle('overview-chart-width-full', selected === 'full');
        root.classList.toggle('overview-chart-width-behind', selected === 'behind');
        if (resize) resizeOverviewMiniCharts(documentRef);
    }

    function applyOverviewMiniChartBehindDim(value, documentRef = global.document) {
        if (!documentRef) return;
        const selected = ALLOWED_SETTINGS.overviewMiniChartBehindDim(value) ? value : 30;
        documentRef.documentElement.style.setProperty(
            '--overview-chart-behind-dim',
            String(selected / 100)
        );
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
                global.GPUHotNotices?.render?.();
                const status = documentRef.getElementById('settings-status');
                if (status) status.textContent = label ? 'Label saved.' : 'Default label restored.';
            });
            field.append(caption, input);
            list.appendChild(field);
        });
        updateSettingsPanelOverflow(documentRef);
    }

    function updateSettingsPanelOverflow(documentRef = global.document) {
        const panel = documentRef?.getElementById('settings-panel');
        if (!panel || panel.hidden) return;
        panel.classList.remove('settings-overflow');
        panel.classList.toggle('settings-overflow', panel.scrollHeight > panel.clientHeight);
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
        const moveConnectionDetails = documentRef.getElementById('settings-move-connection-details');
        const chartWidth = documentRef.getElementById('settings-overview-chart-width');
        const chartBehindDim = documentRef.getElementById('settings-overview-chart-behind-dim');
        const chartBehindDimField = documentRef.getElementById('settings-overview-chart-behind-dim-field');
        const chartBehindDimValue = documentRef.getElementById('settings-overview-chart-behind-dim-value');
        const widthSelect = documentRef.getElementById('settings-sidebar-width');
        const labelSelect = documentRef.getElementById('settings-sidebar-label');
        const autoHide = documentRef.getElementById('settings-sidebar-auto-hide');
        const pinned = documentRef.getElementById('settings-sidebar-pinned');
        const showStarPrompt = documentRef.getElementById('settings-show-star-prompt');
        const themeSelect = documentRef.getElementById('settings-theme');
        if (!openButton || !closeButton || !resetButton || !overlay || !panel || !status) return;
        const noticeInputs = Array.from(panel.querySelectorAll('[data-notice-setting]'));
        if (panel.dataset.settingsInitialized === 'true') return;
        panel.dataset.settingsInitialized = 'true';
        renderLabelControls(documentRef);

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
            const syncBehindDimControl = () => {
                if (chartBehindDimField) chartBehindDimField.hidden = chartWidth.value !== 'behind';
            };
            chartWidth.value = settings.overviewMiniChartWidth || 'auto';
            syncBehindDimControl();
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
                syncBehindDimControl();
                status.textContent = '';
            });
        }

        if (chartBehindDim) {
            const syncBehindDimValue = value => {
                chartBehindDim.value = String(value);
                if (chartBehindDimValue) chartBehindDimValue.textContent = `${value}%`;
            };
            syncBehindDimValue(settings.overviewMiniChartBehindDim || 30);
            chartBehindDim.addEventListener('input', () => {
                const requested = Number(chartBehindDim.value);
                if (ALLOWED_SETTINGS.overviewMiniChartBehindDim(requested) && chartBehindDimValue) {
                    chartBehindDimValue.textContent = `${requested}%`;
                }
            });
            chartBehindDim.addEventListener('change', () => {
                const previous = settings.overviewMiniChartBehindDim || 30;
                const requested = Number(chartBehindDim.value);
                const nextSettings = sanitizeSettings({
                    ...settings,
                    overviewMiniChartBehindDim: requested
                });
                if (!ALLOWED_SETTINGS.overviewMiniChartBehindDim(requested)
                    || !saveSettings(nextSettings)) {
                    syncBehindDimValue(previous);
                    status.textContent = 'This display change could not be saved. Try again.';
                    return;
                }
                Object.keys(settings).forEach(key => delete settings[key]);
                Object.assign(settings, nextSettings);
                syncBehindDimValue(settings.overviewMiniChartBehindDim);
                applyOverviewMiniChartBehindDim(settings.overviewMiniChartBehindDim, documentRef);
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

        noticeInputs.forEach(input => {
            const key = input.dataset.noticeSetting;
            input.checked = settings[key] === true;
            input.addEventListener('change', () => {
                const previous = settings[key] === true;
                const nextSettings = sanitizeSettings({ ...settings, [key]: input.checked });
                if (!saveSettings(nextSettings)) {
                    input.checked = previous;
                    status.textContent = 'This notice choice could not be saved. Try again.';
                    return;
                }
                Object.keys(settings).forEach(existingKey => delete settings[existingKey]);
                Object.assign(settings, nextSettings);
                status.textContent = '';
                global.GPUHotNotices?.settingsChanged?.();
            });
        });

        if (showStarPrompt) {
            showStarPrompt.checked = settings.showStarPrompt !== false;
            showStarPrompt.addEventListener('change', () => {
                const previous = settings.showStarPrompt !== false;
                const nextSettings = sanitizeSettings({
                    ...settings,
                    showStarPrompt: showStarPrompt.checked
                });
                if (!saveSettings(nextSettings)) {
                    showStarPrompt.checked = previous;
                    status.textContent = 'This choice could not be saved. Try again.';
                    return;
                }
                Object.keys(settings).forEach(key => delete settings[key]);
                Object.assign(settings, nextSettings);
                global.setStarPromptEnabled?.(settings.showStarPrompt);
                status.textContent = '';
            });
        }

        function isOpen() {
            return !panel.hidden;
        }

        function closePanel() {
            if (!isOpen()) return;
            documentRef.removeEventListener('keydown', handleDocumentKeydown);
            documentRef.removeEventListener('focusin', handleDocumentFocus);
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
            documentRef.addEventListener('keydown', handleDocumentKeydown);
            panel.hidden = false;
            panel.removeAttribute('inert');
            panel.setAttribute('aria-hidden', 'false');
            overlay.hidden = false;
            openButton.setAttribute('aria-expanded', 'true');
            updateSettingsPanelOverflow(documentRef);
            closeButton.focus();
            documentRef.addEventListener('focusin', handleDocumentFocus);
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
            if (chartBehindDim) chartBehindDim.value = '30';
            if (chartBehindDimValue) chartBehindDimValue.textContent = '30%';
            if (chartBehindDimField) chartBehindDimField.hidden = true;
            applyOverviewMiniChartBehindDim(30, documentRef);
            syncSidebarControls();
            applySidebarSettings(documentRef);
            if (themeSelect) themeSelect.value = settings.theme;
            applyTheme(settings.theme, documentRef);
            noticeInputs.forEach(input => {
                input.checked = false;
            });
            global.GPUHotNotices?.settingsChanged?.();
            if (showStarPrompt) showStarPrompt.checked = true;
            global.setStarPromptEnabled?.(true);
            if (typeof global.applySidebarOrder === 'function') global.applySidebarOrder();
            if (typeof global.applyDashboardOrder === 'function') global.applyDashboardOrder();
            renderLabelControls(documentRef);
            applyDisplayLabels(documentRef);
            status.textContent = 'Settings reset.';
        });
        function panelFocusableControls() {
            return Array.from(panel.querySelectorAll(
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
        }

        function handleDocumentFocus(event) {
            if (!isOpen() || panel.contains(event.target)) return;
            (panelFocusableControls()[0] || closeButton).focus();
        }

        function handleDocumentKeydown(event) {
            if (!isOpen()) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closePanel();
                return;
            }
            if (event.key !== 'Tab') return;

            const focusable = panelFocusableControls();
            if (focusable.length === 0) return;
            const activeIndex = focusable.indexOf(documentRef.activeElement);
            const nextIndex = event.shiftKey
                ? (activeIndex <= 0 ? focusable.length - 1 : activeIndex - 1)
                : (activeIndex < 0 || activeIndex === focusable.length - 1 ? 0 : activeIndex + 1);
            event.preventDefault();
            focusable[nextIndex].focus();
        }

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
        applyOverviewMiniChartBehindDim(settings.overviewMiniChartBehindDim, global.document);
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
        visibleOverviewMetricCount,
        applyOverviewMetricVisibility,
        applyOverviewMiniChartWidth,
        applyOverviewMiniChartBehindDim,
        applySidebarSettings,
        applyTheme,
        applyDisplayLabels,
        bindGpuLabel,
        bindNodeLabel,
        updateSettingsPanelOverflow,
        nodeDisplayLabel,
        gpuDisplayLabel,
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
