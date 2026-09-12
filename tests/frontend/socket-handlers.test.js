/**
 * Tests for static/js/socket-handlers.js
 *
 * This file auto-executes connectWebSocket() on load, so we must
 * mock WebSocket and DOM elements BEFORE loading it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath = join(__dirname, '../../static/js/socket-handlers.js');
const sourceCode = readFileSync(srcPath, 'utf-8');
const defaultSwitchToView = globalThis.switchToView;

function loadSocketHandlers(locationOverride) {
    // Reset globals that socket-handlers.js defines
    globalThis.socket = null;
    globalThis.reconnectInterval = null;
    globalThis.reconnectAttempts = 0;

    // Mock WebSocket constructor
    const mockInstances = [];
    globalThis.WebSocket = class MockWebSocket {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;

        constructor(url) {
            this.url = url;
            this.readyState = MockWebSocket.CONNECTING;
            this.onopen = null;
            this.onmessage = null;
            this.onclose = null;
            this.onerror = null;
            mockInstances.push(this);
        }
        send() {}
        close() { this.readyState = MockWebSocket.CLOSED; }
    };
    globalThis.WebSocket.CONNECTING = 0;
    globalThis.WebSocket.OPEN = 1;

    // Mock DOM elements
    document.body.innerHTML = `
        <span id="connection-status">Disconnected</span>
        <span id="status-dot"></span>
    `;

    const defaultLoc = { protocol: 'http:', host: 'localhost:1312', reload: vi.fn() };
    const loc = { ...defaultLoc, ...locationOverride };
    if (!locationOverride?.reload) loc.reload = vi.fn();
    Object.defineProperty(window, 'location', {
        value: loc,
        writable: true,
        configurable: true
    });

    // Load the source and export to globalThis
    const wrappedCode = `(function() { ${sourceCode}\n
        globalThis.socket = socket;
        globalThis.reconnectInterval = reconnectInterval;
        Object.defineProperty(globalThis, 'reconnectAttempts', {
            get() { return reconnectAttempts; },
            set(v) { reconnectAttempts = v; },
            configurable: true
        });
        globalThis.createWebSocketConnection = createWebSocketConnection;
        globalThis.connectWebSocket = connectWebSocket;
        globalThis.setupWebSocketHandlers = setupWebSocketHandlers;
        globalThis.handleSocketOpen = handleSocketOpen;
        globalThis.handleSocketClose = handleSocketClose;
        globalThis.handleSocketError = handleSocketError;
        globalThis.handleSocketMessage = handleSocketMessage;
        globalThis.handleClusterData = handleClusterData;
        globalThis.processBatchedUpdates = processBatchedUpdates;
        globalThis.pendingSocketUpdates = pendingUpdates;
        globalThis.createClusterGPUCard = createClusterGPUCard;
        globalThis.createNodeGroup = createNodeGroup;
        globalThis.findDataElement = findDataElement;
        globalThis.attemptReconnect = attemptReconnect;
        globalThis.MAX_RECONNECT_ATTEMPTS = MAX_RECONNECT_ATTEMPTS;
        globalThis.RECONNECT_DELAY = RECONNECT_DELAY;
    })();`;
    vm.runInThisContext(wrappedCode, { filename: 'socket-handlers.js' });

    return mockInstances;
}

describe('createWebSocketConnection', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        global.clearInterval(global.reconnectInterval);
    });

    it('uses ws: protocol for http', () => {
        const instances = loadSocketHandlers({
            protocol: 'http:',
            host: 'localhost:1312'
        });
        expect(instances.length).toBeGreaterThan(0);
        expect(instances[0].url).toBe('ws://localhost:1312/socket.io/');
    });

    it('uses wss: protocol for https', () => {
        const instances = loadSocketHandlers({
            protocol: 'https:',
            host: 'secure.example.com'
        });
        expect(instances[0].url).toBe('wss://secure.example.com/socket.io/');
    });
});

describe('handleSocketOpen', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => {
        vi.useRealTimers();
        global.clearInterval(global.reconnectInterval);
    });

    it('resets reconnect attempts', () => {
        loadSocketHandlers();
        global.reconnectAttempts = 5;
        // Simulate open
        handleSocketOpen();
        expect(global.reconnectAttempts).toBe(0);
    });

    it('updates status text', () => {
        loadSocketHandlers();
        handleSocketOpen();
        const status = document.getElementById('connection-status');
        expect(status.textContent).toBe('Connected');
    });
});

describe('handleSocketClose', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => {
        vi.useRealTimers();
        global.clearInterval(global.reconnectInterval);
    });

    it('updates status to reconnecting', () => {
        loadSocketHandlers();
        handleSocketClose();
        const status = document.getElementById('connection-status');
        expect(status.textContent).toBe('Reconnecting...');
    });
});

describe('attemptReconnect', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => {
        vi.useRealTimers();
        global.clearInterval(global.reconnectInterval);
    });

    it('stops after max attempts', () => {
        loadSocketHandlers();
        global.reconnectAttempts = 0;
        global.reconnectInterval = null;

        attemptReconnect();
        // Advance time to exhaust all 10 attempts
        for (let i = 0; i < 11; i++) {
            vi.advanceTimersByTime(2000);
        }

        const status = document.getElementById('connection-status');
        expect(status.textContent).toBe('Disconnected');
    });

    it('does not duplicate reconnect intervals', () => {
        loadSocketHandlers();
        global.reconnectInterval = null;
        attemptReconnect();
        const first = global.reconnectInterval;
        attemptReconnect(); // Should be a no-op
        expect(global.reconnectInterval).toBe(first);
    });
});

describe('safe node labels', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        loadSocketHandlers();
        window.GPUHotSettings = {
            registerNodeLabelTarget: vi.fn(),
            registerGpuLabelTarget: vi.fn(),
            bindNodeLabel: vi.fn((element, nodeName) => {
                element.textContent = `Label for ${nodeName}`;
            }),
            bindGpuLabel: vi.fn(element => {
                element.textContent = '<b>GPU label</b>';
            })
        };
        global.requestAnimationFrame = vi.fn();
        global.initOverviewMiniChart = vi.fn();
        global.initAggregateChart = vi.fn();
    });
    afterEach(() => {
        vi.useRealTimers();
        global.clearInterval(global.reconnectInterval);
        global.switchToView = defaultSwitchToView;
        vi.restoreAllMocks();
    });

    it('creates a node group without parsing its identity or label as HTML', () => {
        const container = document.createElement('div');
        const nodeName = 'node-a\" data-extra=\"bad"><img src=x>';

        const group = createNodeGroup(container, nodeName, nodeName);

        expect(group.dataset.node).toBe(nodeName);
        expect(group.querySelector('.node-label').textContent).toBe(`Label for ${nodeName}`);
        expect(group.querySelector('img')).toBeNull();
        expect(findDataElement(container, '.node-group', 'node', nodeName)).toBe(group);
        expect(window.GPUHotSettings.registerNodeLabelTarget).toHaveBeenCalledWith(nodeName);
    });

    it('contains no HTML interpolation for node group labels or data attributes', () => {
        expect(sourceCode).not.toMatch(/class="node-label">\$\{(?:hostname|nodeName)\}/);
        expect(sourceCode).not.toMatch(/data-node="\$\{nodeName\}"/);
        expect(sourceCode).not.toMatch(/onclick="switchToView\('gpu-\$\{fullGpuId\}'\)"/);
    });

    it('builds a cluster card without parsing its node identity or model as HTML', () => {
        const nodeName = '<img src=x onerror="window.__nodeXss=1">';
        const modelName = '</p><img src=x onerror="window.__modelXss=1"><p>';
        global.switchToView = vi.fn();
        delete window.__nodeXss;
        delete window.__modelXss;

        const card = createClusterGPUCard(nodeName, '0', {
            name: modelName,
            utilization: 20,
            temperature: 40,
            memory_used: 10,
            memory_total: 100,
            power_draw: 30
        });
        document.body.appendChild(card);
        card.click();

        expect(card.dataset.gpuId).toBe(`${nodeName}-0`);
        expect(card.hasAttribute('onclick')).toBe(false);
        expect(card.querySelector('.overview-gpu-name p').textContent).toBe(modelName);
        expect(card.querySelectorAll('img')).toHaveLength(0);
        expect(window.__nodeXss).toBeUndefined();
        expect(window.__modelXss).toBeUndefined();
        expect(global.switchToView).toHaveBeenCalledWith(`gpu-${nodeName}-0`);
    });

    it('keeps the default node label if settings are unavailable', () => {
        const container = document.createElement('div');
        delete window.GPUHotSettings;
        const nodeName = '<img src=x onerror=alert(1)>';

        const group = createNodeGroup(container, 'node-a', nodeName);

        expect(group.querySelector('.node-label').textContent).toBe(nodeName);
        expect(group.querySelector('img')).toBeNull();
    });

    it('uses the safe label path for a multi-GPU single-node payload', () => {
        document.body.innerHTML = '<div id="overview-container"><div class="loading"></div></div>';
        const nodeName = 'node-a\" data-extra=\"bad"><img src=x>';
        const gpu = {
            name: 'Test GPU', utilization: 20, temperature: 40,
            memory_used: 10, memory_total: 100, power_draw: 30,
            fan_speed: 50, clock_graphics: 100, clock_sm: 100,
            clock_memory: 100, power_limit: 200
        };

        handleSocketMessage({
            data: JSON.stringify({ node_name: nodeName, gpus: { 0: gpu, 1: gpu }, system: {} })
        });

        const group = document.querySelector('.node-group');
        const titles = group.querySelectorAll('.overview-gpu-name h2');
        const models = group.querySelectorAll('.overview-gpu-name p');
        expect(group.dataset.node).toBe('_local');
        expect(group.querySelector('.node-label').textContent).toBe(`Label for ${nodeName}`);
        expect(group.querySelectorAll('img')).toHaveLength(0);
        expect(Array.from(titles, title => title.textContent)).toEqual([
            '<b>GPU label</b>', '<b>GPU label</b>'
        ]);
        expect(Array.from(models, model => model.textContent)).toEqual([
            'Test GPU', 'Test GPU'
        ]);
        expect(window.GPUHotSettings.registerGpuLabelTarget)
            .toHaveBeenCalledWith(nodeName, '0');
        expect(window.GPUHotSettings.registerGpuLabelTarget)
            .toHaveBeenCalledWith(nodeName, '1');
    });

    it('offers a node label for a single-GPU server without a node heading', () => {
        document.body.innerHTML = '<div id="overview-container"><div class="loading"></div></div>';
        const gpu = {
            name: 'Test GPU', utilization: 20, temperature: 40,
            memory_used: 10, memory_total: 100, power_draw: 30,
            fan_speed: 50, clock_graphics: 100, clock_sm: 100,
            clock_memory: 100, power_limit: 200
        };

        handleSocketMessage({
            data: JSON.stringify({ node_name: 'node-a', gpus: { 0: gpu }, system: {} })
        });

        expect(window.GPUHotSettings.registerNodeLabelTarget).toHaveBeenCalledWith('node-a');
        expect(document.querySelector('.node-label')).toBeNull();
    });

    it('uses one visible fallback identity when a node name is absent', () => {
        document.body.innerHTML = '<div id="overview-container"><div class="loading"></div></div>';
        const gpu = {
            name: 'Test GPU', utilization: 20, temperature: 40,
            memory_used: 10, memory_total: 100, power_draw: 30,
            fan_speed: 50, clock_graphics: 100, clock_sm: 100,
            clock_memory: 100, power_limit: 200
        };

        handleSocketMessage({
            data: JSON.stringify({ gpus: { 0: gpu, 1: gpu }, system: {} })
        });

        expect(document.querySelector('.node-group .node-label').textContent)
            .toBe('Label for GPU Server');
        expect(window.GPUHotSettings.registerNodeLabelTarget)
            .toHaveBeenCalledWith('GPU Server');
        expect(window.GPUHotSettings.registerGpuLabelTarget)
            .toHaveBeenCalledWith('GPU Server', '0');
        expect(window.GPUHotSettings.registerGpuLabelTarget)
            .toHaveBeenCalledWith('GPU Server', '1');
        expect(window.GPUHotSettings.registerNodeLabelTarget)
            .not.toHaveBeenCalledWith('_local');
    });
});
