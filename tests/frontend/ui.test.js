/**
 * Tests for static/js/ui.js
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

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

describe('switchToView', () => {
    beforeEach(() => {
        setupDOM();
        global.currentTab = 'overview';
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
        global.registeredGPUs = new Set();
        global.charts = {};
        window.GPUHotSettings = { settings: {} };
        for (const key of Object.keys(chartData)) {
            delete chartData[key];
        }
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
        ensureGPUTab('0', gpuInfo, false);

        const tab = document.getElementById('tab-gpu-0');
        expect(tab).not.toBeNull();
    });

    it('is idempotent — does not duplicate', () => {
        const gpuInfo = { name: 'RTX 3090', utilization: 50 };
        ensureGPUTab('0', gpuInfo, false);
        ensureGPUTab('0', gpuInfo, false);

        const buttons = document.querySelectorAll('[data-view="gpu-0"]');
        expect(buttons.length).toBe(1);
    });

    it('shows last segment for cluster IDs', () => {
        const gpuInfo = { name: 'RTX 3090', utilization: 50 };
        ensureGPUTab('server-2-0', gpuInfo, false);

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
        const bindGpuLabel = vi.fn((button, nodeName, gpuId, fallback) => {
            button.textContent = nodeName === 'node-a' && gpuId === '1'
                ? 'Training card'
                : fallback;
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
            1, button, 'node-a', '1', '1'
        );

        window.GPUHotSettings.settings.sidebarLabel = 'short-name';
        window.updateSidebarLabels();

        expect(button.textContent).toBe('Training card');
        expect(bindGpuLabel).toHaveBeenNthCalledWith(
            2, button, 'node-a', '1', 'RTX 4090'
        );
        expect(button.dataset.gpuNode).toBe('node-a');
        expect(button.dataset.sourceGpuId).toBe('1');
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
        ensureGPUTab('0', gpuInfo, false);
        removeGPUTab('0');

        expect(document.querySelector('[data-view="gpu-0"]')).toBeNull();
        expect(document.getElementById('tab-gpu-0')).toBeNull();
        expect(global.registeredGPUs.has('0')).toBe(false);
    });

    it('switches to overview if current tab removed', () => {
        const gpuInfo = { name: 'RTX 3090', utilization: 50 };
        ensureGPUTab('0', gpuInfo, false);
        global.currentTab = 'gpu-0';
        removeGPUTab('0');

        expect(global.currentTab).toBe('overview');
    });

    it('destroys charts', () => {
        const gpuInfo = { name: 'RTX 3090', utilization: 50 };
        ensureGPUTab('0', gpuInfo, false);

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
