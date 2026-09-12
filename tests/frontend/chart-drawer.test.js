/**
 * Tests for static/js/chart-drawer.js
 *
 * chart-drawer.js registers DOMContentLoaded listeners on load,
 * so we load it after setting up jsdom with the required DOM elements.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath = join(__dirname, '../../static/js/chart-drawer.js');
const sourceCode = readFileSync(srcPath, 'utf-8');

/** Minimal DOM for the drawer */
function setupDrawerDOM() {
    document.body.innerHTML = `
        <div id="drawer-overlay"></div>
        <div id="chart-drawer">
            <button id="drawer-close"></button>
            <span id="drawer-title"></span>
            <span id="drawer-hero-value"></span>
            <span id="drawer-hero-unit"></span>
            <canvas id="drawer-chart-canvas"></canvas>
            <div id="drawer-companions"></div>
            <div id="drawer-stats"></div>
        </div>
    `;
}

/** Load chart-drawer.js into globalThis and fire DOMContentLoaded */
function loadChartDrawer() {
    setupDrawerDOM();

    const wrappedCode = `(function() { ${sourceCode}\n
        globalThis.COMPANION = COMPANION;
        globalThis.chartMeta = chartMeta;
        globalThis.companionMap = companionMap;
        globalThis.getPrimaryDataArray = getPrimaryDataArray;
        globalThis.fmtValue = fmtValue;
        globalThis.openChartDrawer = openChartDrawer;
        globalThis.closeChartDrawer = closeChartDrawer;
        globalThis.switchCompanion = switchCompanion;
        globalThis.renderCompanionChips = renderCompanionChips;
        globalThis.updateDrawerHero = updateDrawerHero;
        globalThis.updateDrawerChartData = updateDrawerChartData;
        globalThis.updateDrawerStats = updateDrawerStats;
        globalThis.drawerOpen = typeof drawerOpen !== 'undefined' ? drawerOpen : false;
        Object.defineProperty(globalThis, 'drawerOpen', {
            get() { return drawerOpen; },
            set(v) { drawerOpen = v; },
            configurable: true
        });
        Object.defineProperty(globalThis, 'drawerGpuId', {
            get() { return drawerGpuId; },
            set(v) { drawerGpuId = v; },
            configurable: true
        });
        Object.defineProperty(globalThis, 'drawerChartType', {
            get() { return drawerChartType; },
            set(v) { drawerChartType = v; },
            configurable: true
        });
        Object.defineProperty(globalThis, 'drawerCompanionType', {
            get() { return drawerCompanionType; },
            set(v) { drawerCompanionType = v; },
            configurable: true
        });
    })();`;
    vm.runInThisContext(wrappedCode, { filename: 'chart-drawer.js' });

    // Fire DOMContentLoaded to attach event listeners
    document.dispatchEvent(new Event('DOMContentLoaded'));
}

// ---------------------------------------------------------------------------
// chartMeta / companionMap — static data
// ---------------------------------------------------------------------------

describe('chartMeta', () => {
    beforeEach(() => loadChartDrawer());

    it('has metadata for all expected chart types', () => {
        const expected = [
            'utilization', 'temperature', 'memory', 'power', 'fanSpeed',
            'clocks', 'efficiency', 'pcie', 'appclocks', 'encoderDecoder',
            'systemCpu', 'systemMemory', 'systemSwap', 'systemNetIo',
            'systemDiskIo', 'systemLoadAvg',
        ];
        for (const key of expected) {
            expect(chartMeta[key]).toBeDefined();
            expect(chartMeta[key].title).toBeTruthy();
            expect(chartMeta[key].unit).toBeDefined();
        }
    });

    it('percentage types have yMax 100', () => {
        for (const key of ['utilization', 'memory', 'fanSpeed', 'encoderDecoder', 'systemCpu', 'systemMemory', 'systemSwap']) {
            expect(chartMeta[key].yMax).toBe(100);
        }
    });
});

describe('companionMap', () => {
    beforeEach(() => loadChartDrawer());

    it('has entries for every chartMeta key', () => {
        for (const key of Object.keys(chartMeta)) {
            expect(companionMap[key]).toBeDefined();
            expect(Array.isArray(companionMap[key])).toBe(true);
            expect(companionMap[key].length).toBeGreaterThan(0);
        }
    });

    it('companion entries reference valid chartMeta keys', () => {
        for (const [, companions] of Object.entries(companionMap)) {
            for (const c of companions) {
                expect(chartMeta[c]).toBeDefined();
            }
        }
    });
});

describe('COMPANION colors', () => {
    beforeEach(() => loadChartDrawer());

    it('reads the current companion token when the drawer is drawn', () => {
        document.documentElement.style.setProperty('--companion-rgb', '1, 2, 3');

        expect(COMPANION.line).toBe('rgba(1, 2, 3, 0.5)');
        expect(COMPANION.chipText).toBe('rgba(1, 2, 3, 0.8)');

        document.documentElement.style.removeProperty('--companion-rgb');
    });
});

