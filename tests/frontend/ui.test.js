/**
 * Tests for static/js/ui.js
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Globals loaded by setup.js: switchToView, ensureGPUTab, removeGPUTab,
// autoSwitchSingleGPU, currentTab, registeredGPUs, charts, chartData

function setupDOM() {
    document.body.innerHTML = `
        <div id="view-selector">
            <button class="sidebar-btn active" data-view="overview">Overview</button>
        </div>
        <div id="tab-overview" class="tab-content active">
            <div id="overview-grid"></div>
        </div>
    `;
}

function orderKey(nodeName, gpuId) {
    return JSON.stringify([nodeName, gpuId]);
}

function addOrderedGpu(nodeName, gpuId) {
    const fullGpuId = `${nodeName}-${gpuId}`;
    ensureGPUTab(fullGpuId, { name: 'Test GPU' }, {
        shouldUpdateDOM: false,
        nodeName,
        sourceGpuId: gpuId
    });
    return document.querySelector(`[data-view="gpu-${fullGpuId}"]`);
}

function dispatchPointer(target, type, properties) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.entries(properties).forEach(([key, value]) => {
        Object.defineProperty(event, key, { value });
    });
    target.dispatchEvent(event);
    return event;
}

function gpuButtonKeys() {
    return Array.from(document.querySelectorAll('[data-sidebar-order-key]'))
        .map(button => button.dataset.sidebarOrderKey);
}

function addDashboardNode(nodeName, gpuIds) {
    const group = document.createElement('section');
    group.className = 'node-group';
    const label = document.createElement('div');
    label.className = 'node-label';
    label.textContent = nodeName;
    const grid = document.createElement('div');
    grid.className = 'node-grid';
    group.append(label, grid);
    document.getElementById('overview-container').appendChild(group);
    window.registerDashboardNode(group, nodeName);
    gpuIds.forEach(gpuId => {
        const card = document.createElement('article');
        card.className = 'overview-gpu-card';
        const name = document.createElement('div');
        name.className = 'overview-gpu-name';
        card.appendChild(name);
        grid.appendChild(card);
        window.registerDashboardGpu(card, nodeName, gpuId);
    });
    return group;
}

function dashboardKeys() {
    return Array.from(document.querySelectorAll(
        '#overview-container [data-layout-kind="gpu"]'
    )).map(card => card.dataset.layoutOrderKey);
}

describe('switchToView', () => {
    beforeEach(() => {
        setupDOM();
        global.currentTab = 'overview';
    });

    it('updates currentTab', () => {
        switchToView('overview');
        expect(global.currentTab).toBe('overview');
    });

    it('sets active class on correct button', () => {
        switchToView('overview');
        const btn = document.querySelector('[data-view="overview"]');
        expect(btn.classList.contains('active')).toBe(true);
    });

    it('does nothing for null viewName', () => {
        switchToView(null);
        // Should not throw
    });

    it('makes target tab visible', () => {
        const tab = document.getElementById('tab-overview');
        switchToView('overview');
        expect(tab.classList.contains('active')).toBe(true);
    });
});

describe('ensureGPUTab', () => {
    beforeEach(() => {
        setupDOM();
        global.registeredGPUs = new Set();
        global.charts = {};
        global.currentTab = 'overview';
        window.GPUHotSettings = { settings: {}, saveSettings: vi.fn(() => true) };
        document.elementFromPoint = vi.fn(() => null);
        window.initializeSidebarOrdering(document);
        for (const key of Object.keys(chartData)) {
            delete chartData[key];
        }
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('creates sidebar button on first call', () => {
        const gpuInfo = { name: 'RTX 3090', utilization: 50 };
        ensureGPUTab('0', gpuInfo, false);

        const btn = document.querySelector('[data-view="gpu-0"]');
        expect(btn).not.toBeNull();
        expect(global.registeredGPUs.has('0')).toBe(true);
    });

    it('creates tab content', () => {
        const gpuInfo = { name: 'RTX 3090', utilization: 50 };
        ensureGPUTab('0', gpuInfo, { shouldUpdateDOM: false });

        const tab = document.getElementById('tab-gpu-0');
        expect(tab).not.toBeNull();
    });

    it('is idempotent — does not duplicate', () => {
        const gpuInfo = { name: 'RTX 3090', utilization: 50 };
        ensureGPUTab('0', gpuInfo, { shouldUpdateDOM: false });
        ensureGPUTab('0', gpuInfo, { shouldUpdateDOM: false });

        const buttons = document.querySelectorAll('[data-view="gpu-0"]');
        expect(buttons.length).toBe(1);
    });

    it('shows last segment for cluster IDs', () => {
        const gpuInfo = { name: 'RTX 3090', utilization: 50 };
        ensureGPUTab('server-2-0', gpuInfo, { shouldUpdateDOM: false });

        const btn = document.querySelector('[data-view="gpu-server-2-0"]');
        expect(btn.textContent).toBe('0');
    });
});

describe('sidebar ordering', () => {
    beforeEach(() => {
        setupDOM();
        global.registeredGPUs = new Set();
        global.charts = {};
        global.currentTab = 'overview';
        window.GPUHotSettings = { settings: {}, saveSettings: vi.fn(() => true) };
        document.elementFromPoint = vi.fn(() => null);
        window.initializeSidebarOrdering(document);
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it.each(['mouse', 'touch'])('reorders with %s pointer input and persists the stable identities', pointerType => {
        const first = addOrderedGpu('node-a', '0');
        const second = addOrderedGpu('node-a', '1');
        second.getBoundingClientRect = () => ({ top: 40, height: 40, left: 0, width: 40 });
        document.elementFromPoint.mockReturnValue(second);

        dispatchPointer(first, 'pointerdown', {
            pointerId: 1, pointerType, button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first, 'pointermove', {
            pointerId: 1, pointerType, clientX: 10, clientY: 70
        });
        dispatchPointer(first, 'pointerup', { pointerId: 1, pointerType });

        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '1'), orderKey('node-a', '0')]);
        expect(window.GPUHotSettings.settings.sidebarOrder).toEqual(gpuButtonKeys());
        first.click();
        expect(global.currentTab).toBe('overview');
    });

    it('does not reorder until the pointer crosses the movement threshold', () => {
        const first = addOrderedGpu('node-a', '0');
        const second = addOrderedGpu('node-a', '1');
        document.elementFromPoint.mockReturnValue(second);

        dispatchPointer(first, 'pointerdown', {
            pointerId: 2, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first, 'pointermove', {
            pointerId: 2, pointerType: 'mouse', clientX: 10, clientY: 17
        });
        dispatchPointer(first, 'pointerup', { pointerId: 2, pointerType: 'mouse' });

        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-a', '1')]);
        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
    });

    it('does not write when a sidebar drag returns to its starting position', () => {
        const first = addOrderedGpu('node-a', '0');
        addOrderedGpu('node-a', '1');
        document.elementFromPoint.mockReturnValue(first);

        dispatchPointer(first, 'pointerdown', {
            pointerId: 12, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first, 'pointermove', {
            pointerId: 12, pointerType: 'mouse', clientX: 30, clientY: 10
        });
        dispatchPointer(first, 'pointerup', { pointerId: 12, pointerType: 'mouse' });

        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
    });

    it('keeps cross-node movement on the node-level All page control', () => {
        const first = addOrderedGpu('node-a', '0');
        const second = addOrderedGpu('node-b', '0');
        second.getBoundingClientRect = () => ({ top: 40, height: 40, left: 0, width: 40 });
        document.elementFromPoint.mockReturnValue(second);

        dispatchPointer(first, 'pointerdown', {
            pointerId: 13, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first, 'pointermove', {
            pointerId: 13, pointerType: 'mouse', clientX: 10, clientY: 70
        });
        dispatchPointer(first, 'pointerup', { pointerId: 13, pointerType: 'mouse' });

        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-b', '0')]);
        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
    });

    it('restores the starting order when touch input is cancelled', () => {
        const first = addOrderedGpu('node-a', '0');
        const second = addOrderedGpu('node-a', '1');
        second.getBoundingClientRect = () => ({ top: 40, height: 40, left: 0, width: 40 });
        document.elementFromPoint.mockReturnValue(second);

        dispatchPointer(first, 'pointerdown', {
            pointerId: 3, pointerType: 'touch', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first, 'pointermove', {
            pointerId: 3, pointerType: 'touch', clientX: 10, clientY: 70
        });
        dispatchPointer(first, 'pointercancel', { pointerId: 3, pointerType: 'touch' });

        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-a', '1')]);
        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
    });

    it('restores the starting order when pointer persistence fails', () => {
        const first = addOrderedGpu('node-a', '0');
        const second = addOrderedGpu('node-a', '1');
        window.GPUHotSettings.saveSettings.mockReturnValue(false);
        second.getBoundingClientRect = () => ({ top: 40, height: 40, left: 0, width: 40 });
        document.elementFromPoint.mockReturnValue(second);

        dispatchPointer(first, 'pointerdown', {
            pointerId: 4, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first, 'pointermove', {
            pointerId: 4, pointerType: 'mouse', clientX: 10, clientY: 70
        });
        dispatchPointer(first, 'pointerup', { pointerId: 4, pointerType: 'mouse' });

        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-a', '1')]);
    });

    it('offers an Alt Arrow keyboard equivalent and keeps focus on the moved GPU', () => {
        const first = addOrderedGpu('node-a', '0');
        addOrderedGpu('node-a', '1');
        first.focus();

        first.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true
        }));

        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '1'), orderKey('node-a', '0')]);
        expect(window.GPUHotSettings.settings.sidebarOrder).toEqual(gpuButtonKeys());
        expect(document.activeElement).toBe(first);
        expect(first.getAttribute('aria-keyshortcuts')).toContain('Alt+ArrowDown');
    });

    it('restores keyboard order when persistence fails', () => {
        const first = addOrderedGpu('node-a', '0');
        addOrderedGpu('node-a', '1');
        window.GPUHotSettings.saveSettings.mockReturnValue(false);

        first.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true
        }));

        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-a', '1')]);
        expect(document.activeElement).toBe(first);
    });

    it('restores persisted order when a GPU reconnects', () => {
        window.GPUHotSettings.settings.sidebarOrder = [
            orderKey('node-b', '0'),
            orderKey('node-a', '0')
        ];
        addOrderedGpu('node-a', '0');
        addOrderedGpu('node-b', '0');
        expect(gpuButtonKeys()).toEqual(window.GPUHotSettings.settings.sidebarOrder);

        removeGPUTab('node-b-0');
        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '0')]);
        addOrderedGpu('node-b', '0');

        expect(gpuButtonKeys()).toEqual(window.GPUHotSettings.settings.sidebarOrder);
    });

    it('appends a new GPU without dropping an absent GPU from its saved place', () => {
        window.GPUHotSettings.settings.sidebarOrder = [
            orderKey('node-a', '0'),
            orderKey('node-a', '1')
        ];
        addOrderedGpu('node-a', '0');
        const newGpu = addOrderedGpu('node-a', '2');

        expect(window.GPUHotSettings.settings.sidebarOrder).toEqual([
            orderKey('node-a', '0'),
            orderKey('node-a', '1'),
            orderKey('node-a', '2')
        ]);
        newGpu.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true
        }));
        expect(window.GPUHotSettings.settings.sidebarOrder).toEqual([
            orderKey('node-a', '2'),
            orderKey('node-a', '1'),
            orderKey('node-a', '0')
        ]);

        addOrderedGpu('node-a', '1');
        expect(gpuButtonKeys()).toEqual(window.GPUHotSettings.settings.sidebarOrder);
    });
});

describe('All page ordering', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="view-selector">
                <button class="sidebar-btn active" data-view="overview">Overview</button>
            </div>
            <div id="overview-container"></div>
            <div id="tab-overview"></div>
        `;
        window.GPUHotSettings = { settings: {}, saveSettings: vi.fn(() => true) };
        global.registeredGPUs = new Set();
        global.charts = {};
        global.currentTab = 'overview';
        document.elementFromPoint = vi.fn(() => null);
        window.initializeSidebarOrdering(document);
        window.initializeDashboardOrdering(document);
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('moves a node as one unit and makes the left bar follow', () => {
        const first = addDashboardNode('node-a', ['0', '1']);
        const second = addDashboardNode('node-b', ['0']);
        addOrderedGpu('node-a', '0');
        addOrderedGpu('node-a', '1');
        addOrderedGpu('node-b', '0');
        second.getBoundingClientRect = () => ({ top: 100, height: 50, left: 0, width: 300 });
        document.elementFromPoint.mockReturnValue(second.querySelector('.node-label'));

        dispatchPointer(first.querySelector('.node-label'), 'pointerdown', {
            pointerId: 20, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first.querySelector('.node-label'), 'pointermove', {
            pointerId: 20, pointerType: 'mouse', clientX: 10, clientY: 140
        });
        dispatchPointer(first.querySelector('.node-label'), 'pointerup', {
            pointerId: 20, pointerType: 'mouse'
        });

        expect(dashboardKeys()).toEqual([
            orderKey('node-b', '0'), orderKey('node-a', '0'), orderKey('node-a', '1')
        ]);
        expect(gpuButtonKeys()).toEqual(dashboardKeys());
        expect(window.GPUHotSettings.settings.sidebarOrder).toEqual(dashboardKeys());
    });

    it('moves a GPU by touch only within its node', () => {
        const group = addDashboardNode('node-a', ['0', '1']);
        const [first, second] = Array.from(group.querySelectorAll('.overview-gpu-card'));
        second.getBoundingClientRect = () => ({ top: 0, height: 60, left: 100, width: 80 });
        document.elementFromPoint.mockReturnValue(second.querySelector('.overview-gpu-name'));

        dispatchPointer(first.querySelector('.overview-gpu-name'), 'pointerdown', {
            pointerId: 21, pointerType: 'touch', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first.querySelector('.overview-gpu-name'), 'pointermove', {
            pointerId: 21, pointerType: 'touch', clientX: 170, clientY: 10
        });
        dispatchPointer(first.querySelector('.overview-gpu-name'), 'pointerup', {
            pointerId: 21, pointerType: 'touch'
        });

        expect(dashboardKeys()).toEqual([orderKey('node-a', '1'), orderKey('node-a', '0')]);
        expect(window.GPUHotSettings.settings.sidebarOrder).toEqual(dashboardKeys());
    });

    it('restores an All page touch move when it is cancelled', () => {
        const group = addDashboardNode('node-a', ['0', '1']);
        const [first, second] = Array.from(group.querySelectorAll('.overview-gpu-card'));
        second.getBoundingClientRect = () => ({ top: 0, height: 60, left: 100, width: 80 });
        document.elementFromPoint.mockReturnValue(second);

        dispatchPointer(first, 'pointerdown', {
            pointerId: 22, pointerType: 'touch', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first, 'pointermove', {
            pointerId: 22, pointerType: 'touch', clientX: 170, clientY: 10
        });
        dispatchPointer(first, 'pointercancel', { pointerId: 22, pointerType: 'touch' });

        expect(dashboardKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-a', '1')]);
        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
    });

    it('moves a focused All page card with Alt Arrow and keeps focus', () => {
        const group = addDashboardNode('node-a', ['0', '1']);
        const first = group.querySelector('.overview-gpu-card');
        first.focus();

        first.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true
        }));

        expect(dashboardKeys()).toEqual([orderKey('node-a', '1'), orderKey('node-a', '0')]);
        expect(document.activeElement).toBe(first);
        expect(first.hasAttribute('aria-grabbed')).toBe(false);
    });

    it('moves a focused node as one keyboard unit', () => {
        const first = addDashboardNode('node-a', ['0', '1']);
        addDashboardNode('node-b', ['0']);
        first.focus();

        first.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true
        }));

        expect(dashboardKeys()).toEqual([
            orderKey('node-b', '0'), orderKey('node-a', '0'), orderKey('node-a', '1')
        ]);
        expect(document.activeElement).toBe(first);
    });

    it('does not write when a drag finishes in its starting position', () => {
        const group = addDashboardNode('node-a', ['0', '1']);
        const first = group.querySelector('.overview-gpu-card');
        document.elementFromPoint.mockReturnValue(first);

        dispatchPointer(first, 'pointerdown', {
            pointerId: 23, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first, 'pointermove', {
            pointerId: 23, pointerType: 'mouse', clientX: 30, clientY: 10
        });
        dispatchPointer(first, 'pointerup', { pointerId: 23, pointerType: 'mouse' });

        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
    });

    it('ignores a second non-primary touch', () => {
        const group = addDashboardNode('node-a', ['0', '1']);
        const [first, second] = Array.from(group.querySelectorAll('.overview-gpu-card'));
        second.getBoundingClientRect = () => ({ top: 0, height: 60, left: 100, width: 80 });
        document.elementFromPoint.mockReturnValue(second);

        dispatchPointer(first, 'pointerdown', {
            pointerId: 30, pointerType: 'touch', isPrimary: false,
            button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first, 'pointermove', {
            pointerId: 30, pointerType: 'touch', clientX: 170, clientY: 10
        });
        dispatchPointer(first, 'pointerup', { pointerId: 30, pointerType: 'touch' });

        expect(dashboardKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-a', '1')]);
        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
    });

    it('reapplies saved node and GPU order after a reconnect render', () => {
        window.GPUHotSettings.settings.sidebarOrder = [
            orderKey('node-b', '0'), orderKey('node-a', '1'), orderKey('node-a', '0')
        ];
        addDashboardNode('node-a', ['0', '1']);
        addDashboardNode('node-b', ['0']);

        expect(dashboardKeys()).toEqual(window.GPUHotSettings.settings.sidebarOrder);
        document.getElementById('overview-container').replaceChildren();
        addDashboardNode('node-a', ['0', '1']);
        addDashboardNode('node-b', ['0']);

        expect(dashboardKeys()).toEqual(window.GPUHotSettings.settings.sidebarOrder);
    });

    it('restores discovery order after settings reset', () => {
        addDashboardNode('reset-a', ['0']);
        addDashboardNode('reset-b', ['0']);
        window.GPUHotSettings.settings.sidebarOrder = [
            orderKey('reset-b', '0'), orderKey('reset-a', '0')
        ];
        window.applyDashboardOrder(document);
        expect(dashboardKeys()).toEqual(window.GPUHotSettings.settings.sidebarOrder);

        delete window.GPUHotSettings.settings.sidebarOrder;
        window.applyDashboardOrder(document);

        expect(dashboardKeys()).toEqual([orderKey('reset-a', '0'), orderKey('reset-b', '0')]);
    });
});

describe('removeGPUTab', () => {
    beforeEach(() => {
        setupDOM();
        global.registeredGPUs = new Set();
        global.charts = {};
        global.currentTab = 'overview';
        for (const key of Object.keys(chartData)) {
            delete chartData[key];
        }
    });

    it('removes button and tab', () => {
        const gpuInfo = { name: 'RTX 3090', utilization: 50 };
        ensureGPUTab('0', gpuInfo, { shouldUpdateDOM: false });
        removeGPUTab('0');

        expect(document.querySelector('[data-view="gpu-0"]')).toBeNull();
        expect(document.getElementById('tab-gpu-0')).toBeNull();
        expect(global.registeredGPUs.has('0')).toBe(false);
    });

    it('switches to overview if current tab removed', () => {
        const gpuInfo = { name: 'RTX 3090', utilization: 50 };
        ensureGPUTab('0', gpuInfo, { shouldUpdateDOM: false });
        global.currentTab = 'gpu-0';
        removeGPUTab('0');

        expect(global.currentTab).toBe('overview');
    });

    it('destroys charts', () => {
        const gpuInfo = { name: 'RTX 3090', utilization: 50 };
        ensureGPUTab('0', gpuInfo, { shouldUpdateDOM: false });

        const mockChart = { destroy: () => {} };
        global.charts['0'] = { utilization: mockChart };
        removeGPUTab('0');

        expect(global.charts['0']).toBeUndefined();
    });

    it('no-op for unregistered GPU', () => {
        removeGPUTab('999');
        // Should not throw
    });
});

describe('autoSwitchSingleGPU', () => {
    beforeEach(() => {
        setupDOM();
        global.hasAutoSwitched = false;
        global.currentTab = 'overview';
    });

    it('switches to single GPU view', async () => {
        // Create a tab for the GPU so switchToView has a target
        const tab = document.createElement('div');
        tab.id = 'tab-gpu-0';
        tab.className = 'tab-content';
        document.body.appendChild(tab);

        const btn = document.createElement('button');
        btn.className = 'sidebar-btn';
        btn.dataset.view = 'gpu-0';
        document.getElementById('view-selector').appendChild(btn);

        autoSwitchSingleGPU(1, ['0']);

        // Wait for setTimeout(300ms)
        await new Promise(r => setTimeout(r, 350));
        expect(global.currentTab).toBe('gpu-0');
        expect(global.hasAutoSwitched).toBe(true);
    });

    it('does not switch with multiple GPUs', () => {
        autoSwitchSingleGPU(2, ['0', '1']);
        expect(global.currentTab).toBe('overview');
        expect(global.hasAutoSwitched).toBe(false);
    });

    it('only switches once', async () => {
        const tab = document.createElement('div');
        tab.id = 'tab-gpu-0';
        tab.className = 'tab-content';
        document.body.appendChild(tab);

        const btn = document.createElement('button');
        btn.className = 'sidebar-btn';
        btn.dataset.view = 'gpu-0';
        document.getElementById('view-selector').appendChild(btn);

        autoSwitchSingleGPU(1, ['0']);
        autoSwitchSingleGPU(1, ['0']);

        await new Promise(r => setTimeout(r, 350));
        expect(global.hasAutoSwitched).toBe(true);
    });
});
