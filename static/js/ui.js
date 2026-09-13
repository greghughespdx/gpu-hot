/**
 * UI Interactions and navigation — GPU Studio
 * Sidebar-based navigation
 */

// Global state
let currentTab = 'overview';
let registeredGPUs = new Set();
let hasAutoSwitched = false;
const SIDEBAR_MOVE_THRESHOLD = 8;
const PHONE_SIDEBAR_LONG_PRESS_MS = 300;
const defaultSidebarOrder = [];
let defaultSidebarNav = null;
let activeSidebarMove = null;
let suppressedSidebarClickKey = null;
let activeDashboardMove = null;
let suppressedDashboardClickKey = null;
const DEFAULT_NODE_NAME = 'GPU Server';

function sidebarOrderKey(nodeName, gpuId) {
    return JSON.stringify([String(nodeName), String(gpuId)]);
}

function savedSidebarOrder() {
    const order = window.GPUHotSettings?.settings?.sidebarOrder;
    return Array.isArray(order) ? order : [];
}

function saveSidebarOrder(order) {
    const api = window.GPUHotSettings;
    if (!api || !api.saveSettings({ ...api.settings, sidebarOrder: order })) return false;
    api.settings.sidebarOrder = [...order];
    return true;
}

function sidebarButtons(nav) {
    return Array.from(nav.querySelectorAll('.sidebar-btn[data-sidebar-order-key]'));
}

function applySidebarOrder(documentRef = document) {
    const nav = documentRef.getElementById('view-selector');
    if (!nav || activeSidebarMove) return;
    const buttonsByKey = new Map(sidebarButtons(nav).map(button => [button.dataset.sidebarOrderKey, button]));
    const saved = savedSidebarOrder();
    const order = saved.length > 0 ? saved : defaultSidebarOrder;
    order.forEach(key => {
        const button = buttonsByKey.get(key);
        if (button) nav.appendChild(button);
    });
}

function registerSidebarOrder(button, nodeName, gpuId) {
    if (defaultSidebarNav !== button.parentElement) {
        defaultSidebarOrder.length = 0;
        defaultSidebarNav = button.parentElement;
    }
    const key = sidebarOrderKey(nodeName, gpuId);
    button.dataset.sidebarOrderKey = key;
    button.dataset.orderNode = String(nodeName);
    button.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight');
    if (!defaultSidebarOrder.includes(key)) defaultSidebarOrder.push(key);
    const saved = savedSidebarOrder();
    if (saved.length > 0 && !saved.includes(key)) saveSidebarOrder([...saved, key]);
    applySidebarOrder(button.ownerDocument);
}

function mergedSidebarOrder(visibleOrder) {
    const visibleKeys = new Set(visibleOrder);
    const merged = [];
    let visibleIndex = 0;
    savedSidebarOrder().forEach(key => {
        merged.push(visibleKeys.has(key) ? visibleOrder[visibleIndex++] : key);
    });
    return merged.concat(visibleOrder.slice(visibleIndex));
}

function persistVisibleSidebarOrder(nav) {
    const visibleOrder = sidebarButtons(nav).map(button => button.dataset.sidebarOrderKey);
    return saveSidebarOrder(mergedSidebarOrder(visibleOrder));
}

function restoreVisibleSidebarOrder(nav, order) {
    const buttonsByKey = new Map(sidebarButtons(nav).map(button => [button.dataset.sidebarOrderKey, button]));
    order.forEach(key => {
        const button = buttonsByKey.get(key);
        if (button) nav.appendChild(button);
    });
}

function moveSidebarButton(button, target, pointerEvent, nav) {
    if (!target || target === button) return;
    if (target.dataset.orderNode !== button.dataset.orderNode) return;
    const targetBox = target.getBoundingClientRect();
    const horizontal = getComputedStyle(nav).flexDirection === 'row';
    const coordinate = horizontal ? pointerEvent.clientX : pointerEvent.clientY;
    const midpoint = horizontal
        ? targetBox.left + targetBox.width / 2
        : targetBox.top + targetBox.height / 2;
    nav.insertBefore(button, coordinate < midpoint ? target : target.nextSibling);
}

