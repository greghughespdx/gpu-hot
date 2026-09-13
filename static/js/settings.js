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
    const CORE_OVERVIEW_METRICS = Object.freeze([
        'utilization',
        'temperature',
        'memory',
        'power'
    ]);
    const EXTRA_OVERVIEW_METRICS = Object.freeze([
        'fan-speed',
        'graphics-clock',
        'memory-clock',
        'memory-used',
        'power-limit',
        'memory-temperature',
        'throttle-status',
        'process-count',
        'pcie-generation',
        'pcie-width',
        'encoder-load',
        'decoder-load',
        'performance-state'
    ]);
    const OVERVIEW_METRICS = Object.freeze([
        ...CORE_OVERVIEW_METRICS,
        ...EXTRA_OVERVIEW_METRICS,
        'chart'
    ]);
    const METRIC_ORDER = Object.freeze([...CORE_OVERVIEW_METRICS, ...EXTRA_OVERVIEW_METRICS]);
    const NOTICE_SETTINGS = Object.freeze([
        'noticeGpuThrottle',
        'noticeGpuMissing',
        'noticeNodeOffline',
        'noticeExternalFanStopped'
    ]);
    const DEFAULT_SETTINGS = Object.freeze({
        ...Object.fromEntries(CORE_OVERVIEW_METRICS.map(metric => [`overview.${metric}`, true])),
        ...Object.fromEntries(EXTRA_OVERVIEW_METRICS.map(metric => [`overview.${metric}`, false])),
        'overview.chart': true,
        overviewMetricOrder: METRIC_ORDER,
        overviewMetricsCustomized: false,
        theme: 'default',
        showStarPrompt: true,
        overviewMiniChartBehindDim: 25,
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
    const pendingLabelDrafts = new Map();
    const detachingLabelInputs = new WeakSet();

    function normalizeMetricOrder(candidate) {
        if (!Array.isArray(candidate) || candidate.length > METRIC_ORDER.length) return null;
        const seen = new Set();
        for (const metric of candidate) {
            if (!METRIC_ORDER.includes(metric) || seen.has(metric)) return null;
            seen.add(metric);
        }
        return [...candidate, ...METRIC_ORDER.filter(metric => !seen.has(metric))];
    }

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
        showStarPrompt: value => typeof value === 'boolean',
        theme: value => THEMES.includes(value),
        sidebarOrder: isSidebarOrder,
        overviewMetricOrder: value => normalizeMetricOrder(value) !== null,
        overviewMetricsCustomized: value => typeof value === 'boolean',
        labelOverrides: normalizeLabelOverrides,
        ...Object.fromEntries(NOTICE_SETTINGS.map(key => [key, value => typeof value === 'boolean']))
    });

    function defaultSettings() {
        return { ...DEFAULT_SETTINGS, overviewMetricOrder: [...METRIC_ORDER] };
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
            } else if (key === 'overviewMetricOrder') {
                const normalized = normalizeMetricOrder(candidate[key]);
                if (normalized) clean[key] = normalized;
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
                || Object.prototype.hasOwnProperty.call(raw.settings || {}, 'sidebarPinned')
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

    function singleMetricsCustomized() {
        return settings.overviewMetricsCustomized === true
            || METRIC_ORDER.some((metric, index) => settings.overviewMetricOrder[index] !== metric)
            || CORE_OVERVIEW_METRICS.some(metric => !isOverviewMetricVisible(metric))
            || EXTRA_OVERVIEW_METRICS.some(metric => isOverviewMetricVisible(metric))
            || !isOverviewMetricVisible('chart');
    }

    function prepareSingleMetricCells(card) {
        const grid = card.querySelector('.sgo-metrics-grid');
        if (!grid) return;
        const gpuId = card.dataset.gpuId;
        for (const [metric, prefix] of [
            ['utilization', 'sgo-util-'], ['temperature', 'sgo-temp-'],
            ['memory', 'sgo-mem-'], ['power', 'sgo-power-'], ['fan-speed', 'sgo-fan-']
        ]) {
            card.ownerDocument.getElementById(`${prefix}${gpuId}`)
                ?.closest('.metric-cell')?.setAttribute('data-overview-metric', metric);
        }
        EXTRA_OVERVIEW_METRICS.filter(metric => metric !== 'fan-speed').forEach(metric => {
            if (grid.querySelector(`[data-overview-extra="${metric}"]`)) return;
            const cell = card.ownerDocument.createElement('div');
            cell.className = 'metric-cell overview-metric single-overview-extra';
            cell.dataset.overviewMetric = metric;
            cell.dataset.overviewExtra = metric;
            const value = card.ownerDocument.createElement('div');
            value.className = 'overview-metric-value';
            value.id = `overview-extra-${metric}-${gpuId}`;
            value.textContent = 'Not reported';
            const label = card.ownerDocument.createElement('div');
            label.className = 'overview-metric-label';
            label.textContent = metric.replaceAll('-', ' ').toUpperCase();
            cell.append(value, label);
            grid.appendChild(cell);
        });
    }

    function restoreSingleMetricCells(card) {
        const grid = card.querySelector('.sgo-metrics-grid');
        if (!grid) return;
        if (!grid.querySelector('[data-overview-metric], .single-overview-extra')) return;
        grid.querySelectorAll('.single-overview-extra').forEach(cell => cell.remove());
        const cells = Array.from(grid.querySelectorAll(':scope > .metric-cell'));
        cells.forEach(cell => {
            cell.removeAttribute('data-overview-metric');
            cell.hidden = false;
        });
        const gpuId = card.dataset.gpuId;
        ['sgo-util-', 'sgo-temp-', 'sgo-mem-', 'sgo-power-', 'sgo-fan-']
            .forEach(prefix => {
                const cell = card.ownerDocument.getElementById(`${prefix}${gpuId}`)?.closest('.metric-cell');
                if (cell) grid.appendChild(cell);
            });
    }

    function applyOverviewMetricOrder(documentRef = global.document) {
        if (!documentRef) return;
        const order = settings.overviewMetricOrder || METRIC_ORDER;
        const cards = documentRef.matches?.('.overview-gpu-card, .single-gpu-overview')
            ? [documentRef]
            : Array.from(documentRef.querySelectorAll('.overview-gpu-card, .single-gpu-overview'));
        cards.forEach(card => {
            const single = card.classList.contains('single-gpu-overview');
            if (single && !singleMetricsCustomized()) {
                restoreSingleMetricCells(card);
                card.querySelector('.sgo-mini-chart')?.removeAttribute('hidden');
                return;
            }
            if (single) prepareSingleMetricCells(card);
            const grid = card.querySelector(single ? '.sgo-metrics-grid' : '.overview-metrics');
            if (!grid) return;
            const cells = new Map(Array.from(grid.querySelectorAll(':scope > [data-overview-metric]'))
                .map(cell => [cell.dataset.overviewMetric, cell]));
            const orderedCells = order.map(metric => cells.get(metric)).filter(Boolean);
            if (orderedCells.some((cell, index) => cell !== Array.from(cells.values())[index])) {
                orderedCells.forEach(cell => grid.appendChild(cell));
            }
        });
    }

    function resetOverviewBehindMask(card, chart) {
        card.style.removeProperty('--overview-chart-behind-fade-start');
        card.style.removeProperty('--overview-chart-behind-fade-end');
        chart?.style.removeProperty('-webkit-mask-image');
        chart?.style.removeProperty('mask-image');
    }

    function renderedMetricTextRight(metric) {
        let right = -Infinity;
        metric.querySelectorAll('.overview-metric-value, .overview-metric-label').forEach(element => {
            const range = metric.ownerDocument.createRange();
            if (typeof range.getBoundingClientRect !== 'function') return;
            range.selectNodeContents(element);
            right = Math.max(right, range.getBoundingClientRect().right);
        });
        return Number.isFinite(right) ? right : metric.getBoundingClientRect().right;
    }

    function setOverviewBehindMask(card, visibleCount) {
        const chart = card.querySelector('.overview-mini-chart');
        if (visibleCount === 0) {
            resetOverviewBehindMask(card, chart);
            return;
        }
        const visibleMetrics = Array.from(card.querySelectorAll('.overview-metric'))
            .filter(metric => !metric.hidden);
        if (!chart || visibleMetrics.length === 0) return;
        const firstMetric = visibleMetrics[0].getBoundingClientRect();
        const lastMetricElement = visibleMetrics[visibleMetrics.length - 1];
        const lastMetric = lastMetricElement.getBoundingClientRect();
        if (Math.abs(lastMetric.top - firstMetric.top) > 1) {
            card.style.removeProperty('--overview-chart-behind-fade-start');
            card.style.removeProperty('--overview-chart-behind-fade-end');
            chart.style.setProperty('-webkit-mask-image', 'none');
            chart.style.setProperty('mask-image', 'none');
            return;
        }
        resetOverviewBehindMask(card, chart);
        const chartLeft = chart.getBoundingClientRect().left;
        const textRight = card.ownerDocument.documentElement.classList.contains('overview-chart-width-behind')
            ? renderedMetricTextRight(lastMetricElement)
            : lastMetric.right;
        const fadeStart = `calc(${textRight - chartLeft}px + var(--overview-chart-behind-text-pad))`;
        card.style.setProperty(
            '--overview-chart-behind-fade-start',
            fadeStart
        );
        card.style.setProperty(
            '--overview-chart-behind-fade-end',
            'calc(var(--overview-chart-behind-fade-start) + var(--overview-metric-gap))'
        );
    }

    let overviewMaskFrame = null;
    function scheduleOverviewBehindMasks(documentRef = global.document) {
        if (!documentRef || overviewMaskFrame !== null) return;
        overviewMaskFrame = global.requestAnimationFrame(() => {
            overviewMaskFrame = null;
            const visibleCount = visibleOverviewMetricCount();
            documentRef.querySelectorAll('.overview-gpu-card').forEach(card => {
                setOverviewBehindMask(card, visibleCount);
            });
        });
    }

    function applyOverviewMetricVisibility(documentRef = global.document) {
        if (!documentRef) return;
        applyOverviewMetricOrder(documentRef);
        OVERVIEW_METRICS.forEach(metric => {
            const visible = isOverviewMetricVisible(metric);
            documentRef.querySelectorAll(`[data-overview-metric="${metric}"]`).forEach(element => {
                if (!singleMetricsCustomized() && element.closest('.single-gpu-overview')) return;
                element.hidden = !visible;
            });
        });
        documentRef.querySelectorAll('.single-gpu-overview .sgo-mini-chart').forEach(chart => {
            chart.hidden = singleMetricsCustomized() && !isOverviewMetricVisible('chart');
        });
        global.refreshVisibleOverviewExtraMetrics?.(documentRef);
        documentRef.querySelectorAll('.overview-gpu-card').forEach(card => {
            card.classList.toggle('overview-chart-hidden', !isOverviewMetricVisible('chart'));
            const visibleCount = visibleOverviewMetricCount();
            card.dataset.overviewVisibleMetrics = String(visibleCount);
            card.classList.toggle(
                'overview-has-extra-metrics',
                EXTRA_OVERVIEW_METRICS.some(isOverviewMetricVisible)
            );
            setOverviewBehindMask(card, visibleCount);
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
        scheduleOverviewBehindMasks(documentRef);
    }

    function applyOverviewMiniChartWidth(width, documentRef = global.document, resize = true) {
        if (!documentRef) return;
        const selected = CHART_WIDTHS.includes(width) ? width : 'auto';
        const root = documentRef.documentElement;
        root.classList.toggle('overview-chart-width-wide', selected === 'wide');
        root.classList.toggle('overview-chart-width-full', selected === 'full');
        root.classList.toggle('overview-chart-width-behind', selected === 'behind');
        documentRef.querySelectorAll('.overview-gpu-card').forEach(card => {
            setOverviewBehindMask(card, visibleOverviewMetricCount());
        });
        if (resize) resizeOverviewMiniCharts(documentRef);
    }

    function applyOverviewMiniChartBehindDim(value, documentRef = global.document) {
        if (!documentRef) return;
        const selected = ALLOWED_SETTINGS.overviewMiniChartBehindDim(value) ? value : 25;
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

    function shownLabelName(target, documentRef) {
        const displayed = Array.from(documentRef.querySelectorAll('[data-display-label-key]'))
            .find(element => element.dataset.displayLabelKey === target.key
                && !element.closest('#settings-panel'));
        return displayed?.textContent?.trim() || displayed?.title || displayLabel(target.key, target.fallback);
    }

    function refreshLabelControlNames(documentRef) {
        documentRef.querySelectorAll('.settings-label-node').forEach(group => {
            group.querySelector('h4').textContent = nodeDisplayLabel(group.dataset.node);
        });
        documentRef.querySelectorAll('.settings-label-field[data-label-key]').forEach(field => {
            const target = labelTargets.get(field.dataset.labelKey);
            if (!target) return;
            const caption = field.querySelector('span');
            caption.textContent = target.kind === 'node'
                ? `Node name (shown as ${shownLabelName(target, documentRef)})`
                : `GPU ${target.gpu} (shown as ${shownLabelName(target, documentRef)})`;
        });
    }

    function prepareLabelFieldRemoval(field, documentRef) {
        const input = field.querySelector('input');
        if (!input) return;
        if (documentRef.activeElement === input
            && input.value !== (overrideMap().get(field.dataset.labelKey) || '')) {
            const key = field.dataset.labelKey;
            if (pendingLabelDrafts.has(key) || pendingLabelDrafts.size < MAX_LABEL_OVERRIDES) {
                pendingLabelDrafts.set(key, {
                    value: input.value,
                    start: input.selectionStart,
                    end: input.selectionEnd
                });
            }
        }
        // Chromium can emit change when an edited input is detached.
        detachingLabelInputs.add(input);
    }

    function renderLabelControls(documentRef = global.document) {
        const list = documentRef?.getElementById('settings-label-list');
        if (!list) return;
        const overrides = overrideMap();
        if (labelTargets.size === 0) {
            list.querySelectorAll('.settings-label-field').forEach(field => {
                prepareLabelFieldRemoval(field, documentRef);
            });
            list.replaceChildren();
            const empty = documentRef.createElement('p');
            empty.className = 'settings-help';
            empty.textContent = 'Connected GPUs will appear here.';
            list.appendChild(empty);
            return;
        }
        list.querySelector('.settings-help')?.remove();

        const targetsByNode = new Map();
        labelTargets.forEach(target => {
            if (!targetsByNode.has(target.node)) targetsByNode.set(target.node, []);
            targetsByNode.get(target.node).push(target);
        });

        targetsByNode.forEach((targets, nodeName) => {
            let group = Array.from(list.querySelectorAll('.settings-label-node'))
                .find(element => element.dataset.node === nodeName);
            if (!group) {
                group = documentRef.createElement('div');
                group.className = 'settings-label-node';
                group.dataset.node = nodeName;
                const heading = documentRef.createElement('h4');
                heading.textContent = nodeDisplayLabel(nodeName);
                group.appendChild(heading);
                list.appendChild(group);
            }
            targets.forEach(target => {
                const existing = Array.from(group.querySelectorAll('.settings-label-field'))
                    .find(element => element.dataset.labelKey === target.key);
                if (existing) {
                    existing.querySelector('input').placeholder = target.fallback;
                    return;
                }
                const field = documentRef.createElement('label');
                field.className = 'settings-label-field';
                field.dataset.labelKey = target.key;
                const caption = documentRef.createElement('span');
                caption.textContent = target.kind === 'node'
                    ? `Node name (shown as ${shownLabelName(target, documentRef)})`
                    : `GPU ${target.gpu} (shown as ${shownLabelName(target, documentRef)})`;
                const input = documentRef.createElement('input');
                input.type = 'text';
                input.maxLength = MAX_LABEL_LENGTH;
                input.placeholder = target.fallback;
                const draft = pendingLabelDrafts.get(target.key);
                input.value = draft ? draft.value : (overrides.get(target.key) || '');
                if (draft) input.setSelectionRange(draft.start, draft.end);
                input.addEventListener('change', () => {
                    if (detachingLabelInputs.has(input)) return;
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
                    pendingLabelDrafts.delete(target.key);
                    Object.keys(settings).forEach(key => delete settings[key]);
                    Object.assign(settings, nextSettings);
                    if (target.kind === 'node') global.updateSidebarLabels?.();
                    applyDisplayLabels(documentRef);
                    refreshLabelControlNames(documentRef);
                    global.GPUHotNotices?.render?.();
                    const status = documentRef.getElementById('settings-status');
                    if (status) status.textContent = label ? 'Label saved.' : 'Default label restored.';
                });
                field.append(caption, input);
                group.appendChild(field);
            });
        });
        refreshLabelControlNames(documentRef);
        updateSettingsPanelOverflow(documentRef);
    }

    function pruneLabelTargets(documentRef = global.document) {
        if (!documentRef) return;
        const displayedKeys = new Set(Array.from(documentRef.querySelectorAll('[data-display-label-key]'))
            .filter(element => !element.closest('#settings-panel'))
            .map(element => element.dataset.displayLabelKey));
        const removedKeys = new Set();
        labelTargets.forEach((target, key) => {
            if (displayedKeys.has(key)) return;
            labelTargets.delete(key);
            removedKeys.add(key);
        });
        if (removedKeys.size === 0) return;
        if (labelTargets.size === 0) {
            renderLabelControls(documentRef);
            return;
        }
        documentRef.querySelectorAll('#settings-label-list .settings-label-field').forEach(field => {
            if (!removedKeys.has(field.dataset.labelKey)) return;
            const group = field.closest('.settings-label-node');
            prepareLabelFieldRemoval(field, documentRef);
            field.remove();
            if (!group.querySelector('.settings-label-field')) group.remove();
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
        const showStarPrompt = documentRef.getElementById('settings-show-star-prompt');
        const themeSelect = documentRef.getElementById('settings-theme');
        if (!openButton || !closeButton || !resetButton || !overlay || !panel || !status) return;
        const noticeInputs = Array.from(panel.querySelectorAll('[data-notice-setting]'));
        if (panel.dataset.settingsInitialized === 'true') return;
        panel.dataset.settingsInitialized = 'true';
        global.addEventListener('resize', () => scheduleOverviewBehindMasks(documentRef));
        renderLabelControls(documentRef);

        function syncSidebarControls() {
            if (widthSelect) widthSelect.value = settings.sidebarWidth || 'standard';
            if (labelSelect) labelSelect.value = settings.sidebarLabel || 'index';
            if (autoHide) autoHide.checked = settings.sidebarAutoHide === true;
        }

        function saveSidebarSetting({ key, value, control, previousValue }) {
            const nextSettings = { ...settings, [key]: value };
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
            refreshLabelControlNames(documentRef);
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
                previousValue: settings.sidebarAutoHide === true
            }));
        }
        syncSidebarControls();
        applySidebarSettings(documentRef);
        const metricInputs = Array.from(panel.querySelectorAll('[data-overview-setting]'));
        const metricFieldset = metricInputs[0]?.closest('fieldset');
        const chartOption = metricInputs.find(input => input.dataset.overviewSetting === 'chart')?.closest('label');
        const metricRows = new Map();
        if (metricFieldset && chartOption) {
            METRIC_ORDER.forEach(metric => {
                const label = metricInputs.find(input => input.dataset.overviewSetting === metric)?.closest('label');
                if (!label) return;
                const row = documentRef.createElement('div');
                row.className = 'settings-metric-row';
                row.dataset.metricOrder = metric;
                const grip = documentRef.createElement('button');
                grip.type = 'button';
                grip.className = 'settings-metric-grip';
                grip.setAttribute('aria-label', `Move ${label.textContent.trim()}`);
                grip.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
                row.append(grip, label);
                metricFieldset.insertBefore(row, chartOption);
                metricRows.set(metric, row);
            });
        }

        function orderedMetricRows() {
            return Array.from(metricFieldset?.querySelectorAll(':scope > .settings-metric-row') || []);
        }

        function applyMetricRows() {
            if (!metricFieldset || !chartOption) return;
            const rows = settings.overviewMetricOrder.map(metric => metricRows.get(metric)).filter(Boolean);
            if (rows.some((row, index) => row !== orderedMetricRows()[index])) {
                rows.forEach(row => metricFieldset.insertBefore(row, chartOption));
            }
        }

        function saveMetricRows(previousRows) {
            const order = orderedMetricRows().map(row => row.dataset.metricOrder);
            if (order.every((metric, index) => metric === settings.overviewMetricOrder[index])) return true;
            const nextSettings = { ...settings, overviewMetricOrder: order, overviewMetricsCustomized: true };
            if (!saveSettings(nextSettings)) {
                previousRows.forEach(row => metricFieldset.insertBefore(row, chartOption));
                status.textContent = 'This order could not be saved. Try again.';
                return false;
            }
            Object.assign(settings, sanitizeSettings(nextSettings));
            applyOverviewMetricVisibility(documentRef);
            status.textContent = '';
            return true;
        }

        applyMetricRows();
        let metricMove = null;
        metricFieldset?.addEventListener('pointerdown', event => {
            const grip = event.target.closest('.settings-metric-grip');
            if (!grip || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
            const row = grip.closest('.settings-metric-row');
            const phone = global.matchMedia?.('(max-width: 768px), (max-height: 480px) and (orientation: landscape)').matches;
            metricMove = {
                row, grip, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
                previousRows: orderedMetricRows(), moved: false, ready: !phone, ghost: null,
                lastY: event.clientY, timer: null, animations: []
            };
            metricFieldset.setPointerCapture?.(event.pointerId);
            if (phone && event.pointerType === 'touch') {
                metricMove.ready = false;
                const move = metricMove;
                move.timer = global.setTimeout(() => {
                    if (metricMove === move) move.ready = true;
                }, 300);
            } else metricMove.ready = true;
        });

        function finishMetricMove(cancelled) {
            if (!metricMove) return;
            const move = metricMove;
            if (move.timer !== null) global.clearTimeout(move.timer);
            if (cancelled) move.previousRows.forEach(row => metricFieldset.insertBefore(row, chartOption));
            else if (move.moved) saveMetricRows(move.previousRows);
            move.row.classList.remove('settings-metric-moving');
            move.ghost?.remove();
            move.animations.forEach(animation => animation.cancel());
            if (metricFieldset.hasPointerCapture?.(move.pointerId)) {
                metricFieldset.releasePointerCapture(move.pointerId);
            }
            metricMove = null;
        }

        metricFieldset?.addEventListener('pointermove', event => {
            if (!metricMove || event.pointerId !== metricMove.pointerId) return;
            const move = metricMove;
            const distance = Math.hypot(event.clientX - move.startX, event.clientY - move.startY);
            if (!move.ready) {
                if (distance >= 8) {
                    if (move.timer !== null) global.clearTimeout(move.timer);
                    move.timer = null;
                    const body = panel.querySelector('.settings-body');
                    if (body) body.scrollTop -= event.clientY - move.lastY;
                    move.lastY = event.clientY;
                }
                return;
            }
            if (!move.moved && distance < 8) return;
            if (!move.moved) {
                move.moved = true;
                const box = move.row.getBoundingClientRect();
                move.ghost = move.row.cloneNode(true);
                move.ghost.classList.add('settings-metric-ghost');
                move.ghost.setAttribute('aria-hidden', 'true');
                move.ghost.setAttribute('inert', '');
                Object.assign(move.ghost.style, {
                    left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`
                });
                documentRef.body.appendChild(move.ghost);
                move.row.classList.add('settings-metric-moving');
            }
            move.ghost.style.transform = `translate(${event.clientX - move.startX}px, ${event.clientY - move.startY}px)`;
            const target = documentRef.elementFromPoint(event.clientX, event.clientY)
                ?.closest('.settings-metric-row');
            if (target && target !== move.row && target.parentElement === metricFieldset) {
                const box = target.getBoundingClientRect();
                const reference = event.clientY < box.top + box.height / 2 ? target : target.nextSibling;
                if (reference !== move.row && move.row.nextSibling !== reference) {
                    move.animations.forEach(animation => animation.cancel());
                    move.animations = [];
                    const before = new Map(orderedMetricRows()
                        .map(row => [row, row.getBoundingClientRect()]));
                    metricFieldset.insertBefore(move.row, reference);
                    orderedMetricRows().forEach(row => {
                        const previous = before.get(row);
                        const current = row.getBoundingClientRect();
                        const distance = previous.top - current.top;
                        if (distance && typeof row.animate === 'function') {
                            move.animations.push(row.animate([
                                { transform: `translateY(${distance}px)` },
                                { transform: 'translateY(0)' }
                            ], { duration: 150, easing: 'ease-out' }));
                        }
                    });
                }
            }
            event.preventDefault();
        });
        metricFieldset?.addEventListener('pointerup', event => {
            if (metricMove?.pointerId === event.pointerId) finishMetricMove(false);
        });
        metricFieldset?.addEventListener('pointercancel', event => {
            if (metricMove?.pointerId === event.pointerId) finishMetricMove(true);
        });
        metricFieldset?.addEventListener('keydown', event => {
            if (event.key === 'Escape' && metricMove) {
                finishMetricMove(true);
                event.preventDefault();
                return;
            }
            if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
            const grip = event.target.closest('.settings-metric-grip');
            if (!grip) return;
            const row = grip.closest('.settings-metric-row');
            const previousRows = orderedMetricRows();
            const offset = event.key === 'ArrowUp' ? -1 : 1;
            const target = previousRows[previousRows.indexOf(row) + offset];
            if (!target) return;
            metricFieldset.insertBefore(row, offset < 0 ? target : target.nextSibling);
            if (saveMetricRows(previousRows)) {
                status.textContent = `${row.querySelector('label').textContent.trim()} moved to position ${orderedMetricRows().indexOf(row) + 1}.`;
            }
            grip.focus();
            event.preventDefault();
        });
        metricInputs.forEach(input => {
            const metric = input.dataset.overviewSetting;
            input.checked = isOverviewMetricVisible(metric);
            input.addEventListener('change', () => {
                const previousValue = isOverviewMetricVisible(metric);
                const nextSettings = { ...settings, [`overview.${metric}`]: input.checked, overviewMetricsCustomized: true };
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
            syncBehindDimValue(settings.overviewMiniChartBehindDim || 25);
            chartBehindDim.addEventListener('input', () => {
                const requested = Number(chartBehindDim.value);
                if (ALLOWED_SETTINGS.overviewMiniChartBehindDim(requested) && chartBehindDimValue) {
                    chartBehindDimValue.textContent = `${requested}%`;
                }
            });
            chartBehindDim.addEventListener('change', () => {
                const previous = settings.overviewMiniChartBehindDim || 25;
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
            if (settings.sidebarAutoHide === true) {
                openButton.blur();
            }
        }

        function openPanel() {
            if (isOpen()) return;
            refreshLabelControlNames(documentRef);
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
            applyMetricRows();
            applyOverviewMetricVisibility(documentRef);
            if (chartWidth) chartWidth.value = 'auto';
            applyOverviewMiniChartWidth('auto', documentRef);
            if (chartBehindDim) chartBehindDim.value = '25';
            if (chartBehindDimValue) chartBehindDimValue.textContent = '25%';
            if (chartBehindDimField) chartBehindDimField.hidden = true;
            applyOverviewMiniChartBehindDim(25, documentRef);
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
            pendingLabelDrafts.clear();
            const labelList = documentRef.getElementById('settings-label-list');
            labelList?.querySelectorAll('.settings-label-field').forEach(field => {
                detachingLabelInputs.add(field.querySelector('input'));
            });
            labelList?.replaceChildren();
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
        EXTRA_OVERVIEW_METRICS,
        settings,
        loadSettings,
        saveSettings,
        resetSettings,
        applyConnectionDetailsLocation,
        isOverviewMetricVisible,
        visibleOverviewMetricCount,
        applyOverviewMetricOrder,
        applyOverviewMetricVisibility,
        scheduleOverviewBehindMasks,
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
        registerNodeLabelTarget,
        pruneLabelTargets
    });

    if (global.document) {
        if (global.document.readyState === 'loading') {
            global.document.addEventListener('DOMContentLoaded', () => initSettingsPanel(), { once: true });
        } else {
            initSettingsPanel();
        }
    }
})(window);
