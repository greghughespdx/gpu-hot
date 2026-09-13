/**
 * Tests for static/js/ui.js
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const testDir = dirname(fileURLToPath(import.meta.url));
const layoutCss = readFileSync(join(testDir, '../../static/css/layout.css'), 'utf8');
const componentsCss = readFileSync(join(testDir, '../../static/css/components.css'), 'utf8');

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

    it('does not move a captured bar button during repeated order updates', () => {
        vi.useFakeTimers();
        try {
            const first = addOrderedGpu('node-a', '0');
            const second = addOrderedGpu('node-a', '1');
            const nav = document.getElementById('view-selector');
            const append = vi.spyOn(nav, 'appendChild');
            second.getBoundingClientRect = () => ({ top: 40, height: 40, left: 0, width: 40 });
            document.elementFromPoint.mockReturnValue(second);

            dispatchPointer(first, 'pointerdown', {
                pointerId: 42, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
            });
            dispatchPointer(first, 'pointermove', {
                pointerId: 42, pointerType: 'mouse', clientX: 10, clientY: 30
            });
            const liveUpdate = setInterval(() => window.applySidebarOrder(document), 500);
            vi.advanceTimersByTime(2000);
            clearInterval(liveUpdate);

            expect(append.mock.calls.some(([button]) => button === first)).toBe(false);
            dispatchPointer(first, 'pointermove', {
                pointerId: 42, pointerType: 'mouse', clientX: 10, clientY: 70
            });
            dispatchPointer(first, 'pointerup', { pointerId: 42, pointerType: 'mouse' });
            expect(gpuButtonKeys()).toEqual([orderKey('node-a', '1'), orderKey('node-a', '0')]);
        } finally {
            vi.useRealTimers();
        }
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

    it('suppresses navigation without writing when a sidebar drag returns to its starting position', () => {
        const first = addOrderedGpu('node-a', '0');
        const second = addOrderedGpu('node-a', '1');
        second.getBoundingClientRect = () => ({ top: 40, height: 40, left: 0, width: 40 });
        document.elementFromPoint
            .mockReturnValueOnce(second)
            .mockReturnValueOnce(second);

        dispatchPointer(first, 'pointerdown', {
            pointerId: 12, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first, 'pointermove', {
            pointerId: 12, pointerType: 'mouse', clientX: 10, clientY: 70
        });
        dispatchPointer(first, 'pointermove', {
            pointerId: 12, pointerType: 'mouse', clientX: 10, clientY: 45
        });
        dispatchPointer(first, 'pointerup', { pointerId: 12, pointerType: 'mouse' });

        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-a', '1')]);
        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
        first.click();
        expect(global.currentTab).toBe('overview');
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

    it('ignores a second non-primary touch in the left bar', () => {
        const first = addOrderedGpu('node-a', '0');
        const second = addOrderedGpu('node-a', '1');
        second.getBoundingClientRect = () => ({ top: 40, height: 40, left: 0, width: 40 });
        document.elementFromPoint.mockReturnValue(second);

        dispatchPointer(first, 'pointerdown', {
            pointerId: 31, pointerType: 'touch', isPrimary: false,
            button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first, 'pointermove', {
            pointerId: 31, pointerType: 'touch', clientX: 10, clientY: 70
        });
        dispatchPointer(first, 'pointerup', { pointerId: 31, pointerType: 'touch' });

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

        const grip = first.querySelector('.dashboard-order-grip');
        dispatchPointer(grip, 'pointerdown', {
            pointerId: 20, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(grip, 'pointermove', {
            pointerId: 20, pointerType: 'mouse', clientX: 10, clientY: 140
        });
        dispatchPointer(grip, 'pointerup', {
            pointerId: 20, pointerType: 'mouse'
        });

        expect(dashboardKeys()).toEqual([
            orderKey('node-b', '0'), orderKey('node-a', '0'), orderKey('node-a', '1')
        ]);
        expect(gpuButtonKeys()).toEqual(dashboardKeys());
        expect(window.GPUHotSettings.settings.sidebarOrder).toEqual(dashboardKeys());
    });

    it('keeps a node grip attached through half-second live order updates', () => {
        vi.useFakeTimers();
        try {
            const first = addDashboardNode('node-a', ['0']);
            const second = addDashboardNode('node-b', ['0']);
            const container = document.getElementById('overview-container');
            const grip = first.querySelector('.dashboard-order-grip');
            const append = vi.spyOn(container, 'appendChild');
            second.getBoundingClientRect = () => ({ top: 100, height: 50, left: 0, width: 300 });
            document.elementFromPoint.mockReturnValue(second.querySelector('.node-label'));

            dispatchPointer(grip, 'pointerdown', {
                pointerId: 40, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
            });
            dispatchPointer(grip, 'pointermove', {
                pointerId: 40, pointerType: 'mouse', clientX: 10, clientY: 30
            });
            const liveUpdate = setInterval(() => {
                // A hub payload can re-register an offline placeholder each tick.
                window.registerDashboardNode(first, 'node-a');
                first.dataset.liveMetric = String(Number(first.dataset.liveMetric || 0) + 1);
            }, 500);
            vi.advanceTimersByTime(2000);
            clearInterval(liveUpdate);

            expect(first.dataset.liveMetric).toBe('4');
            expect(grip.isConnected).toBe(true);
            expect(append.mock.calls.some(([node]) => node === first)).toBe(false);
            dispatchPointer(grip, 'pointermove', {
                pointerId: 40, pointerType: 'mouse', clientX: 10, clientY: 140
            });
            dispatchPointer(grip, 'pointerup', { pointerId: 40, pointerType: 'mouse' });
            expect(dashboardKeys()).toEqual([orderKey('node-b', '0'), orderKey('node-a', '0')]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('moves a GPU by touch only within its node', () => {
        const group = addDashboardNode('node-a', ['0', '1']);
        const [first, second] = Array.from(group.querySelectorAll('.overview-gpu-card'));
        second.getBoundingClientRect = () => ({ top: 0, height: 60, left: 100, width: 80 });
        document.elementFromPoint.mockReturnValue(second.querySelector('.overview-gpu-name'));

        const grip = first.querySelector('.dashboard-order-grip');
        dispatchPointer(grip, 'pointerdown', {
            pointerId: 21, pointerType: 'touch', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(grip, 'pointermove', {
            pointerId: 21, pointerType: 'touch', clientX: 170, clientY: 10
        });
        dispatchPointer(grip, 'pointerup', {
            pointerId: 21, pointerType: 'touch'
        });

        expect(dashboardKeys()).toEqual([orderKey('node-a', '1'), orderKey('node-a', '0')]);
        expect(window.GPUHotSettings.settings.sidebarOrder).toEqual(dashboardKeys());
    });

    it('moves a visual copy with the pointer while the real GPU card holds the drop gap', () => {
        const group = addDashboardNode('node-a', ['0', '1']);
        const [first, second] = Array.from(group.querySelectorAll('.overview-gpu-card'));
        first.id = 'live-card';
        first.getBoundingClientRect = () => ({ top: 20, left: 30, width: 180, height: 60 });
        second.getBoundingClientRect = () => ({
            top: second.nextElementSibling === first ? 20 : 80,
            left: 30, width: 180, height: 60
        });
        const gapAnimation = { cancel: vi.fn() };
        second.animate = vi.fn(() => gapAnimation);
        document.elementFromPoint.mockReturnValue(second.querySelector('.overview-gpu-name'));
        const grip = first.querySelector('.dashboard-order-grip');
        const overview = document.getElementById('overview-container');
        overview.setPointerCapture = vi.fn();

        dispatchPointer(grip, 'pointerdown', {
            pointerId: 41, pointerType: 'mouse', button: 0, clientX: 40, clientY: 30
        });
        dispatchPointer(grip, 'pointermove', {
            pointerId: 41, pointerType: 'mouse', clientX: 70, clientY: 110
        });

        const ghost = document.querySelector('.dashboard-order-ghost');
        expect(ghost).not.toBeNull();
        expect(ghost.style.transform).toBe('translate(30px, 80px)');
        expect(ghost.style.left).toBe('30px');
        expect(ghost.style.top).toBe('20px');
        expect(ghost.hasAttribute('id')).toBe(false);
        expect(ghost.getAttribute('aria-hidden')).toBe('true');
        expect(first.classList.contains('dashboard-ordering')).toBe(true);
        expect(group.querySelector('.node-grid').lastElementChild).toBe(first);
        expect(overview.setPointerCapture).toHaveBeenCalledWith(41);
        expect(second.animate).toHaveBeenCalledWith([
            { transform: 'translate(0px, 60px)' },
            { transform: 'translate(0, 0)' }
        ], { duration: 150, easing: 'ease-out' });

        dispatchPointer(grip, 'pointerup', { pointerId: 41, pointerType: 'mouse' });
        expect(document.querySelector('.dashboard-order-ghost')).toBeNull();
        expect(first.classList.contains('dashboard-ordering')).toBe(false);
        expect(gapAnimation.cancel).toHaveBeenCalled();
    });

    it('removes the moving node copy and restores its gap on cancel', () => {
        const first = addDashboardNode('node-a', ['0']);
        const second = addDashboardNode('node-b', ['0']);
        first.getBoundingClientRect = () => ({ top: 0, left: 0, width: 600, height: 100 });
        second.getBoundingClientRect = () => ({ top: 100, left: 0, width: 600, height: 100 });
        document.elementFromPoint.mockReturnValue(second.querySelector('.node-label'));
        const grip = first.querySelector(':scope > .dashboard-order-grip');

        dispatchPointer(grip, 'pointerdown', {
            pointerId: 42, pointerType: 'touch', button: 0, clientX: 20, clientY: 20
        });
        dispatchPointer(grip, 'pointermove', {
            pointerId: 42, pointerType: 'touch', clientX: 30, clientY: 180
        });
        expect(document.querySelector('.dashboard-order-ghost')).not.toBeNull();
        expect(first.classList.contains('dashboard-ordering')).toBe(true);

        dispatchPointer(grip, 'pointercancel', { pointerId: 42, pointerType: 'touch' });
        expect(document.querySelector('.dashboard-order-ghost')).toBeNull();
        expect(first.classList.contains('dashboard-ordering')).toBe(false);
        expect(dashboardKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-b', '0')]);
        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
    });

    it('restores an All page touch move when it is cancelled', () => {
        const group = addDashboardNode('node-a', ['0', '1']);
        const [first, second] = Array.from(group.querySelectorAll('.overview-gpu-card'));
        second.getBoundingClientRect = () => ({ top: 0, height: 60, left: 100, width: 80 });
        document.elementFromPoint.mockReturnValue(second.querySelector('.overview-gpu-name'));

        const grip = first.querySelector('.dashboard-order-grip');
        dispatchPointer(grip, 'pointerdown', {
            pointerId: 22, pointerType: 'touch', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(grip, 'pointermove', {
            pointerId: 22, pointerType: 'touch', clientX: 170, clientY: 10
        });
        dispatchPointer(grip, 'pointercancel', {
            pointerId: 22, pointerType: 'touch'
        });

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

    it('suppresses navigation without writing when an All page drag returns to its starting position', () => {
        const group = addDashboardNode('node-a', ['0', '1']);
        const [first, second] = Array.from(group.querySelectorAll('.overview-gpu-card'));
        const firstGrip = first.querySelector('.dashboard-order-grip');
        second.getBoundingClientRect = () => ({ top: 0, height: 60, left: 100, width: 80 });
        document.elementFromPoint.mockReturnValue(second.querySelector('.overview-gpu-name'));
        const navigate = vi.fn();
        first.addEventListener('click', navigate);

        dispatchPointer(firstGrip, 'pointerdown', {
            pointerId: 23, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(firstGrip, 'pointermove', {
            pointerId: 23, pointerType: 'mouse', clientX: 170, clientY: 10
        });
        dispatchPointer(firstGrip, 'pointermove', {
            pointerId: 23, pointerType: 'mouse', clientX: 110, clientY: 10
        });
        dispatchPointer(firstGrip, 'pointerup', { pointerId: 23, pointerType: 'mouse' });

        expect(dashboardKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-a', '1')]);
        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
        first.click();
        expect(navigate).not.toHaveBeenCalled();
    });

    it('starts pointer ordering only from a grip handle', () => {
        const group = addDashboardNode('node-a', ['0', '1']);
        const [first, second] = Array.from(group.querySelectorAll('.overview-gpu-card'));
        const metrics = document.createElement('div');
        metrics.className = 'overview-metrics';
        first.appendChild(metrics);
        second.getBoundingClientRect = () => ({ top: 0, height: 60, left: 100, width: 80 });
        document.elementFromPoint.mockReturnValue(second.querySelector('.overview-gpu-name'));

        [first.querySelector('.overview-gpu-name'), metrics].forEach((target, index) => {
            const pointerId = 24 + index;
            dispatchPointer(target, 'pointerdown', {
                pointerId, pointerType: 'touch', button: 0, clientX: 10, clientY: 10
            });
            dispatchPointer(target, 'pointermove', {
                pointerId, pointerType: 'touch', clientX: 170, clientY: 10
            });
            dispatchPointer(target, 'pointerup', { pointerId, pointerType: 'touch' });
        });

        expect(dashboardKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-a', '1')]);
        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
    });

    it('adds one grip per ordering label and consumes grip clicks without navigation', () => {
        const group = addDashboardNode('node-a', ['0']);
        const card = group.querySelector('.overview-gpu-card');
        const nodeGrip = group.querySelector(':scope > .dashboard-order-grip');
        const gpuGrip = card.querySelector(':scope > .overview-gpu-name > .dashboard-order-grip');
        const navigate = vi.fn();
        card.addEventListener('click', navigate);

        window.registerDashboardNode(group, 'node-a');
        window.registerDashboardGpu(card, 'node-a', '0');

        expect(group.querySelectorAll(':scope > .dashboard-order-grip')).toHaveLength(1);
        expect(card.querySelectorAll(':scope > .overview-gpu-name > .dashboard-order-grip')).toHaveLength(1);
        expect(nodeGrip.dataset.dashboardOrderGrip).toBe('node');
        expect(gpuGrip.dataset.dashboardOrderGrip).toBe('gpu');
        const down = dispatchPointer(gpuGrip, 'pointerdown', {
            pointerId: 26, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(gpuGrip, 'pointerup', { pointerId: 26, pointerType: 'mouse' });
        gpuGrip.click();

        expect(down.defaultPrevented).toBe(true);
        expect(navigate).not.toHaveBeenCalled();
        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
    });

    it('keeps the node grip when label binding replaces the label text', () => {
        const group = addDashboardNode('node-a', ['0']);
        const label = group.querySelector(':scope > .node-label');
        const grip = group.querySelector(':scope > .dashboard-order-grip');

        label.textContent = 'Renamed node';

        expect(group.querySelector(':scope > .dashboard-order-grip')).toBe(grip);
        expect(label.textContent).toBe('Renamed node');
    });

    it('ignores a second non-primary touch', () => {
        const group = addDashboardNode('node-a', ['0', '1']);
        const [first, second] = Array.from(group.querySelectorAll('.overview-gpu-card'));
        second.getBoundingClientRect = () => ({ top: 0, height: 60, left: 100, width: 80 });
        document.elementFromPoint.mockReturnValue(second.querySelector('.overview-gpu-name'));

        const grip = first.querySelector('.dashboard-order-grip');
        dispatchPointer(grip, 'pointerdown', {
            pointerId: 30, pointerType: 'touch', isPrimary: false,
            button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(grip, 'pointermove', {
            pointerId: 30, pointerType: 'touch', clientX: 170, clientY: 10
        });
        dispatchPointer(grip, 'pointerup', {
            pointerId: 30, pointerType: 'touch'
        });

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

describe('ordering interaction styles', () => {
    it('keeps the drop gap while the pointer copy stays above the page', () => {
        expect(layoutCss).toMatch(/\.dashboard-ordering\s*\{[^}]*visibility:\s*hidden/s);
        expect(layoutCss).toMatch(/\.dashboard-order-ghost\s*\{[^}]*position:\s*fixed/s);
        expect(layoutCss).toMatch(/\.dashboard-order-ghost\s*\{[^}]*pointer-events:\s*none/s);
    });
    it('places each grip inside contiguous label padding', () => {
        const layoutStyles = document.createElement('style');
        layoutStyles.textContent = layoutCss;
        document.head.appendChild(layoutStyles);
        document.body.innerHTML = '<div id="overview-container"></div>';
        const group = addDashboardNode('node-a', ['0']);
        const nodeLabel = group.querySelector(':scope > .node-label');
        const nodeGrip = group.querySelector(':scope > .dashboard-order-grip');
        const gpuName = group.querySelector('.overview-gpu-name');
        const gpuGrip = gpuName.querySelector(':scope > .dashboard-order-grip');

        expect(getComputedStyle(nodeLabel).paddingLeft).toBe('18px');
        expect(getComputedStyle(gpuName).paddingLeft).toBe('18px');
        expect(getComputedStyle(nodeGrip).left).toBe('0px');
        expect(getComputedStyle(gpuGrip).left).toBe('0px');
        layoutStyles.remove();
    });

    it('keeps resting cursors unchanged and shows grabbing across the ordering surface during a move', () => {
        const layoutStyles = document.createElement('style');
        const componentStyles = document.createElement('style');
        layoutStyles.textContent = layoutCss;
        componentStyles.textContent = componentsCss;
        document.head.append(layoutStyles, componentStyles);
        document.body.innerHTML = `
            <div id="overview-container">
            <section class="node-group">
                <div class="node-label">Node</div>
                <div class="node-grid">
                    <article class="overview-gpu-card"><div class="overview-gpu-name">GPU 0</div></article>
                    <article class="overview-gpu-card"><div class="overview-gpu-name">GPU 1</div></article>
                </div>
            </section>
            </div>
        `;
        const cards = document.querySelectorAll('.overview-gpu-card');
        const card = cards[0];
        const neighbor = cards[1];
        neighbor.getBoundingClientRect = () => ({ left: 130, top: 0, width: 130, height: 60 });
        document.elementFromPoint = vi.fn(() => neighbor);
        window.registerDashboardGpu(card, 'node', '0');
        window.registerDashboardGpu(neighbor, 'node', '1');
        window.initializeDashboardOrdering();
        const grip = card.querySelector('.dashboard-order-grip');
        grip.setPointerCapture = vi.fn();

        expect(getComputedStyle(card).cursor).toBe('pointer');
        expect(getComputedStyle(neighbor).cursor).toBe('pointer');
        expect(getComputedStyle(grip).userSelect).toBe('none');
        dispatchPointer(grip, 'pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 20 });
        dispatchPointer(grip, 'pointermove', { pointerId: 1, clientX: 40, clientY: 20 });
        expect(getComputedStyle(card).cursor).toBe('grabbing');
        expect(getComputedStyle(grip).cursor).toBe('grabbing');
        expect(getComputedStyle(neighbor).cursor).toBe('grabbing');
        expect(document.getElementById('overview-container').classList.contains('dashboard-ordering-active')).toBe(true);
        dispatchPointer(grip, 'pointerup', { pointerId: 1, clientX: 40, clientY: 20 });
        expect(getComputedStyle(neighbor).cursor).toBe('pointer');
        expect(document.getElementById('overview-container').classList.contains('dashboard-ordering-active')).toBe(false);
        layoutStyles.remove();
        componentStyles.remove();
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
