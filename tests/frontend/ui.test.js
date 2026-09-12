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
        const second = addOrderedGpu('node-b', '0');
        second.getBoundingClientRect = () => ({ top: 40, height: 40, left: 0, width: 40 });
        document.elementFromPoint.mockReturnValue(second);

        dispatchPointer(first, 'pointerdown', {
            pointerId: 1, pointerType, button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first, 'pointermove', {
            pointerId: 1, pointerType, clientX: 10, clientY: 70
        });
        dispatchPointer(first, 'pointerup', { pointerId: 1, pointerType });

        expect(gpuButtonKeys()).toEqual([orderKey('node-b', '0'), orderKey('node-a', '0')]);
        expect(window.GPUHotSettings.settings.sidebarOrder).toEqual(gpuButtonKeys());
        first.click();
        expect(global.currentTab).toBe('overview');
    });

    it('does not reorder until the pointer crosses the movement threshold', () => {
        const first = addOrderedGpu('node-a', '0');
        const second = addOrderedGpu('node-b', '0');
        document.elementFromPoint.mockReturnValue(second);

        dispatchPointer(first, 'pointerdown', {
            pointerId: 2, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first, 'pointermove', {
            pointerId: 2, pointerType: 'mouse', clientX: 10, clientY: 17
        });
        dispatchPointer(first, 'pointerup', { pointerId: 2, pointerType: 'mouse' });

        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-b', '0')]);
        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
    });

    it('restores the starting order when touch input is cancelled', () => {
        const first = addOrderedGpu('node-a', '0');
        const second = addOrderedGpu('node-b', '0');
        second.getBoundingClientRect = () => ({ top: 40, height: 40, left: 0, width: 40 });
        document.elementFromPoint.mockReturnValue(second);

        dispatchPointer(first, 'pointerdown', {
            pointerId: 3, pointerType: 'touch', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first, 'pointermove', {
            pointerId: 3, pointerType: 'touch', clientX: 10, clientY: 70
        });
        dispatchPointer(first, 'pointercancel', { pointerId: 3, pointerType: 'touch' });

        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-b', '0')]);
        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
    });

    it('restores the starting order when pointer persistence fails', () => {
        const first = addOrderedGpu('node-a', '0');
        const second = addOrderedGpu('node-b', '0');
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

        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-b', '0')]);
    });

    it('offers an Alt Arrow keyboard equivalent and keeps focus on the moved GPU', () => {
        const first = addOrderedGpu('node-a', '0');
        addOrderedGpu('node-b', '0');
        first.focus();

        first.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true
        }));

        expect(gpuButtonKeys()).toEqual([orderKey('node-b', '0'), orderKey('node-a', '0')]);
        expect(window.GPUHotSettings.settings.sidebarOrder).toEqual(gpuButtonKeys());
        expect(document.activeElement).toBe(first);
        expect(first.getAttribute('aria-keyshortcuts')).toContain('Alt+ArrowDown');
    });

    it('restores keyboard order when persistence fails', () => {
        const first = addOrderedGpu('node-a', '0');
        addOrderedGpu('node-b', '0');
        window.GPUHotSettings.saveSettings.mockReturnValue(false);

        first.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true
        }));

        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-b', '0')]);
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
            orderKey('node-b', '0')
        ];
        addOrderedGpu('node-a', '0');
        const newGpu = addOrderedGpu('node-c', '0');

        expect(window.GPUHotSettings.settings.sidebarOrder).toEqual([
            orderKey('node-a', '0'),
            orderKey('node-b', '0'),
            orderKey('node-c', '0')
        ]);
        newGpu.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true
        }));
        expect(window.GPUHotSettings.settings.sidebarOrder).toEqual([
            orderKey('node-c', '0'),
            orderKey('node-b', '0'),
            orderKey('node-a', '0')
        ]);

        addOrderedGpu('node-b', '0');
        expect(gpuButtonKeys()).toEqual(window.GPUHotSettings.settings.sidebarOrder);
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