// ---------------------------------------------------------------------------
// fmtValue
// ---------------------------------------------------------------------------

describe('fmtValue', () => {
    beforeEach(() => loadChartDrawer());

    it('formats with decimals', () => {
        expect(fmtValue(72.456, { decimals: 1, unit: '°C' })).toBe('72.5°C');
    });

    it('rounds to integer when decimals = 0', () => {
        expect(fmtValue(1799.7, { decimals: 0, unit: ' MHz' })).toBe('1800 MHz');
    });

    it('returns raw value when meta is null', () => {
        expect(fmtValue(42, null)).toBe(42);
    });
});

// ---------------------------------------------------------------------------
// getPrimaryDataArray
// ---------------------------------------------------------------------------

describe('getPrimaryDataArray', () => {
    beforeEach(() => {
        loadChartDrawer();
        // Clear and set up chart data
        for (const key of Object.keys(chartData)) delete chartData[key];
        initGPUData('gpu0', { utilization: 50, temperature: 60 });
    });

    it('returns .data for simple types', () => {
        const arr = getPrimaryDataArray('gpu0', 'utilization');
        expect(arr).toBe(chartData['gpu0'].utilization.data);
    });

    it('returns .graphicsData for clocks', () => {
        const arr = getPrimaryDataArray('gpu0', 'clocks');
        expect(arr).toBe(chartData['gpu0'].clocks.graphicsData);
    });

    it('returns .dataRX for pcie', () => {
        const arr = getPrimaryDataArray('gpu0', 'pcie');
        expect(arr).toBe(chartData['gpu0'].pcie.dataRX);
    });

    it('returns .dataEnc for encoderDecoder', () => {
        const arr = getPrimaryDataArray('gpu0', 'encoderDecoder');
        expect(arr).toBe(chartData['gpu0'].encoderDecoder.dataEnc);
    });

    it('returns .dataGr for appclocks', () => {
        const arr = getPrimaryDataArray('gpu0', 'appclocks');
        expect(arr).toBe(chartData['gpu0'].appclocks.dataGr);
    });

    it('returns .data1m for systemLoadAvg', () => {
        const arr = getPrimaryDataArray('gpu0', 'systemLoadAvg');
        expect(arr).toBe(chartData['gpu0'].systemLoadAvg.data1m);
    });

    it('returns null for unknown GPU', () => {
        expect(getPrimaryDataArray('nonexistent', 'utilization')).toBeNull();
    });

    it('returns null for unknown chart type', () => {
        expect(getPrimaryDataArray('gpu0', 'doesNotExist')).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// openChartDrawer / closeChartDrawer
// ---------------------------------------------------------------------------

describe('openChartDrawer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        loadChartDrawer();
        for (const key of Object.keys(chartData)) delete chartData[key];
        initGPUData('gpu0', { utilization: 75, temperature: 60 });
    });

    afterEach(() => {
        closeChartDrawer();
        vi.useRealTimers();
    });

    it('opens the drawer and sets state', () => {
        openChartDrawer('gpu0', 'utilization');
        expect(drawerOpen).toBe(true);
        expect(drawerGpuId).toBe('gpu0');
        expect(drawerChartType).toBe('utilization');
    });

    it('sets default companion from companionMap', () => {
        openChartDrawer('gpu0', 'utilization');
        expect(drawerCompanionType).toBe('temperature');
    });

    it('adds open class to overlay and drawer', () => {
        openChartDrawer('gpu0', 'utilization');
        expect(document.getElementById('drawer-overlay').classList.contains('open')).toBe(true);
        expect(document.getElementById('chart-drawer').classList.contains('open')).toBe(true);
    });

    it('sets drawer title', () => {
        openChartDrawer('gpu0', 'utilization');
        expect(document.getElementById('drawer-title').textContent).toBe('GPU Utilization');
    });

    it('does nothing for invalid chart type', () => {
        openChartDrawer('gpu0', 'fake');
        expect(drawerOpen).toBe(false);
    });

    it('does nothing when GPU has no chart data', () => {
        openChartDrawer('nonexistent', 'utilization');
        expect(drawerOpen).toBe(false);
    });
});

describe('closeChartDrawer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        loadChartDrawer();
        for (const key of Object.keys(chartData)) delete chartData[key];
        initGPUData('gpu0', { utilization: 50 });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('resets all drawer state', () => {
        openChartDrawer('gpu0', 'utilization');
        closeChartDrawer();
        expect(drawerOpen).toBe(false);
        expect(drawerGpuId).toBeNull();
        expect(drawerChartType).toBeNull();
        expect(drawerCompanionType).toBeNull();
    });

    it('removes open class from overlay and drawer', () => {
        openChartDrawer('gpu0', 'utilization');
        closeChartDrawer();
        expect(document.getElementById('drawer-overlay').classList.contains('open')).toBe(false);
        expect(document.getElementById('chart-drawer').classList.contains('open')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// switchCompanion
// ---------------------------------------------------------------------------

describe('switchCompanion', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        loadChartDrawer();
        for (const key of Object.keys(chartData)) delete chartData[key];
        initGPUData('gpu0', { utilization: 50, temperature: 60, power: 200 });
    });

    afterEach(() => {
        closeChartDrawer();
        vi.useRealTimers();
    });

    it('changes companion type', () => {
        openChartDrawer('gpu0', 'utilization');
        expect(drawerCompanionType).toBe('temperature');
        switchCompanion('power');
        expect(drawerCompanionType).toBe('power');
    });

    it('does nothing when drawer is not open', () => {
        switchCompanion('power');
        // Should not throw, drawerCompanionType stays null
        expect(drawerCompanionType).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// renderCompanionChips
// ---------------------------------------------------------------------------

describe('renderCompanionChips', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        loadChartDrawer();
        for (const key of Object.keys(chartData)) delete chartData[key];
        initGPUData('gpu0', { utilization: 50 });
    });

    afterEach(() => {
        closeChartDrawer();
        vi.useRealTimers();
    });

    it('renders chip buttons for companions', () => {
        openChartDrawer('gpu0', 'utilization');
        const container = document.getElementById('drawer-companions');
        const chips = container.querySelectorAll('.drawer-companion-chip');
        // utilization companions: temperature, power, memory, clocks
        expect(chips.length).toBe(4);
    });

    it('marks default companion as active', () => {
        openChartDrawer('gpu0', 'utilization');
        const container = document.getElementById('drawer-companions');
        const active = container.querySelector('.drawer-companion-chip.active');
        expect(active).not.toBeNull();
        expect(active.dataset.companion).toBe('temperature');
    });

    it('includes "Compare with" label', () => {
        openChartDrawer('gpu0', 'utilization');
        const container = document.getElementById('drawer-companions');
        expect(container.innerHTML).toContain('Compare with');
    });
});

// ---------------------------------------------------------------------------
// updateDrawerHero
// ---------------------------------------------------------------------------

describe('updateDrawerHero', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        loadChartDrawer();
        for (const key of Object.keys(chartData)) delete chartData[key];
        initGPUData('gpu0', { utilization: 75 });
    });

    afterEach(() => {
        closeChartDrawer();
        vi.useRealTimers();
    });

    it('shows last value from data array', () => {
        openChartDrawer('gpu0', 'utilization');
        // Push a known value
        updateChart('gpu0', 'utilization', 88);
        updateDrawerHero();
        const heroEl = document.getElementById('drawer-hero-value');
        expect(heroEl.textContent).toBe('88.0');
    });

    it('shows -- when no data', () => {
        // Open drawer with empty GPU data
        for (const key of Object.keys(chartData)) delete chartData[key];
        chartData['empty'] = { utilization: { data: [], labels: [] } };
        openChartDrawer('empty', 'utilization');
        // Manually clear and call
        chartData['empty'].utilization.data = [];
        updateDrawerHero();
        const heroEl = document.getElementById('drawer-hero-value');
        expect(heroEl.textContent).toBe('--');
    });
});