function finishSidebarMove(nav, cancelled) {
    if (!activeSidebarMove) return;
    const { button, initialOrder, moved } = activeSidebarMove;
    if (activeSidebarMove.longPressTimer !== null) {
        clearTimeout(activeSidebarMove.longPressTimer);
    }
    if (cancelled) restoreVisibleSidebarOrder(nav, initialOrder);
    else if (moved) {
        const finalOrder = sidebarButtons(nav).map(entry => entry.dataset.sidebarOrderKey);
        const orderChanged = JSON.stringify(finalOrder) !== JSON.stringify(initialOrder);
        if (orderChanged && !persistVisibleSidebarOrder(nav)) {
            restoreVisibleSidebarOrder(nav, initialOrder);
        } else if (orderChanged) {
            applyDashboardOrder(nav.ownerDocument);
        }
    }
    if (moved && !cancelled) {
        suppressedSidebarClickKey = button.dataset.sidebarOrderKey;
        setTimeout(() => { suppressedSidebarClickKey = null; }, 0);
    }
    button.classList.remove('sidebar-ordering');
    activeSidebarMove = null;
    applySidebarOrder(nav.ownerDocument);
}

function beginSidebarMove(event, nav) {
    if (event.isPrimary === false) return;
    const button = event.target.closest('.sidebar-btn[data-sidebar-order-key]');
    if (!button || (event.button !== undefined && event.button !== 0)) return;
    const waitsForLongPress = event.pointerType === 'touch'
        && window.matchMedia?.(
            '(max-width: 768px), (max-height: 480px) and (orientation: landscape)'
        ).matches;
    const move = {
        button,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        ready: !waitsForLongPress,
        longPressTimer: null,
        initialOrder: sidebarButtons(nav).map(entry => entry.dataset.sidebarOrderKey)
    };
    activeSidebarMove = move;
    if (waitsForLongPress) {
        move.longPressTimer = setTimeout(() => {
            if (activeSidebarMove !== move) return;
            move.ready = true;
            move.longPressTimer = null;
            if (typeof button.setPointerCapture === 'function') button.setPointerCapture(event.pointerId);
        }, PHONE_SIDEBAR_LONG_PRESS_MS);
    } else if (typeof button.setPointerCapture === 'function') {
        button.setPointerCapture(event.pointerId);
    }
}

function continueSidebarMove(event, nav, documentRef) {
    if (!activeSidebarMove || event.pointerId !== activeSidebarMove.pointerId) return;
    const distance = Math.hypot(
        event.clientX - activeSidebarMove.startX,
        event.clientY - activeSidebarMove.startY
    );
    if (!activeSidebarMove.ready) {
        if (distance >= SIDEBAR_MOVE_THRESHOLD) {
            if (activeSidebarMove.longPressTimer !== null) {
                clearTimeout(activeSidebarMove.longPressTimer);
            }
            activeSidebarMove = null;
        }
        return;
    }
    if (!activeSidebarMove.moved && distance < SIDEBAR_MOVE_THRESHOLD) return;
    activeSidebarMove.moved = true;
    activeSidebarMove.button.classList.add('sidebar-ordering');
    const target = documentRef.elementFromPoint(event.clientX, event.clientY)
        ?.closest('.sidebar-btn[data-sidebar-order-key]');
    moveSidebarButton(activeSidebarMove.button, target, event, nav);
    event.preventDefault();
}

