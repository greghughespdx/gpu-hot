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
import vm from 'vm';

const settingsSource = readFileSync(join(testDir, '../../static/js/settings.js'), 'utf8');

function loadSettingsModule() {
    delete window.GPUHotSettings;
    vm.runInThisContext(settingsSource, { filename: 'settings.js' });
    return window.GPUHotSettings;
}

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
        <div id="processes-container"></div>
        <span id="process-count"></span>
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
        window.matchMedia = vi.fn(() => ({ matches: false }));
        updateProcesses([]);
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

    it('keeps the selected button visible in an overflowing phone bar', () => {
        window.matchMedia.mockReturnValue({ matches: true });
        const btn = document.createElement('button');
        btn.className = 'sidebar-btn';
        btn.dataset.view = 'gpu-node-b-1';
        btn.scrollIntoView = vi.fn();
        document.getElementById('view-selector').appendChild(btn);

        const tab = document.createElement('div');
        tab.id = 'tab-gpu-node-b-1';
        tab.className = 'tab-content';
        document.body.appendChild(tab);

        switchToView('gpu-node-b-1');

        expect(btn.scrollIntoView).toHaveBeenCalledWith({
            block: 'nearest',
            inline: 'nearest'
        });
    });

    it('does not scroll the selected button in the desktop bar', () => {
        const btn = document.createElement('button');
        btn.className = 'sidebar-btn';
        btn.dataset.view = 'gpu-node-b-1';
        btn.scrollIntoView = vi.fn();
        document.getElementById('view-selector').appendChild(btn);
        const tab = document.createElement('div');
        tab.id = 'tab-gpu-node-b-1';
        tab.className = 'tab-content';
        document.body.appendChild(tab);

        switchToView('gpu-node-b-1');

        expect(btn.scrollIntoView).not.toHaveBeenCalled();
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

    it('updates the process list when a GPU view is selected', () => {
        const tab = document.createElement('div');
        tab.id = 'tab-gpu-render-1-0';
        tab.className = 'tab-content';
        document.body.appendChild(tab);
        updateProcesses([
            { name: 'selected', pid: '1', memory: 100, node_name: 'render-1', gpu_key: 'render-1-0' },
            { name: 'other', pid: '2', memory: 100, node_name: 'render-2', gpu_key: 'render-2-0' }
        ]);

        switchToView('gpu-render-1-0');

        expect([...document.querySelectorAll('.process-name')].map(el => el.textContent)).toEqual(['selected']);
    });
});

