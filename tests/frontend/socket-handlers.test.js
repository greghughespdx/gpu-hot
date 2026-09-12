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
        globalThis.attemptReconnect = attemptReconnect;
        globalThis.getClusterProcesses = getClusterProcesses;
        globalThis.handleClusterData = handleClusterData;
        globalThis.createClusterGPUCard = createClusterGPUCard;
        globalThis.processBatchedUpdates = processBatchedUpdates;
        globalThis.pendingSocketUpdates = pendingUpdates;
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

describe('getClusterProcesses', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => {
        vi.useRealTimers();
        global.clearInterval(global.reconnectInterval);
    });

    it('keeps one row per system and GPU binding', () => {
        loadSocketHandlers();
        const nodes = {
            'render-1': {
                status: 'online',
                processes: [
                    { name: 'worker', pid: '77', memory: 100, gpu_id: '0' },
                    { name: 'worker', pid: '77', memory: 120, gpu_id: '1' }
                ]
            },
            'render-2': {
                status: 'online',
                processes: [{ name: 'worker', pid: '77', memory: 200, gpu_id: '0' }]
            }
        };

        expect(getClusterProcesses(nodes)).toEqual([
            { name: 'worker', pid: '77', memory: 100, gpu_id: '0', node_name: 'render-1', gpu_key: 'render-1-0' },
            { name: 'worker', pid: '77', memory: 120, gpu_id: '1', node_name: 'render-1', gpu_key: 'render-1-1' },
            { name: 'worker', pid: '77', memory: 200, gpu_id: '0', node_name: 'render-2', gpu_key: 'render-2-0' }
        ]);
    });

    it('ignores offline nodes and accepts empty or missing process arrays', () => {
        loadSocketHandlers();
        expect(getClusterProcesses({
            offline: { status: 'offline', processes: [{ pid: '1', gpu_id: '0' }] },
            empty: { status: 'online', processes: [] },
            missing: { status: 'online' }
        })).toEqual([]);
    });

    it('clears stale process rows when every node is offline', () => {
        loadSocketHandlers();
        document.body.insertAdjacentHTML('beforeend', `
            <div id="overview-container"></div>
            <div id="processes-container"></div>
            <span id="process-count"></span>
        `);
        global.currentTab = 'overview';
        updateProcesses([{
            name: 'stale', pid: '1', memory: 100,
            node_name: 'render-1', gpu_key: 'render-1-0'
        }]);

        handleClusterData({
            nodes: {
                'render-1': { status: 'offline', processes: [{ pid: '1', gpu_id: '0' }] }
            }
        });
        vi.advanceTimersByTime(1);

        expect(document.querySelectorAll('.process-item')).toHaveLength(0);
        expect(document.getElementById('process-count').textContent).toBe('0');
    });
});

describe('handleSocketMessage', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => {
        vi.useRealTimers();
        global.clearInterval(global.reconnectInterval);
        vi.restoreAllMocks();
        delete globalThis.initOverviewMiniChart;
        delete globalThis.updateOverviewCard;
        delete globalThis.updateGPUSystemCharts;
    });

    it('binds single-node processes to the payload node and bare GPU id', () => {
        loadSocketHandlers();
        document.body.insertAdjacentHTML('beforeend', '<div id="overview-container"></div>');

        const animationFrames = [];
        vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => {
            animationFrames.push(callback);
            return animationFrames.length;
        });
        vi.spyOn(globalThis, 'createEnhancedOverviewCard').mockReturnValue(
            '<div data-gpu-id="0"></div>'
        );
        globalThis.initOverviewMiniChart = vi.fn();
        globalThis.updateOverviewCard = vi.fn();
        vi.spyOn(globalThis, 'ensureGPUTab').mockImplementation(() => {});
        globalThis.updateGPUSystemCharts = vi.fn();
        vi.spyOn(globalThis, 'autoSwitchSingleGPU').mockImplementation(() => {});
        const updateProcessesSpy = vi.spyOn(globalThis, 'updateProcesses')
            .mockImplementation(() => {});

        handleSocketMessage({
            data: JSON.stringify({
                node_name: 'render-1',
                gpus: {
                    '0': {
                        utilization: 25,
                        temperature: 50,
                        memory_used: 100,
                        memory_total: 1000,
                        power_draw: 40
                    }
                },
                processes: [{ name: 'worker', pid: '77', memory: 100, gpu_id: '0' }]
            })
        });
        animationFrames.shift()();

        expect(updateProcessesSpy).toHaveBeenCalledWith([{
            name: 'worker',
            pid: '77',
            memory: 100,
            gpu_id: '0',
            node_name: 'render-1',
            gpu_key: '0'
        }]);
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
        expect(status.style.color).toBe('rgb(245, 166, 35)');
    });
});

