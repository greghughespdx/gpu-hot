/**
 * UI Interactions and navigation — GPU Studio
 * Sidebar-based navigation
 */

// Global state
let currentTab = 'overview';
let registeredGPUs = new Set();
let hasAutoSwitched = false;
const SIDEBAR_MOVE_THRESHOLD = 8;
const defaultSidebarOrder = [];
let activeSidebarMove = null;
let suppressedSidebarClickKey = null;

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
    if (!nav) return;
    const buttonsByKey = new Map(sidebarButtons(nav).map(button => [button.dataset.sidebarOrderKey, button]));
    const saved = savedSidebarOrder();
    const order = saved.length > 0 ? saved : defaultSidebarOrder;
    order.forEach(key => {
        const button = buttonsByKey.get(key);
        if (button) nav.appendChild(button);
    });
}

function registerSidebarOrder(button, nodeName, gpuId) {
    const key = sidebarOrderKey(nodeName, gpuId);
    button.dataset.sidebarOrderKey = key;
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
    if (cancelled) restoreVisibleSidebarOrder(nav, initialOrder);
    else if (moved && !persistVisibleSidebarOrder(nav)) {
        restoreVisibleSidebarOrder(nav, initialOrder);
    }
    if (moved && !cancelled) {
        suppressedSidebarClickKey = button.dataset.sidebarOrderKey;
        setTimeout(() => { suppressedSidebarClickKey = null; }, 0);
    }
    button.classList.remove('sidebar-ordering');
    button.removeAttribute('aria-grabbed');
    activeSidebarMove = null;
}

function beginSidebarMove(event, nav) {
    const button = event.target.closest('.sidebar-btn[data-sidebar-order-key]');
    if (!button || (event.button !== undefined && event.button !== 0)) return;
    activeSidebarMove = {
        button,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        initialOrder: sidebarButtons(nav).map(entry => entry.dataset.sidebarOrderKey)
    };
    if (typeof button.setPointerCapture === 'function') button.setPointerCapture(event.pointerId);
}

function continueSidebarMove(event, nav, documentRef) {
    if (!activeSidebarMove || event.pointerId !== activeSidebarMove.pointerId) return;
    const distance = Math.hypot(
        event.clientX - activeSidebarMove.startX,
        event.clientY - activeSidebarMove.startY
    );
    if (!activeSidebarMove.moved && distance < SIDEBAR_MOVE_THRESHOLD) return;
    activeSidebarMove.moved = true;
    activeSidebarMove.button.classList.add('sidebar-ordering');
    activeSidebarMove.button.setAttribute('aria-grabbed', 'true');
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
    if (!target) return;
    const initialOrder = buttons.map(entry => entry.dataset.sidebarOrderKey);
    nav.insertBefore(button, offset < 0 ? target : target.nextSibling);
    if (!persistVisibleSidebarOrder(nav)) restoreVisibleSidebarOrder(nav, initialOrder);
    button.focus();
    event.preventDefault();
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
    nav.addEventListener('click', suppressSidebarClick, true);
    nav.addEventListener('keydown', event => moveSidebarButtonByKey(event, nav));
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
    document.querySelectorAll('.sidebar-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.view === viewName) {
            btn.classList.add('active');
        }
    });

    // Switch tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    const targetContent = document.getElementById(`tab-${viewName}`);
    if (!targetContent) return;

    targetContent.classList.add('active');

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
        nodeName = '_local',
        sourceGpuId = gpuId
    } = normalizedOptions;
    if (!registeredGPUs.has(gpuId)) {
        // Add sidebar button
        const viewSelector = document.getElementById('view-selector');
        const btn = document.createElement('button');
        btn.className = 'sidebar-btn';
        btn.dataset.view = `gpu-${gpuId}`;
        // For cluster IDs like "gpu-server-2-0", show only the last segment
        const parts = String(gpuId).split('-');
        btn.textContent = parts.length > 1 ? parts[parts.length - 1] : gpuId;
        btn.title = `GPU ${gpuId}`;
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
    const detailedContainer = document.querySelector(`#tab-gpu-${gpuId} .detailed-view`);
    const existingCard = document.getElementById(`gpu-${gpuId}`);

    if (!existingCard && detailedContainer) {
        detailedContainer.innerHTML = createGPUCard(gpuId, gpuInfo);
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

    const btn = document.querySelector(`.sidebar-btn[data-view="gpu-${gpuId}"]`);
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
window.applySidebarOrder = applySidebarOrder;
window.initializeSidebarOrdering = initializeSidebarOrdering;
initializeSidebarOrdering();
