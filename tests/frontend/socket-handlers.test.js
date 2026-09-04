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
        globalThis.attemptReconnect = attemptReconnect;
        globalThis.getInitialChartValues = getInitialChartValues;
        globalThis.handleSocketMessage = handleSocketMessage;
        globalThis.updateAllChartDataOnly = updateAllChartDataOnly;
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

describe('getInitialChartValues', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        loadSocketHandlers();
        for (const key of Object.keys(chartData)) {
            delete chartData[key];
        }
    });

    afterEach(() => {
        vi.useRealTimers();
        global.clearInterval(global.reconnectInterval);
    });

    it('does not seed an absent fan metric into chart initialization', () => {
        const values = getInitialChartValues({
            vendor: 'amd',
            memory_used: 1,
            memory_total: 2,
            power_draw: 3
        });

        expect(values).not.toHaveProperty('fanSpeed');
    });

    it('preserves a real zero fan metric', () => {
        const values = getInitialChartValues({
            vendor: 'nvidia',
            memory_used: 1,
            memory_total: 2,
            power_draw: 3,
            fan_speed: 0
        });

        expect(values.fanSpeed).toBe(0);
    });

    it('does not add an absent fan metric during socket chart updates', () => {
        initGPUData('amd-0', { fanSpeed: 42 });
        const fanData = chartData['amd-0'].fanSpeed;
        const before = fanData.data.length;

        updateAllChartDataOnly('amd-0', {
            memory_used: 1,
            memory_total: 2,
            power_draw: 3,
            utilization: 4,
            temperature: 5
        });

        expect(fanData.data.length).toBe(before);
        expect(fanData.data[fanData.data.length - 1]).toBe(42);
    });
});
