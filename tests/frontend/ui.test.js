/**
 * Tests for static/js/ui.js
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const testDir = dirname(fileURLToPath(import.meta.url));
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
    `;
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
        localStorage.clear();
        global.registeredGPUs = new Set();
        global.charts = {};
        delete window.GPUHotSettings;
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

    it('keeps default labels with an older settings module', () => {
        window.GPUHotSettings = { settings: {} };

        expect(() => ensureGPUTab('0', { name: 'RTX 3090', utilization: 50 }, false))
            .not.toThrow();
        expect(document.querySelector('[data-view="gpu-0"]').textContent).toBe('0');
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
        expect(card.querySelector('.gpu-detail-title').textContent).toBe('GPU node-a-0');
        expect(card.querySelector('.gpu-detail-name').textContent).toBe('RTX 3090');
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