// ---------------------------------------------------------------------------
// updateDrawerStats
// ---------------------------------------------------------------------------

describe('updateDrawerStats', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        loadChartDrawer();
        for (const key of Object.keys(chartData)) delete chartData[key];
        initGPUData('gpu0', { utilization: 50, temperature: 60 });
    });

    afterEach(() => {
        closeChartDrawer();
        vi.useRealTimers();
    });

    it('renders primary stats', () => {
        openChartDrawer('gpu0', 'utilization');
        const container = document.getElementById('drawer-stats');
        expect(container.innerHTML).toContain('MIN');
        expect(container.innerHTML).toContain('MAX');
        expect(container.innerHTML).toContain('AVG');
        expect(container.innerHTML).toContain('GPU Utilization');
    });

    it('renders companion stats when companion is set', () => {
        openChartDrawer('gpu0', 'utilization');
        // Default companion is temperature
        const container = document.getElementById('drawer-stats');
        expect(container.innerHTML).toContain('Temperature');
        expect(container.querySelectorAll('.drawer-stats-group').length).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Event listeners (DOMContentLoaded wiring)
// ---------------------------------------------------------------------------

describe('event listeners', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        loadChartDrawer();
        for (const key of Object.keys(chartData)) delete chartData[key];
        initGPUData('gpu0', { utilization: 50 });
    });

    afterEach(() => {
        closeChartDrawer();
        vi.useRealTimers();
    });

    it('closes drawer on Escape key', () => {
        openChartDrawer('gpu0', 'utilization');
        expect(drawerOpen).toBe(true);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(drawerOpen).toBe(false);
    });

    it('closes drawer on overlay click', () => {
        openChartDrawer('gpu0', 'utilization');
        expect(drawerOpen).toBe(true);
        document.getElementById('drawer-overlay').click();
        expect(drawerOpen).toBe(false);
    });

    it('closes drawer on close button click', () => {
        openChartDrawer('gpu0', 'utilization');
        expect(drawerOpen).toBe(true);
        document.getElementById('drawer-close').click();
        expect(drawerOpen).toBe(false);
    });
});