describe('ensureGPUTab', () => {
    beforeEach(() => {
        setupDOM();
        localStorage.clear();
        global.registeredGPUs = new Set();
        global.charts = {};
        global.currentTab = 'overview';
        window.matchMedia = vi.fn(() => ({ matches: false }));
        window.GPUHotSettings = { settings: {}, saveSettings: vi.fn(() => true) };
        document.elementFromPoint = vi.fn(() => null);
        window.initializeSidebarOrdering(document);
        for (const key of Object.keys(chartData)) {
            delete chartData[key];
        }
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

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

    it('shows node and index when that label scheme is selected', () => {
        window.GPUHotSettings.settings.sidebarLabel = 'node-index';
        ensureGPUTab('gpu-server-2-0', { name: 'AMD Radeon Pro V620' }, false);

        expect(document.querySelector('[data-view="gpu-gpu-server-2-0"]').textContent)
            .toBe('gpu-server-2 0');
    });

    it('shows a short model name when that label scheme is selected', () => {
        window.GPUHotSettings.settings.sidebarLabel = 'short-name';
        ensureGPUTab('node-a-1', { name: 'AMD Radeon Pro V620' }, false);

        expect(document.querySelector('[data-view="gpu-node-a-1"]').textContent).toBe('V620');
    });

    it('updates existing labels when the setting changes', () => {
        ensureGPUTab('node-a-1', { name: 'NVIDIA GeForce RTX 4090' }, false);
        window.GPUHotSettings.settings.sidebarLabel = 'short-name';

        window.updateSidebarLabels();

        expect(document.querySelector('[data-view="gpu-node-a-1"]').textContent).toBe('RTX 4090');
    });

    it('keeps a custom GPU label above the selected scheme', () => {
        const bindGpuLabel = vi.fn((element, nodeName, gpuId, fallback, output = 'text') => {
            const label = nodeName === 'node-a' && gpuId === '1'
                ? 'Training card'
                : fallback;
            if (output === 'title') element.title = label;
            else element.textContent = label;
        });
        window.GPUHotSettings = {
            settings: { sidebarLabel: 'index' },
            registerGpuLabelTarget: () => {},
            bindGpuLabel
        };

        ensureGPUTab('node-a-1', { name: 'NVIDIA GeForce RTX 4090' }, {
            shouldUpdateDOM: false,
            nodeName: 'node-a',
            sourceGpuId: '1'
        });
        const button = document.querySelector('[data-view="gpu-node-a-1"]');
        expect(button.textContent).toBe('Training card');
        expect(bindGpuLabel).toHaveBeenNthCalledWith(
            1, button.querySelector('.sidebar-btn-label'), 'node-a', '1', '1'
        );

        window.GPUHotSettings.settings.sidebarLabel = 'short-name';
        window.updateSidebarLabels();

        expect(button.textContent).toBe('Training card');
        expect(button.title).toBe('Training card');
        expect(bindGpuLabel).toHaveBeenCalledWith(
            button.querySelector('.sidebar-btn-label'), 'node-a', '1', 'RTX 4090'
        );
        expect(button.dataset.gpuNode).toBe('node-a');
        expect(button.dataset.sourceGpuId).toBe('1');
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
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('preserves a stationary GPU button and lets its click navigate', () => {
        const button = addOrderedGpu('node-a', '0');
        const nav = document.getElementById('view-selector');
        const append = vi.spyOn(nav, 'appendChild');
        const insert = vi.spyOn(nav, 'insertBefore');

        dispatchPointer(button, 'pointerdown', {
            pointerId: 91, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(button, 'pointerup', {
            pointerId: 91, pointerType: 'mouse', clientX: 10, clientY: 10
        });

        expect(nav.contains(button)).toBe(true);
        expect(append).not.toHaveBeenCalled();
        expect(insert).not.toHaveBeenCalled();
        button.click();
        expect(global.currentTab).toBe('gpu-node-a-0');
    });

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

    it('lets a phone touch swipe scroll without starting a reorder', () => {
        vi.useFakeTimers();
        window.matchMedia.mockReturnValue({ matches: true });
        const first = addOrderedGpu('node-a', '0');
        addOrderedGpu('node-a', '1');

        dispatchPointer(first, 'pointerdown', {
            pointerId: 41, pointerType: 'touch', button: 0, clientX: 10, clientY: 10
        });
        const move = dispatchPointer(first, 'pointermove', {
            pointerId: 41, pointerType: 'touch', clientX: 30, clientY: 10
        });
        vi.advanceTimersByTime(300);

        expect(move.defaultPrevented).toBe(false);
        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-a', '1')]);
        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('reorders a phone bar only after a touch is held for 300 ms', () => {
        vi.useFakeTimers();
        window.matchMedia.mockReturnValue({ matches: true });
        const nav = document.getElementById('view-selector');
        nav.style.flexDirection = 'row';
        const first = addOrderedGpu('node-a', '0');
        const second = addOrderedGpu('node-a', '1');
        first.setPointerCapture = vi.fn();
        second.getBoundingClientRect = () => ({ top: 0, height: 40, left: 40, width: 40 });
        document.elementFromPoint.mockReturnValue(second);

        dispatchPointer(first, 'pointerdown', {
            pointerId: 42, pointerType: 'touch', button: 0, clientX: 10, clientY: 10
        });
        vi.advanceTimersByTime(299);
        expect(first.setPointerCapture).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(first.setPointerCapture).toHaveBeenCalledWith(42);
        const touchMove = new Event('touchmove', { bubbles: true, cancelable: true });
        first.dispatchEvent(touchMove);
        expect(touchMove.defaultPrevented).toBe(true);
        const move = dispatchPointer(first, 'pointermove', {
            pointerId: 42, pointerType: 'touch', clientX: 75, clientY: 10
        });
        dispatchPointer(first, 'pointerup', { pointerId: 42, pointerType: 'touch' });

        expect(move.defaultPrevented).toBe(true);
        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '1'), orderKey('node-a', '0')]);
        expect(window.GPUHotSettings.settings.sidebarOrder).toEqual(gpuButtonKeys());
        vi.useRealTimers();
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

    it('cancels a rail drag on Escape without saving or opening a GPU page', () => {
        const first = addOrderedGpu('node-a', '0');
        const second = addOrderedGpu('node-a', '1');
        second.getBoundingClientRect = () => ({ top: 40, height: 40, left: 0, width: 40 });
        document.elementFromPoint.mockReturnValue(second);

        dispatchPointer(first, 'pointerdown', {
            pointerId: 81, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first, 'pointermove', {
            pointerId: 81, pointerType: 'mouse', clientX: 10, clientY: 70
        });
        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '1'), orderKey('node-a', '0')]);

        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        document.dispatchEvent(escape);
        dispatchPointer(first, 'pointerup', { pointerId: 81, pointerType: 'mouse' });
        first.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));

        expect(escape.defaultPrevented).toBe(true);
        expect(gpuButtonKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-a', '1')]);
        expect(first.classList.contains('sidebar-ordering')).toBe(false);
        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
        expect(global.currentTab).toBe('overview');

        dispatchPointer(first, 'pointerdown', {
            pointerId: 82, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(first, 'pointerup', { pointerId: 82, pointerType: 'mouse' });
        first.click();
        expect(global.currentTab).toBe('gpu-node-a-0');
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
            <div id="processes-container"></div>
            <span id="process-count"></span>
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
        updateProcesses([
            { name: 'A0', node_name: 'node-a', gpu_id: '0', gpu_key: 'node-a-0', memory: 1 },
            { name: 'B0', node_name: 'node-b', gpu_id: '0', gpu_key: 'node-b-0', memory: 1 },
            { name: 'A1', node_name: 'node-a', gpu_id: '1', gpu_key: 'node-a-1', memory: 1 }
        ]);
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
        expect([...document.querySelectorAll('.process-name')].map(cell => cell.textContent))
            .toEqual(['B0', 'A0', 'A1']);
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
        const layoutStyles = document.createElement('style');
        layoutStyles.textContent = layoutCss;
        document.head.appendChild(layoutStyles);
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
        const ghost = document.querySelector('.dashboard-order-ghost');
        expect(ghost).not.toBeNull();
        expect(ghost.hasAttribute('data-layout-kind')).toBe(false);
        expect(getComputedStyle(ghost).position).toBe('fixed');
        expect(first.classList.contains('dashboard-ordering')).toBe(true);

        dispatchPointer(grip, 'pointercancel', { pointerId: 42, pointerType: 'touch' });
        expect(document.querySelector('.dashboard-order-ghost')).toBeNull();
        expect(first.classList.contains('dashboard-ordering')).toBe(false);
        expect(dashboardKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-b', '0')]);
        expect(window.GPUHotSettings.saveSettings).not.toHaveBeenCalled();
        layoutStyles.remove();
    });

    it('restores the starting order when Escape cancels a node drag', () => {
        const first = addDashboardNode('node-a', ['0']);
        const second = addDashboardNode('node-b', ['0']);
        second.getBoundingClientRect = () => ({ top: 100, left: 0, width: 300, height: 60 });
        document.elementFromPoint.mockReturnValue(second.querySelector('.node-label'));
        const grip = first.querySelector(':scope > .dashboard-order-grip');

        dispatchPointer(grip, 'pointerdown', {
            pointerId: 43, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
        });
        dispatchPointer(grip, 'pointermove', {
            pointerId: 43, pointerType: 'mouse', clientX: 10, clientY: 140
        });
        expect(dashboardKeys()).toEqual([orderKey('node-b', '0'), orderKey('node-a', '0')]);

        const escape = new KeyboardEvent('keydown', {
            key: 'Escape', bubbles: true, cancelable: true
        });
        document.dispatchEvent(escape);
        expect(escape.defaultPrevented).toBe(true);
        expect(dashboardKeys()).toEqual([orderKey('node-a', '0'), orderKey('node-b', '0')]);
        expect(document.querySelector('.dashboard-order-ghost')).toBeNull();
        expect(first.classList.contains('dashboard-ordering')).toBe(false);
        expect(document.getElementById('overview-container').classList.contains('dashboard-ordering-active')).toBe(false);

        dispatchPointer(grip, 'pointerup', { pointerId: 43, pointerType: 'mouse' });
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

    it('keeps the grip usable and clones the full height of a wrapped card', () => {
        const group = addDashboardNode('node-a', ['0']);
        const card = group.querySelector('.overview-gpu-card');
        const name = card.querySelector('.overview-gpu-name');
        name.append(document.createTextNode('A'.repeat(80)));
        card.getBoundingClientRect = () => ({ left: 20, top: 30, width: 300, height: 90 });
        const grip = name.querySelector('.dashboard-order-grip');
        grip.setPointerCapture = vi.fn();

        dispatchPointer(grip, 'pointerdown', {
            pointerId: 35, pointerType: 'mouse', button: 0, clientX: 25, clientY: 35
        });
        dispatchPointer(grip, 'pointermove', {
            pointerId: 35, pointerType: 'mouse', clientX: 45, clientY: 55
        });

        const ghost = document.querySelector('.dashboard-order-ghost');
        expect(ghost).not.toBeNull();
        expect(ghost.style.height).toBe('90px');
        expect(ghost.querySelector('.dashboard-order-grip')).not.toBeNull();
        expect(ghost.textContent).toContain('A'.repeat(80));

        dispatchPointer(grip, 'pointercancel', { pointerId: 35, pointerType: 'mouse' });
        expect(document.querySelector('.dashboard-order-ghost')).toBeNull();
    });

    it('copies resolved node and GPU names into both drag ghosts', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { labelOverrides: [
                { kind: 'node', node: 'node-a', label: 'Compute' },
                { kind: 'gpu', node: 'node-a', gpu: '0', label: 'Training card' }
            ] }
        }));
        const api = loadSettingsModule();
        const group = addDashboardNode('node-a', ['0']);
        api.bindNodeLabel(group.querySelector('.node-label'), 'node-a');
        const card = group.querySelector('.overview-gpu-card');
        const title = document.createElement('h2');
        card.querySelector('.overview-gpu-name').appendChild(title);
        api.bindGpuLabel(title, 'node-a', '0');

        for (const [grip, pointerId] of [
            [group.querySelector(':scope > .dashboard-order-grip'), 61],
            [card.querySelector('.dashboard-order-grip'), 62]
        ]) {
            dispatchPointer(grip, 'pointerdown', {
                pointerId, pointerType: 'mouse', button: 0, clientX: 10, clientY: 10
            });
            dispatchPointer(grip, 'pointermove', {
                pointerId, pointerType: 'mouse', clientX: 30, clientY: 30
            });
            const ghost = document.querySelector('.dashboard-order-ghost');
            expect(ghost.textContent).toContain('Training card');
            if (pointerId === 61) expect(ghost.textContent).toContain('Compute');
            dispatchPointer(grip, 'pointercancel', { pointerId, pointerType: 'mouse' });
        }
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

describe('label override integration', () => {
    beforeEach(() => {
        setupDOM();
        localStorage.clear();
        global.registeredGPUs = new Set();
        global.charts = {};
        global.currentTab = 'overview';
        for (const key of Object.keys(chartData)) delete chartData[key];
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('keeps default labels with an older settings module', () => {
        window.GPUHotSettings = { settings: {} };

        expect(() => ensureGPUTab('0', { name: 'RTX 3090', utilization: 50 }, false))
            .not.toThrow();
        expect(document.querySelector('[data-view="gpu-0"]').textContent).toBe('0');
        expect(document.querySelector('[data-view="gpu-0"]').title).toBe('GPU 0');
        const card = document.getElementById('gpu-0');
        expect(card.querySelector('.gpu-detail-title').textContent).toBe('GPU 0');
        expect(card.querySelector('.gpu-detail-name').textContent).toBe('RTX 3090');
    });

    it('keeps upstream defaults with the current settings module and no overrides', () => {
        loadSettingsModule();

        ensureGPUTab('node-a-0', { name: 'RTX 3090', utilization: 50 }, {
            shouldUpdateDOM: false,
            nodeName: 'node-a',
            sourceGpuId: '0'
        });

        const button = document.querySelector('[data-view="gpu-node-a-0"]');
        const card = document.getElementById('gpu-node-a-0');
        expect(button.textContent).toBe('0');
        expect(button.title).toBe('GPU node-a-0');
        expect(card.querySelector('.gpu-detail-title').textContent).toBe('GPU 0 - node-a');
        expect(card.querySelector('.gpu-detail-name').textContent).toBe('RTX 3090');
    });

    it('adds the reported model to the detail title only while Show model is on', () => {
        const settings = loadSettingsModule();
        ensureGPUTab('node-a-0', { name: 'RTX 3090', utilization: 50 }, {
            shouldUpdateDOM: false, nodeName: 'node-a', sourceGpuId: '0'
        });
        const title = document.querySelector('#tab-gpu-node-a-0 .gpu-detail-title');
        updateProcesses([{ gpu_key: 'node-a-0', node_name: 'node-a', gpu_id: '0',
            name: 'llama-server', model: 'Qwen3.8-27B', memory: 100 }]);
        expect(title.textContent).toBe('GPU 0 - node-a');
        settings.settings['overview.showModel'] = true;
        settings.applyOverviewMetricVisibility(document);
        expect(title.textContent).toBe('GPU 0 - node-a - Qwen3.8-27B');
        expect(title.querySelector('.gpu-detail-model-separator').textContent).toBe(' - ');
        expect(title.querySelector('.gpu-detail-model-suffix').textContent).toBe('Qwen3.8-27B');
        expect(title.querySelectorAll('.gpu-detail-model-suffix wbr')).toHaveLength(2);
        updateProcesses([{ gpu_key: 'node-a-0', model: '/models/Next.gguf', memory: 100 }]);
        expect(title.textContent).toBe('GPU 0 - node-a - Next.gguf');
        updateProcesses([]);
        expect(title.textContent).toBe('GPU 0 - node-a');
        expect(title.querySelector('.gpu-detail-model-separator')).toBeNull();
        settings.settings['overview.showModel'] = false;
        settings.applyOverviewMetricVisibility(document);
        expect(title.querySelector('.gpu-detail-model-suffix')).toBeNull();
    });

    it('puts the GPU index before the displayed node name and process models', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({ version: 1, settings: {
            labelOverrides: [{ kind: 'node', node: 'inf1', label: 'INF1 - BLAZE' }],
            'overview.showModel': true
        } }));
        loadSettingsModule();
        ensureGPUTab('inf1-0', { name: 'AMD Radeon Pro V620', utilization: 99 }, {
            shouldUpdateDOM: false, nodeName: 'inf1', sourceGpuId: '0'
        });
        updateProcesses([
            { gpu_key: 'inf1-0', model: 'qwen38-q4', memory: 100 },
            { gpu_key: 'inf1-0', model: 'bonsai2-ternary', memory: 100 }
        ]);

        const title = document.querySelector('#tab-gpu-inf1-0 .gpu-detail-title');
        expect(title.textContent).toBe('GPU 0 - INF1 - BLAZE - qwen38-q4, bonsai2-ternary');
    });

    it('keeps a custom card name ahead of the model after a label refresh', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({ version: 1, settings: {
            labelOverrides: [{ kind: 'gpu', node: 'node-a', gpu: '0', label: 'Training card' }],
            'overview.showModel': true
        } }));
        const settings = loadSettingsModule();
        ensureGPUTab('node-a-0', { name: 'RTX 3090', utilization: 50 }, {
            shouldUpdateDOM: false, nodeName: 'node-a', sourceGpuId: '0'
        });
        updateProcesses([{ gpu_key: 'node-a-0', model: 'Qwen3.8-27B', memory: 100 }]);
        const title = document.querySelector('#tab-gpu-node-a-0 .gpu-detail-title');
        expect(title.textContent).toBe('Training card - Qwen3.8-27B');
        settings.applyDisplayLabels(document);
        expect(title.textContent).toBe('Training card - Qwen3.8-27B');
        updateSidebarLabels();
        expect(title.textContent).toBe('Training card - Qwen3.8-27B');
    });

    it('uses one saved GPU override for navigation and headings', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: {
                labelOverrides: [
                    { kind: 'gpu', node: 'node-a', gpu: '0', label: 'Training card' }
                ]
            }
        }));
        loadSettingsModule();

        ensureGPUTab('node-a-0', { name: 'RTX 3090', utilization: 50 }, {
            shouldUpdateDOM: false,
            nodeName: 'node-a',
            sourceGpuId: '0'
        });

        const button = document.querySelector('[data-view="gpu-node-a-0"]');
        const card = document.getElementById('gpu-node-a-0');
        expect(button.textContent).toBe('Training card');
        expect(button.title).toBe('Training card');
        expect(card.querySelector('.gpu-detail-title').textContent).toBe('Training card');
        expect(card.querySelector('.gpu-detail-name').textContent).toBe('RTX 3090');
    });

    it('uses a renamed node in the rail and detail title without changing GPU identity', () => {
        document.body.insertAdjacentHTML('beforeend',
            '<div id="settings-label-list"></div><p id="settings-status"></p>');
        const api = loadSettingsModule();
        api.settings.sidebarLabel = 'node-index';
        ensureGPUTab('node-a-0', { name: 'RTX 3090', utilization: 50 }, {
            shouldUpdateDOM: false,
            nodeName: 'node-a',
            sourceGpuId: '0'
        });
        const nodeLabel = document.createElement('span');
        document.body.append(nodeLabel);
        api.registerNodeLabelTarget('node-a');
        api.bindNodeLabel(nodeLabel, 'node-a');
        const nodeField = Array.from(document.querySelectorAll('.settings-label-field'))
            .find(field => JSON.parse(field.dataset.labelKey)[0] === 'node');
        const nodeInput = nodeField.querySelector('input');
        nodeInput.value = 'Compute';
        nodeInput.dispatchEvent(new Event('change'));

        const button = document.querySelector('[data-view="gpu-node-a-0"]');
        const detailTitle = document.querySelector('#tab-gpu-node-a-0 .gpu-detail-title');
        expect(nodeLabel.textContent).toBe('Compute');
        expect(button.textContent).toBe('Compute 0');
        expect(button.title).toContain('Compute-0');
        expect(detailTitle.textContent).toBe('GPU 0 - Compute');
        expect(button.dataset.gpuNode).toBe('node-a');
        expect(button.dataset.sourceGpuId).toBe('0');

        const gpuField = Array.from(document.querySelectorAll('.settings-label-field'))
            .find(field => JSON.parse(field.dataset.labelKey)[0] === 'gpu');
        const gpuInput = gpuField.querySelector('input');
        gpuInput.value = 'Training card';
        gpuInput.dispatchEvent(new Event('change'));
        api.settings.sidebarLabel = 'index';
        api.applySidebarSettings(document);
        expect(button.textContent).toBe('Training card');
        expect(detailTitle.textContent).toBe('Training card');

        loadSettingsModule();
        window.updateSidebarLabels();
        expect(button.textContent).toBe('Training card');
        expect(button.title).toBe('Training card');
    });

    it.each(['standard', 'comfortable', 'wide'])(
        'keeps all six live node-and-index labels complete at %s width', width => {
            const api = loadSettingsModule();
            api.settings.sidebarWidth = width;
            api.settings.sidebarLabel = 'node-index';
            api.applySidebarSettings(document);
            const liveGpus = [
                ['p4000-vm', '0'],
                ['inf2', '0'], ['inf2', '1'],
                ['inf1', '0'], ['inf1', '1'],
                ['truenas-a10m', '0']
            ];
            liveGpus.forEach(([nodeName, gpuId]) => addOrderedGpu(nodeName, gpuId));

            const buttons = Array.from(document.querySelectorAll('.sidebar-btn[data-gpu-id]'));
            expect(buttons.map(button => button.textContent)).toEqual(
                liveGpus.map(([nodeName, gpuId]) => `${nodeName} ${gpuId}`)
            );
            buttons.forEach(button => {
                expect(button.querySelector(':scope > .sidebar-btn-label')).not.toBeNull();
                expect(button.title).toContain(button.textContent);
            });
        }
    );

    it('keeps a long custom label available when the visible line count is capped', () => {
        const customLabel = 'A'.repeat(80);
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: {
                sidebarWidth: 'standard',
                labelOverrides: [{ kind: 'gpu', node: 'node-a', gpu: '0', label: customLabel }]
            }
        }));
        loadSettingsModule();
        const button = addOrderedGpu('node-a', '0');
        const style = document.createElement('style');
        style.textContent = layoutCss;
        document.head.appendChild(style);

        expect(button.querySelector('.sidebar-btn-label').textContent).toBe(customLabel);
        expect(button.title).toBe(customLabel);
        expect(getComputedStyle(button.querySelector('.sidebar-btn-label')).getPropertyValue('-webkit-line-clamp'))
            .toBe('3');
        expect(getComputedStyle(button.querySelector('.sidebar-btn-label')).overflowWrap).toBe('anywhere');
        expect(layoutCss).toMatch(/@media \(max-width: 768px\), \(max-height: 480px\) and \(orientation: landscape\)[\s\S]*?\.sidebar-btn \{\s*width: 40px;/);
        style.remove();
    });

    it('builds a detailed card without parsing its identity or model as HTML', () => {
        loadSettingsModule();
        const unsafeNode = '<img src=x onerror="window.__nodeXss=1">';
        const unsafeModel = '</span><img src=x onerror="window.__modelXss=1"><span>';
        const gpuId = `${unsafeNode}-0`;

        ensureGPUTab(gpuId, { name: unsafeModel, utilization: 50 }, {
            shouldUpdateDOM: false,
            nodeName: unsafeNode,
            sourceGpuId: '0'
        });

        const card = document.getElementById(`gpu-${gpuId}`);
        expect(card).not.toBeNull();
        expect(card.querySelectorAll('img')).toHaveLength(0);
        expect(card.querySelector('.gpu-detail-name').textContent).toBe(unsafeModel);
        expect(window.__nodeXss).toBeUndefined();
        expect(window.__modelXss).toBeUndefined();
    });

    it('renders a custom GPU label as text while keeping its stable identity', () => {
        const calls = [];
        const customLabel = '<img src=x onerror=alert(1)>';
        window.GPUHotSettings = {
            registerGpuLabelTarget(nodeName, gpuId) {
                calls.push([nodeName, String(gpuId)]);
            },
            bindGpuLabel(element, nodeName, gpuId, _fallback, output = 'text') {
                if (output === 'text' || output === 'both') element.textContent = customLabel;
                if (output === 'title' || output === 'both') element.title = customLabel;
                element.dataset.testIdentity = JSON.stringify([nodeName, String(gpuId)]);
            }
        };

        ensureGPUTab('node-a-0', { name: 'RTX 3090', utilization: 50 }, {
            shouldUpdateDOM: false,
            nodeName: 'node-a',
            sourceGpuId: '0'
        });

        const button = document.querySelector('[data-view="gpu-node-a-0"]');
        const title = document.querySelector('#tab-gpu-node-a-0 .gpu-detail-title');
        const model = document.querySelector('#tab-gpu-node-a-0 .gpu-detail-name');
        expect(button.textContent).toBe(customLabel);
        expect(button.title).toBe(customLabel);
        expect(button.querySelector('img')).toBeNull();
        expect(title.textContent).toBe(customLabel);
        expect(title.querySelector('img')).toBeNull();
        expect(model.textContent).toBe('RTX 3090');
        expect(model.querySelector('img')).toBeNull();
        expect(button.dataset.view).toBe('gpu-node-a-0');
        expect(button.dataset.testIdentity).toBe(JSON.stringify(['node-a', '0']));
        expect(calls).toEqual([['node-a', '0']]);
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