describe('handleSocketError', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => {
        vi.useRealTimers();
        global.clearInterval(global.reconnectInterval);
    });

    it('uses the danger token for the error state', () => {
        loadSocketHandlers();

        handleSocketError(new Error('test'));

        const status = document.getElementById('connection-status');
        expect(status.textContent).toBe('Error');
        expect(status.style.color).toBe('rgb(255, 68, 68)');
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
        expect(status.style.color).toBe('rgb(255, 68, 68)');
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

describe('createClusterGPUCard metric settings', () => {
    afterEach(() => { delete window.GPUHotSettings; });

    it('uses the same hidden columns for hub rows', () => {
        loadSocketHandlers();
        window.GPUHotSettings = {
            isOverviewMetricVisible: metric => metric !== 'power'
        };
        const html = createClusterGPUCard('node-a', '0', {
            name: 'GPU', utilization: 1, temperature: 2,
            memory_used: 3, memory_total: 4, power_draw: 5
        });

        expect(html).toContain('data-overview-metric="power" hidden');
        expect(html).not.toContain('data-overview-metric="temperature" hidden');
        expect(html).not.toContain('overview-chart-hidden');
    });
});

describe('sidebar order identity', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        loadSocketHandlers();
        document.body.innerHTML = `
            <div id="view-selector">
                <button class="sidebar-btn active" data-view="overview">Overview</button>
            </div>
            <div id="tab-overview" class="tab-content active"></div>
            <div id="overview-container"></div>
        `;
        global.registeredGPUs = new Set();
        global.currentTab = 'overview';
        window.GPUHotSettings = { settings: {}, saveSettings: vi.fn(() => true) };
        window.initializeSidebarOrdering(document);
        pendingSocketUpdates.clear();
    });
    afterEach(() => {
        vi.useRealTimers();
        global.clearInterval(global.reconnectInterval);
        vi.restoreAllMocks();
    });

    it('passes the node name and source GPU id to the sidebar button', () => {
        pendingSocketUpdates.set('node-a-0', {
            gpuInfo: { name: 'Test GPU' },
            systemInfo: null,
            sourceKey: 'node-a',
            nodeName: 'node-a',
            sourceGpuId: '0',
            shouldUpdateDOM: false,
            now: Date.now()
        });

        processBatchedUpdates();

        const button = document.querySelector('[data-view="gpu-node-a-0"]');
        expect(button.dataset.sidebarOrderKey).toBe(JSON.stringify(['node-a', '0']));
    });

    it('keeps the source identity when cluster data is queued for rendering', () => {
        const originalAnimationFrame = global.requestAnimationFrame;
        global.requestAnimationFrame = vi.fn();
        document.body.innerHTML = '<div id="overview-container"><div class="loading"></div></div>';
        try {
            handleClusterData({
                mode: 'hub',
                nodes: {
                    'node-a': {
                        status: 'online',
                        gpus: {
                            0: {
                                name: 'Test GPU', utilization: 25, temperature: 40,
                                memory_used: 10, memory_total: 100, power_draw: 20,
                                fan_speed: 30, clock_graphics: 100, clock_sm: 100,
                                clock_memory: 100, power_limit: 200
                            }
                        },
                        system: {},
                        processes: []
                    }
                }
            });

            expect(pendingSocketUpdates.get('node-a-0')).toMatchObject({
                nodeName: 'node-a',
                sourceGpuId: '0'
            });
        } finally {
            global.requestAnimationFrame = originalAnimationFrame;
        }
    });

    it('registers rendered node groups and GPU cards with the shared order model', () => {
        const originalAnimationFrame = global.requestAnimationFrame;
        global.requestAnimationFrame = vi.fn();
        window.initializeDashboardOrdering(document);
        try {
            handleClusterData({
                mode: 'hub',
                nodes: {
                    'node-a': {
                        status: 'online',
                        gpus: {
                            0: {
                                name: 'Test GPU', utilization: 25, temperature: 40,
                                memory_used: 10, memory_total: 100, power_draw: 20,
                                fan_speed: 30, clock_graphics: 100, clock_sm: 100,
                                clock_memory: 100, power_limit: 200
                            }
                        },
                        system: {},
                        processes: []
                    }
                }
            });

            const group = document.querySelector('.node-group');
            const card = group.querySelector('.overview-gpu-card');
            expect(group.dataset.layoutKind).toBe('node');
            expect(group.dataset.orderNode).toBe('node-a');
            expect(card.dataset.layoutKind).toBe('gpu');
            expect(card.dataset.layoutOrderKey).toBe(JSON.stringify(['node-a', '0']));
        } finally {
            global.requestAnimationFrame = originalAnimationFrame;
        }
    });

    it('keeps the node name and bare GPU id from a single-node payload', () => {
        const originalAnimationFrame = global.requestAnimationFrame;
        global.requestAnimationFrame = vi.fn();
        try {
            handleSocketMessage({
                data: JSON.stringify({
                    node_name: 'node-a',
                    gpus: {
                        0: {
                            name: 'Test GPU', utilization: 25, temperature: 40,
                            memory_used: 10, memory_total: 100, power_draw: 20,
                            fan_speed: 30, clock_graphics: 100, clock_sm: 100,
                            clock_memory: 100, power_limit: 200
                        }
                    },
                    system: {},
                    processes: []
                })
            });

            expect(pendingSocketUpdates.get('0')).toMatchObject({
                nodeName: 'node-a',
                sourceGpuId: '0'
            });
        } finally {
            global.requestAnimationFrame = originalAnimationFrame;
        }
    });

    it('uses the shared stable fallback when a single-node payload has no name', () => {
        const originalAnimationFrame = global.requestAnimationFrame;
        global.requestAnimationFrame = vi.fn();
        try {
            handleSocketMessage({
                data: JSON.stringify({
                    gpus: {
                        0: {
                            name: 'Test GPU', utilization: 25, temperature: 40,
                            memory_used: 10, memory_total: 100, power_draw: 20,
                            fan_speed: 30, clock_graphics: 100, clock_sm: 100,
                            clock_memory: 100, power_limit: 200
                        }
                    },
                    system: {},
                    processes: []
                })
            });

            expect(pendingSocketUpdates.get('0')).toMatchObject({
                nodeName: 'GPU Server',
                sourceGpuId: '0'
            });
        } finally {
            global.requestAnimationFrame = originalAnimationFrame;
        }
    });
});
