/** Browser-local, opt-in history for GPU and node events. */
(function initializeEventNotices(global) {
    'use strict';

    const STORAGE_KEY = 'gpu-hot.notices.v1';
    const STORAGE_VERSION = 1;
    const MAX_STORAGE_BYTES = 262144;
    const MAX_NOTICES = 100;
    const MAX_NODES = 256;
    const MAX_GPUS_PER_NODE = 512;
    const MAX_IDENTITY_LENGTH = 256;
    const MAX_DETAIL_LENGTH = 512;
    const EVENT_TYPES = Object.freeze({
        gpuThrottle: { setting: 'noticeGpuThrottle', label: 'GPU throttling' },
        gpuMissing: { setting: 'noticeGpuMissing', label: 'GPU missing' },
        nodeOffline: { setting: 'noticeNodeOffline', label: 'Node offline' },
        externalFanStopped: { setting: 'noticeExternalFanStopped', label: 'External fan stopped' }
    });
    const NORMAL_THROTTLE_STATES = new Set(['', 'none', 'n/a', 'unthrottled']);
    const NVIDIA_THROTTLE_REASONS = new Set([
        'hw slowdown',
        'sw thermal',
        'hw thermal',
        'power brake'
    ]);

    let notices = loadHistory();
    let activeByIdentity = rebuildActiveIndex(notices);
    let latestPayload = null;
    let processingPayload = false;
    let historyChanged = false;
    const lastOnlineRosters = new Map();
    const suppressedActive = new Set();

    function isObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function boundedString(value, maximum = MAX_IDENTITY_LENGTH) {
        if (typeof value !== 'string' && typeof value !== 'number') return null;
        const text = String(value);
        if (!text || text.length > maximum) return null;
        return text;
    }

    function boundedDetail(value) {
        if (typeof value !== 'string' && typeof value !== 'number') return null;
        const text = String(value);
        return text ? text.slice(0, MAX_DETAIL_LENGTH) : null;
    }

    function validTimestamp(value) {
        return typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value));
    }

    function noticeIdentity(eventType, node, gpu = '') {
        return JSON.stringify([eventType, node, gpu]);
    }

    function sanitizeNotice(candidate) {
        if (!isObject(candidate)
            || !Object.prototype.hasOwnProperty.call(EVENT_TYPES, candidate.eventType)) return null;
        const id = boundedString(candidate.id, 128);
        const node = boundedString(candidate.node);
        const gpu = candidate.gpu === null ? null : boundedString(candidate.gpu);
        const detail = boundedString(candidate.detail, MAX_DETAIL_LENGTH);
        if (!id || !node || !detail || !validTimestamp(candidate.startedAt)) return null;
        if (candidate.eventType === 'nodeOffline' && gpu !== null) return null;
        if (candidate.eventType !== 'nodeOffline' && gpu === null) return null;
        const endedAt = candidate.endedAt === null ? null : candidate.endedAt;
        if (endedAt !== null && (!validTimestamp(endedAt)
            || Date.parse(endedAt) < Date.parse(candidate.startedAt))) return null;
        if (typeof candidate.dismissed !== 'boolean') return null;
        return {
            id,
            eventType: candidate.eventType,
            node,
            gpu,
            detail,
            startedAt: new Date(candidate.startedAt).toISOString(),
            endedAt: endedAt === null ? null : new Date(endedAt).toISOString(),
            dismissed: candidate.dismissed
        };
    }

    function loadHistory() {
        try {
            const raw = global.localStorage?.getItem(STORAGE_KEY);
            if (!raw || raw.length > MAX_STORAGE_BYTES) return [];
            const document = JSON.parse(raw);
            if (!isObject(document) || document.version !== STORAGE_VERSION
                || !Array.isArray(document.notices)) return [];
            const clean = [];
            const ids = new Set();
            for (const candidate of document.notices) {
                const notice = sanitizeNotice(candidate);
                if (!notice || ids.has(notice.id)) continue;
                ids.add(notice.id);
                clean.push(notice);
            }
            const activeIdentities = new Set();
            const withoutDuplicateActiveRows = clean.slice().reverse().filter(notice => {
                if (notice.endedAt !== null) return true;
                const identity = noticeIdentity(notice.eventType, notice.node, notice.gpu || '');
                if (activeIdentities.has(identity)) return false;
                activeIdentities.add(identity);
                return true;
            }).reverse();
            return trimNotices(withoutDuplicateActiveRows);
        } catch (error) {
            return [];
        }
    }

    function saveHistory() {
        try {
            global.localStorage?.setItem(STORAGE_KEY, JSON.stringify({
                version: STORAGE_VERSION,
                notices
            }));
            return true;
        } catch (error) {
            return false;
        }
    }

    function rebuildActiveIndex(history) {
        const index = new Map();
        history.forEach(notice => {
            if (notice.endedAt === null) {
                index.set(noticeIdentity(notice.eventType, notice.node, notice.gpu || ''), notice.id);
            }
        });
        return index;
    }

    function trimNotices(history) {
        const trimmed = history.slice();
        while (trimmed.length > MAX_NOTICES) {
            const endedIndex = trimmed.findIndex(notice => notice.endedAt !== null);
            trimmed.splice(endedIndex >= 0 ? endedIndex : 0, 1);
        }
        return trimmed;
    }

    function makeNoticeId() {
        if (global.crypto?.randomUUID) return global.crypto.randomUUID();
        return `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
    }

    function optionEnabled(eventType) {
        const key = EVENT_TYPES[eventType].setting;
        return global.GPUHotSettings?.settings?.[key] === true;
    }

    function updateCondition(eventType, node, gpu, active, detail) {
        const identity = noticeIdentity(eventType, node, gpu || '');
        const activeId = activeByIdentity.get(identity);
        const current = activeId ? notices.find(notice => notice.id === activeId) : null;
        let changed = false;

        if (active) {
            if (current) {
                const cleanDetail = boundedDetail(detail);
                if (cleanDetail && current.detail !== cleanDetail) {
                    current.detail = cleanDetail;
                    changed = true;
                }
            } else if (optionEnabled(eventType) && !suppressedActive.has(identity)) {
                const cleanDetail = boundedDetail(detail);
                if (!cleanDetail) return;
                if (notices.length >= MAX_NOTICES
                    && notices.every(notice => notice.endedAt === null)) {
                    suppressedActive.add(identity);
                    return;
                }
                const notice = {
                    id: makeNoticeId(),
                    eventType,
                    node,
                    gpu: gpu || null,
                    detail: cleanDetail,
                    startedAt: new Date().toISOString(),
                    endedAt: null,
                    dismissed: false
                };
                notices.push(notice);
                activeByIdentity.set(identity, notice.id);
                notices = trimNotices(notices);
                activeByIdentity = rebuildActiveIndex(notices);
                changed = true;
            }
        } else {
            suppressedActive.delete(identity);
            if (current) {
                current.endedAt = new Date().toISOString();
                activeByIdentity.delete(identity);
                changed = true;
            }
        }

        if (changed) {
            if (processingPayload) {
                historyChanged = true;
            } else {
                saveHistory();
                render();
            }
        }
    }

    function throttleDetail(gpuInfo) {
        const raw = gpuInfo?.throttle_reasons;
        const values = Array.isArray(raw) ? raw : [raw];
        const parts = values.flatMap(value => typeof value === 'string' ? value.split(',') : [])
            .map(value => value.trim())
            .filter(Boolean);
        if (parts.length === 0) return null;
        const vendor = String(gpuInfo?.vendor || '').toLowerCase();
        if (vendor === 'amd') {
            const alarming = parts.filter(value => !NORMAL_THROTTLE_STATES.has(value.toLowerCase()));
            return alarming.length > 0 ? alarming.join(', ') : null;
        }
        if (vendor !== 'nvidia') return null;
        const alarming = parts.filter(value => NVIDIA_THROTTLE_REASONS.has(value.toLowerCase()));
        return alarming.length > 0 ? alarming.join(', ') : null;
    }

    function fanStoppedDetail(gpuInfo) {
        if (gpuInfo?.fan_source !== 'external') return null;
        const speedStopped = typeof gpuInfo.fan_speed === 'number' && gpuInfo.fan_speed === 0;
        const rpmStopped = typeof gpuInfo.fan_rpm === 'number' && gpuInfo.fan_rpm === 0;
        if (!speedStopped && !rpmStopped) return null;
        if (speedStopped && rpmStopped) return 'The external fan reports 0% and 0 RPM.';
        return speedStopped ? 'The external fan reports 0%.' : 'The external fan reports 0 RPM.';
    }

    function observeOnlineNode(node, gpuMap) {
        const currentRoster = new Set(Object.keys(gpuMap));
        const previousRoster = lastOnlineRosters.get(node);
        updateCondition('nodeOffline', node, null, false, 'The node is offline.');

        Object.entries(gpuMap).forEach(([gpuId, gpuInfo]) => {
            if (!isObject(gpuInfo)) return;
            updateCondition('gpuMissing', node, gpuId, false, 'The GPU is missing from the latest report.');
            const throttle = throttleDetail(gpuInfo);
            updateCondition('gpuThrottle', node, gpuId, throttle !== null,
                throttle ? `Reported throttle state: ${throttle}.` : 'GPU throttling ended.');
            const fan = fanStoppedDetail(gpuInfo);
            updateCondition('externalFanStopped', node, gpuId, fan !== null,
                fan || 'The external fan is reporting again.');
        });

        if (previousRoster) {
            previousRoster.forEach(gpuId => {
                if (!currentRoster.has(gpuId)) {
                    updateCondition('gpuMissing', node, gpuId, true,
                        'The GPU is missing from the latest report.');
                }
            });
        }
        lastOnlineRosters.set(node, currentRoster);
    }

    function isCompleteGpuMap(gpuMap) {
        if (!isObject(gpuMap)) return false;
        const entries = Object.entries(gpuMap);
        return entries.length <= MAX_GPUS_PER_NODE && entries.every(([gpuId, gpuInfo]) =>
            boundedString(gpuId) !== null && isObject(gpuInfo)
        );
    }

    function anyNoticeOptionEnabled() {
        return Object.keys(EVENT_TYPES).some(optionEnabled);
    }

    function snapshotOnlineRosters(data) {
        if (data.mode === 'hub') {
            if (!isObject(data.nodes)) return;
            const nodeEntries = Object.entries(data.nodes);
            if (nodeEntries.length > MAX_NODES) return;
            nodeEntries.forEach(([rawNode, nodeData]) => {
                const node = boundedString(rawNode);
                if (node && isObject(nodeData) && nodeData.status === 'online'
                    && isCompleteGpuMap(nodeData.gpus)) {
                    lastOnlineRosters.set(node, new Set(Object.keys(nodeData.gpus)));
                }
            });
            return;
        }
        if (!isCompleteGpuMap(data.gpus)) return;
        const node = boundedString(data.node_name || global.DEFAULT_NODE_NAME || 'GPU Server');
        if (node) lastOnlineRosters.set(node, new Set(Object.keys(data.gpus)));
    }

    function observePayload(data) {
        if (!isObject(data)) return;
        if (!anyNoticeOptionEnabled() && activeByIdentity.size === 0
            && suppressedActive.size === 0) {
            snapshotOnlineRosters(data);
            return;
        }
        if (data.mode === 'hub') {
            if (!isObject(data.nodes)) return;
            const nodeEntries = Object.entries(data.nodes);
            if (nodeEntries.length > MAX_NODES) return;
            nodeEntries.forEach(([rawNode, nodeData]) => {
                const node = boundedString(rawNode);
                if (!node || !isObject(nodeData)) return;
                if (nodeData.status === 'offline') {
                    updateCondition('nodeOffline', node, null, true, 'The node is offline.');
                } else if (nodeData.status === 'online' && isCompleteGpuMap(nodeData.gpus)) {
                    observeOnlineNode(node, nodeData.gpus);
                }
            });
            return;
        }
        if (!isCompleteGpuMap(data.gpus)) return;
        const node = boundedString(data.node_name || global.DEFAULT_NODE_NAME || 'GPU Server');
        if (node) observeOnlineNode(node, data.gpus);
    }

    function processPayload(data) {
        if (!isObject(data)) return;
        latestPayload = data;
        processingPayload = true;
        historyChanged = false;
        try {
            observePayload(data);
        } catch (error) {
            // Notices must never interrupt the dashboard's live update path.
        } finally {
            processingPayload = false;
            if (historyChanged) {
                historyChanged = false;
                try {
                    saveHistory();
                    render();
                } catch (error) {
                    // Rendering or storage failures cannot stop live updates.
                }
            }
        }
    }

    function settingsChanged() {
        if (latestPayload) processPayload(latestPayload);
        render();
    }

    function displayNode(node) {
        return global.GPUHotSettings?.nodeDisplayLabel?.(node, node) || node;
    }

    function displayGpu(node, gpu) {
        return global.GPUHotSettings?.gpuDisplayLabel?.(node, gpu, `GPU ${gpu}`) || `GPU ${gpu}`;
    }

    function formatTime(timestamp) {
        try {
            return new Date(timestamp).toLocaleString();
        } catch (error) {
            return timestamp;
        }
    }

    function render(documentRef = global.document) {
        const region = documentRef?.getElementById('event-notices');
        const list = documentRef?.getElementById('event-notices-list');
        if (!region || !list) return;
        const visible = notices.filter(notice => !notice.dismissed).slice().reverse();
        const focused = documentRef.activeElement?.closest?.('[data-notice-id]');
        const focusedId = focused?.dataset.noticeId;
        const focusedAction = documentRef.activeElement?.dataset.action;
        list.replaceChildren();
        visible.forEach(notice => {
            const card = documentRef.createElement('article');
            card.className = 'event-notice';
            card.dataset.noticeId = notice.id;
            const title = documentRef.createElement('h3');
            title.textContent = EVENT_TYPES[notice.eventType].label;
            const scope = documentRef.createElement('div');
            scope.className = 'event-notice-scope';
            const node = documentRef.createElement('span');
            node.textContent = displayNode(notice.node);
            const gpu = documentRef.createElement('span');
            gpu.textContent = notice.gpu === null ? 'All GPUs' : displayGpu(notice.node, notice.gpu);
            scope.append(node, gpu);
            const detail = documentRef.createElement('p');
            detail.className = 'event-notice-detail';
            detail.textContent = notice.detail;
            const times = documentRef.createElement('div');
            times.className = 'event-notice-times';
            const started = documentRef.createElement('span');
            started.textContent = `Started ${formatTime(notice.startedAt)}`;
            const ended = documentRef.createElement('span');
            ended.textContent = notice.endedAt ? `Ended ${formatTime(notice.endedAt)}` : 'Active';
            const dismiss = documentRef.createElement('button');
            dismiss.className = 'event-notice-dismiss';
            dismiss.type = 'button';
            dismiss.dataset.action = 'dismiss';
            dismiss.textContent = 'Dismiss';
            dismiss.addEventListener('click', () => dismissNotice(notice.id));
            times.append(started, ended, dismiss);
            card.append(title, scope, detail, times);
            list.appendChild(card);
        });
        region.hidden = visible.length === 0;
        if (focusedId) {
            const replacement = Array.from(list.querySelectorAll('[data-notice-id]'))
                .find(element => element.dataset.noticeId === focusedId)
                ?.querySelector(`[data-action="${focusedAction}"]`);
            replacement?.focus();
        }
    }

    function dismissNotice(id) {
        const notice = notices.find(candidate => candidate.id === id);
        if (!notice || notice.dismissed) return;
        notice.dismissed = true;
        saveHistory();
        render();
    }

    function clearAll() {
        activeByIdentity.forEach((_id, identity) => suppressedActive.add(identity));
        notices = [];
        activeByIdentity = new Map();
        try { global.localStorage?.removeItem(STORAGE_KEY); } catch (error) { }
        render();
    }

    function init(documentRef = global.document) {
        const clear = documentRef?.getElementById('event-notices-clear');
        if (clear && clear.dataset.noticesInitialized !== 'true') {
            clear.dataset.noticesInitialized = 'true';
            clear.addEventListener('click', clearAll);
        }
        render(documentRef);
    }

    global.GPUHotNotices = Object.freeze({
        STORAGE_KEY,
        EVENT_TYPES,
        processPayload,
        settingsChanged,
        dismissNotice,
        clearAll,
        loadHistory,
        render,
        init,
        get notices() { return notices.map(notice => ({ ...notice })); }
    });

    if (global.document?.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', () => init(), { once: true });
    } else {
        init();
    }
})(window);