function suppressSidebarClick(event) {
    const button = event.target.closest('.sidebar-btn[data-sidebar-order-key]');
    if (!button || button.dataset.sidebarOrderKey !== suppressedSidebarClickKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressedSidebarClickKey = null;
}

function moveSidebarButtonByKey(event, nav) {
    if (!event.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const button = event.target.closest('.sidebar-btn[data-sidebar-order-key]');
    if (!button) return;
    const buttons = sidebarButtons(nav);
    const offset = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
    const target = buttons[buttons.indexOf(button) + offset];
    if (!target || target.dataset.orderNode !== button.dataset.orderNode) return;
    const initialOrder = buttons.map(entry => entry.dataset.sidebarOrderKey);
    nav.insertBefore(button, offset < 0 ? target : target.nextSibling);
    if (!persistVisibleSidebarOrder(nav)) restoreVisibleSidebarOrder(nav, initialOrder);
    else applyDashboardOrder(nav.ownerDocument);
    button.focus();
    event.preventDefault();
}

function dashboardGroups(documentRef = document) {
    const container = documentRef.getElementById('overview-container');
    return container
        ? Array.from(container.children).filter(element => element.dataset.layoutKind === 'node')
        : [];
}

function dashboardCards(group) {
    const grid = group?.querySelector(':scope > .node-grid');
    return grid
        ? Array.from(grid.children).filter(element => element.dataset.layoutKind === 'gpu')
        : [];
}

function visibleDashboardOrder(documentRef = document) {
    return dashboardGroups(documentRef)
        .flatMap(group => dashboardCards(group).map(card => card.dataset.layoutOrderKey));
}

function applyDashboardOrder(documentRef = document) {
    // Moving a captured element in the DOM releases pointer capture in browsers.
    // Live payloads may register an offline placeholder on every update.
    if (activeDashboardMove) return;
    const groups = dashboardGroups(documentRef);
    if (groups.length === 0) return;
    const saved = savedSidebarOrder();
    const order = saved.length > 0 ? saved : defaultSidebarOrder;
    const nodePosition = new Map();
    order.forEach((key, index) => {
        try {
            const [nodeName] = JSON.parse(key);
            if (!nodePosition.has(nodeName)) nodePosition.set(nodeName, index);
        } catch (error) { }
    });
    const container = groups[0].parentElement;
    groups
        .map((group, index) => ({ group, index }))
        .sort((left, right) => {
            const leftPosition = nodePosition.get(left.group.dataset.orderNode) ?? Number.MAX_SAFE_INTEGER;
            const rightPosition = nodePosition.get(right.group.dataset.orderNode) ?? Number.MAX_SAFE_INTEGER;
            return leftPosition - rightPosition || left.index - right.index;
        })
        .forEach(({ group }) => container.appendChild(group));

    dashboardGroups(documentRef).forEach(group => {
        const grid = group.querySelector(':scope > .node-grid');
        const cardsByKey = new Map(dashboardCards(group)
            .map(card => [card.dataset.layoutOrderKey, card]));
        order.forEach(key => {
            const card = cardsByKey.get(key);
            if (card) grid.appendChild(card);
        });
    });
}

function addDashboardOrderGrip(item, label, kind) {
    if (!label) return;
    const host = kind === 'node' ? item : label;
    if (host.querySelector(':scope > .dashboard-order-grip')) return;
    const grip = item.ownerDocument.createElement('span');
    grip.className = 'dashboard-order-grip';
    grip.dataset.dashboardOrderGrip = kind;
    grip.title = kind === 'node' ? 'Move this node' : 'Move this GPU';
    grip.setAttribute('aria-hidden', 'true');
    if (kind === 'node') label.after(grip);
    else label.prepend(grip);
}

function registerDashboardNode(group, nodeName) {
    if (!group) return;
    group.dataset.layoutKind = 'node';
    group.dataset.orderNode = String(nodeName);
    group.tabIndex = 0;
    group.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight');
    addDashboardOrderGrip(group, group.querySelector(':scope > .node-label'), 'node');
    applyDashboardOrder(group.ownerDocument);
}

function registerDashboardGpu(card, nodeName, gpuId) {
    if (!card) return;
    const key = sidebarOrderKey(nodeName, gpuId);
    card.dataset.layoutKind = 'gpu';
    card.dataset.layoutOrderKey = key;
    card.dataset.orderNode = String(nodeName);
    card.tabIndex = 0;
    card.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight');
    addDashboardOrderGrip(card, card.querySelector(':scope > .overview-gpu-name'), 'gpu');
    if (!defaultSidebarOrder.includes(key)) defaultSidebarOrder.push(key);
    const saved = savedSidebarOrder();
    if (saved.length > 0 && !saved.includes(key)) saveSidebarOrder([...saved, key]);
    applyDashboardOrder(card.ownerDocument);
    applySidebarOrder(card.ownerDocument);
}

function restoreDashboardOrder(container, elements) {
    elements.forEach(element => container.appendChild(element));
}

function persistDashboardOrder(documentRef) {
    const visible = visibleDashboardOrder(documentRef);
    const saved = saveSidebarOrder(mergedSidebarOrder(visible));
    if (saved) applySidebarOrder(documentRef);
    return saved;
}

function beginDashboardMove(event) {
    if (event.isPrimary === false) return;
    const grabTarget = event.target.closest('.dashboard-order-grip');
    const item = grabTarget?.closest('[data-layout-kind]');
    if (!item || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault();
    const kind = item.dataset.layoutKind;
    const container = item.parentElement;
    const elements = kind === 'node' ? dashboardGroups(item.ownerDocument) : dashboardCards(item.closest('.node-group'));
    activeDashboardMove = {
        item,
        kind,
        container,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        initialElements: elements,
        ghost: null,
        moveAnimations: new Map()
    };
    if (typeof grabTarget.setPointerCapture === 'function') grabTarget.setPointerCapture(event.pointerId);
    item.ownerDocument.addEventListener('keydown', cancelDashboardMoveOnEscape, true);
}

function showDashboardMoveGhost(move, documentRef) {
    const box = move.item.getBoundingClientRect();
    const ghost = move.item.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.removeAttribute('data-layout-kind');
    ghost.querySelectorAll('[id]').forEach(element => element.removeAttribute('id'));
    ghost.classList.remove('dashboard-ordering');
    ghost.classList.add('dashboard-order-ghost');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    ghost.style.left = `${box.left}px`;
    ghost.style.top = `${box.top}px`;
    ghost.style.width = `${box.width}px`;
    ghost.style.height = `${box.height}px`;
    documentRef.body.appendChild(ghost);
    move.ghost = ghost;
    move.container.closest('#overview-container')?.setPointerCapture?.(move.pointerId);
}

function animateDashboardGap(move, oldPositions) {
    Array.from(move.container.children).forEach(element => {
        if (element === move.item || !oldPositions.has(element)) return;
        const before = oldPositions.get(element);
        const after = element.getBoundingClientRect();
        const x = before.left - after.left;
        const y = before.top - after.top;
        if ((!x && !y) || typeof element.animate !== 'function') return;
        move.moveAnimations.set(element, element.animate([
            { transform: `translate(${x}px, ${y}px)` },
            { transform: 'translate(0, 0)' }
        ], { duration: 150, easing: 'ease-out' }));
    });
}

function continueDashboardMove(event, documentRef) {
    if (!activeDashboardMove || event.pointerId !== activeDashboardMove.pointerId) return;
    const distance = Math.hypot(
        event.clientX - activeDashboardMove.startX,
        event.clientY - activeDashboardMove.startY
    );
    if (!activeDashboardMove.moved && distance < SIDEBAR_MOVE_THRESHOLD) return;
    if (!activeDashboardMove.moved) {
        showDashboardMoveGhost(activeDashboardMove, documentRef);
        activeDashboardMove.item.classList.add('dashboard-ordering');
    }
    activeDashboardMove.moved = true;
    activeDashboardMove.container.closest('#overview-container')
        ?.classList.add('dashboard-ordering-active');
    activeDashboardMove.ghost.style.transform = `translate(${event.clientX - activeDashboardMove.startX}px, ${event.clientY - activeDashboardMove.startY}px)`;
    const target = documentRef.elementFromPoint(event.clientX, event.clientY)
        ?.closest(`[data-layout-kind="${activeDashboardMove.kind}"]`);
    if (!target || target === activeDashboardMove.item || target.parentElement !== activeDashboardMove.container) {
        event.preventDefault();
        return;
    }
    const box = target.getBoundingClientRect();
    const after = Math.abs(event.clientX - activeDashboardMove.startX)
        > Math.abs(event.clientY - activeDashboardMove.startY)
        ? event.clientX >= box.left + box.width / 2
        : event.clientY >= box.top + box.height / 2;
    const reference = after ? target.nextSibling : target;
    if (reference === activeDashboardMove.item || activeDashboardMove.item.nextSibling === reference) {
        event.preventDefault();
        return;
    }
    activeDashboardMove.moveAnimations.forEach(animation => animation.cancel());
    activeDashboardMove.moveAnimations.clear();
    const oldPositions = new Map(Array.from(activeDashboardMove.container.children)
        .map(element => [element, element.getBoundingClientRect()]));
    activeDashboardMove.container.insertBefore(
        activeDashboardMove.item,
        reference
    );
    animateDashboardGap(activeDashboardMove, oldPositions);
    event.preventDefault();
}

function finishDashboardMove(documentRef, cancelled) {
    if (!activeDashboardMove) return;
    documentRef.removeEventListener('keydown', cancelDashboardMoveOnEscape, true);
    const { item, container, initialElements, moved, ghost, moveAnimations } = activeDashboardMove;
    const currentElements = Array.from(container.children)
        .filter(element => element.dataset.layoutKind === activeDashboardMove.kind);
    const unchanged = currentElements.length === initialElements.length
        && currentElements.every((element, index) => element === initialElements[index]);
    if (cancelled || (moved && !unchanged && !persistDashboardOrder(documentRef))) {
        restoreDashboardOrder(container, initialElements);
    }
    if (moved && !cancelled) {
        suppressedDashboardClickKey = item.dataset.layoutOrderKey || `node:${item.dataset.orderNode}`;
        setTimeout(() => { suppressedDashboardClickKey = null; }, 0);
    }
    item.classList.remove('dashboard-ordering');
    ghost?.remove();
    moveAnimations.forEach(animation => animation.cancel());
    container.closest('#overview-container')?.classList.remove('dashboard-ordering-active');
    activeDashboardMove = null;
    applyDashboardOrder(documentRef);
}

function cancelDashboardMoveOnEscape(event) {
    if (event.key !== 'Escape') return;
    finishDashboardMove(event.currentTarget, true);
    event.preventDefault();
    event.stopImmediatePropagation();
}

function moveDashboardItemByKey(event, documentRef) {
    if (!event.altKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const item = event.target.closest('[data-layout-kind]');
    if (!item) return;
    const container = item.parentElement;
    const elements = Array.from(container.children)
        .filter(element => element.dataset.layoutKind === item.dataset.layoutKind);
    const offset = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
    const target = elements[elements.indexOf(item) + offset];
    if (!target) return;
    const initialElements = [...elements];
    container.insertBefore(item, offset < 0 ? target : target.nextSibling);
    if (!persistDashboardOrder(documentRef)) restoreDashboardOrder(container, initialElements);
    item.focus();
    event.preventDefault();
}

function initializeDashboardOrdering(documentRef = document) {
    const container = documentRef.getElementById('overview-container');
    if (!container || container.dataset.dashboardOrderingInitialized === 'true') return;
    container.dataset.dashboardOrderingInitialized = 'true';
    container.addEventListener('pointerdown', beginDashboardMove);
    container.addEventListener('pointermove', event => continueDashboardMove(event, documentRef));
    container.addEventListener('pointerup', event => {
        if (activeDashboardMove?.pointerId === event.pointerId) finishDashboardMove(documentRef, false);
    });
    container.addEventListener('pointercancel', event => {
        if (activeDashboardMove?.pointerId === event.pointerId) finishDashboardMove(documentRef, true);
    });
    container.addEventListener('click', event => {
        if (event.target.closest('.dashboard-order-grip')) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        const item = event.target.closest('[data-layout-kind]');
        const key = item?.dataset.layoutOrderKey || (item ? `node:${item.dataset.orderNode}` : null);
        if (!key || key !== suppressedDashboardClickKey) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressedDashboardClickKey = null;
    }, true);
    container.addEventListener('keydown', event => moveDashboardItemByKey(event, documentRef));
}

function initializeSidebarOrdering(documentRef = document) {
    const nav = documentRef.getElementById('view-selector');
    if (!nav || nav.dataset.sidebarOrderingInitialized === 'true') return;
    nav.dataset.sidebarOrderingInitialized = 'true';
    nav.addEventListener('pointerdown', event => beginSidebarMove(event, nav));
    nav.addEventListener('pointermove', event => continueSidebarMove(event, nav, documentRef));
    nav.addEventListener('pointerup', event => {
        if (activeSidebarMove?.pointerId === event.pointerId) finishSidebarMove(nav, false);
    });
    nav.addEventListener('pointercancel', event => {
        if (activeSidebarMove?.pointerId === event.pointerId) finishSidebarMove(nav, true);
    });
    nav.addEventListener('touchmove', event => {
        if (activeSidebarMove?.ready) event.preventDefault();
    }, { passive: false });
    nav.addEventListener('click', suppressSidebarClick, true);
    nav.addEventListener('keydown', event => moveSidebarButtonByKey(event, nav));
}

function sidebarLabel(gpuId, gpuInfo) {
    const parts = String(gpuId).split('-');
    const index = parts.pop();
    const scheme = window.GPUHotSettings?.settings?.sidebarLabel || 'index';
    if (scheme === 'node-index' && parts.length > 0) {
        return `${parts.join('-')} ${index}`;
    }
    if (scheme === 'short-name') {
        const shortName = String(gpuInfo?.name || '')
            .replace(/\b(?:NVIDIA|AMD|GeForce|Radeon|Graphics|GPU|Pro)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (shortName) return shortName;
    }
    return index;
}

function applySidebarButtonLabel(button, gpuId, gpuInfo, nodeName, sourceGpuId) {
    const fallback = sidebarLabel(gpuId, gpuInfo);
    const titleFallback = fallback === String(sourceGpuId)
        ? `GPU ${gpuId}`
        : `${fallback} (GPU ${gpuId})`;
    let label = button.querySelector(':scope > .sidebar-btn-label');
    if (!label) {
        label = button.ownerDocument.createElement('span');
        label.className = 'sidebar-btn-label';
        button.replaceChildren(label);
    }
    label.textContent = fallback;
    button.title = titleFallback;
    window.GPUHotSettings?.registerGpuLabelTarget?.(nodeName, sourceGpuId);
    window.GPUHotSettings?.bindGpuLabel?.(
        label,
        nodeName,
        sourceGpuId,
        fallback
    );
    window.GPUHotSettings?.bindGpuLabel?.(
        button, nodeName, sourceGpuId, titleFallback, 'title'
    );
}

function updateSidebarLabels() {
    document.querySelectorAll('.sidebar-btn[data-gpu-id]').forEach(button => {
        applySidebarButtonLabel(
            button,
            button.dataset.gpuId,
            { name: button.dataset.gpuName },
            button.dataset.gpuNode,
            button.dataset.sourceGpuId
        );
    });
}

function keepSidebarButtonVisible(button) {
    const phoneLayout = window.matchMedia(
        '(max-width: 768px), (max-height: 480px) and (orientation: landscape)'
    ).matches;
    if (!phoneLayout || !button || typeof button.scrollIntoView !== 'function') return;
    button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// Toggle processes section
function toggleProcesses() {
    const content = document.getElementById('processes-content');
    const header = document.querySelector('.processes-header');
    const icon = document.querySelector('.toggle-icon');

    content.classList.toggle('expanded');
    if (header) header.classList.toggle('expanded');
    if (icon) icon.classList.toggle('expanded');
}

// Tab switching
function switchToView(viewName) {
    if (!viewName) return;

    currentTab = viewName;

    // Update sidebar button states
    let activeButton = null;
    document.querySelectorAll('.sidebar-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.view === viewName) {
            btn.classList.add('active');
            activeButton = btn;
        }
    });
    keepSidebarButtonVisible(activeButton);

    // Switch tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    const targetContent = document.getElementById(`tab-${viewName}`);
    if (!targetContent) return;

    targetContent.classList.add('active');

    if (typeof renderProcessesForView === 'function') {
        renderProcessesForView(viewName);
    }

    // Chart resize for visible tab
    if (viewName.startsWith('gpu-')) {
        const gpuId = viewName.replace('gpu-', '');

        if (charts && charts[gpuId]) {
            Object.values(charts[gpuId]).forEach(chart => {
                if (!chart || !chart.options) return;
                try {
                    const orig = chart.options.animation;
                    chart.options.animation = false;
                    if (typeof chart.resize === 'function') chart.resize();
                    if (typeof chart.update === 'function') chart.update('none');
                    chart.options.animation = orig;
                } catch (error) {
                    console.error(`Chart resize error GPU ${gpuId}:`, error);
                }
            });
        }
    }
}

// Create or update GPU tab
function ensureGPUTab(gpuId, gpuInfo, options = {}) {
    const normalizedOptions = typeof options === 'boolean'
        ? { shouldUpdateDOM: options }
        : options;
    const {
        shouldUpdateDOM = true,
        nodeName = DEFAULT_NODE_NAME,
        sourceGpuId = gpuId
    } = normalizedOptions;
    if (!registeredGPUs.has(gpuId)) {
        // Add sidebar button
        const viewSelector = document.getElementById('view-selector');
        const btn = document.createElement('button');
        btn.className = 'sidebar-btn';
        btn.dataset.view = `gpu-${gpuId}`;
        btn.dataset.gpuId = String(gpuId);
        btn.dataset.gpuName = String(gpuInfo?.name || '');
        btn.dataset.gpuNode = String(nodeName);
        btn.dataset.sourceGpuId = String(sourceGpuId);
        applySidebarButtonLabel(btn, gpuId, gpuInfo, nodeName, sourceGpuId);
        btn.onclick = () => switchToView(`gpu-${gpuId}`);
        viewSelector.appendChild(btn);
        registerSidebarOrder(btn, nodeName, sourceGpuId);

        // Create tab content
        const tabContent = document.createElement('div');
        tabContent.id = `tab-gpu-${gpuId}`;
        tabContent.className = 'tab-content';
        tabContent.innerHTML = `<div class="detailed-view"></div>`;
        document.getElementById('tab-overview').after(tabContent);

        registeredGPUs.add(gpuId);
    }

    // Update or create detailed GPU card
    const detailedContainer = document.getElementById(`tab-gpu-${gpuId}`)
        ?.querySelector('.detailed-view');
    const existingCard = document.getElementById(`gpu-${gpuId}`);

    if (!existingCard && detailedContainer) {
        const card = gpuCardElementFromMarkup(createGPUCard, gpuId, gpuInfo);
        detailedContainer.replaceChildren(card);
        window.GPUHotSettings?.bindGpuLabel?.(
            card.querySelector('.gpu-detail-title'),
            nodeName,
            sourceGpuId,
            `GPU ${gpuId}`
        );
        if (!chartData[gpuId]) initGPUData(gpuId);
        initGPUCharts(gpuId);
    } else if (existingCard) {
        updateGPUDisplay(gpuId, gpuInfo, shouldUpdateDOM);
    }
}

// Remove GPU tab
function removeGPUTab(gpuId) {
    if (!registeredGPUs.has(gpuId)) return;

    if (currentTab === `gpu-${gpuId}`) {
        switchToView('overview');
    }

    const btn = Array.from(document.querySelectorAll('.sidebar-btn'))
        .find(button => button.dataset.view === `gpu-${gpuId}`);
    if (btn) btn.remove();

    const tabContent = document.getElementById(`tab-gpu-${gpuId}`);
    if (tabContent) tabContent.remove();

    if (charts[gpuId]) {
        Object.values(charts[gpuId]).forEach(chart => {
            if (chart && chart.destroy) chart.destroy();
        });
        delete charts[gpuId];
    }

    registeredGPUs.delete(gpuId);
}

// Auto-switch to single GPU view
function autoSwitchSingleGPU(gpuCount, gpuIds) {
    if (gpuCount === 1 && !hasAutoSwitched) {
        const singleGpuId = gpuIds[0];
        setTimeout(() => {
            switchToView(`gpu-${singleGpuId}`);
        }, 300);
        hasAutoSwitched = true;
    }
}

window.switchToView = switchToView;
window.updateSidebarLabels = updateSidebarLabels;
window.applySidebarOrder = applySidebarOrder;
window.initializeSidebarOrdering = initializeSidebarOrdering;
window.applyDashboardOrder = applyDashboardOrder;
window.registerDashboardNode = registerDashboardNode;
window.registerDashboardGpu = registerDashboardGpu;
window.initializeDashboardOrdering = initializeDashboardOrdering;
window.DEFAULT_NODE_NAME = DEFAULT_NODE_NAME;
initializeSidebarOrdering();
initializeDashboardOrdering();
