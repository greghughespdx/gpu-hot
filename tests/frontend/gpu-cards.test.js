/**
 * Tests for static/js/gpu-cards.js
 */

import { describe, it, expect, beforeEach } from 'vitest';

// Helper functions are loaded into global scope by setup.js

describe('formatMemory', () => {
    it('returns GB for values >= 1024', () => {
        expect(formatMemory(2048)).toBe('2.0');
    });

    it('returns MB for values < 1024', () => {
        expect(formatMemory(512)).toBe('512');
    });

    it('handles exactly 1024', () => {
        expect(formatMemory(1024)).toBe('1.0');
    });

    it('handles zero', () => {
        expect(formatMemory(0)).toBe('0');
    });

    it('handles fractional GB', () => {
        expect(formatMemory(1536)).toBe('1.5');
    });
});

describe('formatMemoryUnit', () => {
    it('returns GB for >= 1024', () => {
        expect(formatMemoryUnit(2048)).toBe('GB');
    });

    it('returns MB for < 1024', () => {
        expect(formatMemoryUnit(512)).toBe('MB');
    });

    it('returns GB for exactly 1024', () => {
        expect(formatMemoryUnit(1024)).toBe('GB');
    });
});

describe('formatEnergy', () => {
    it('returns Wh for small values', () => {
        expect(formatEnergy(500)).toBe('500.00Wh');
    });

    it('returns kWh for values >= 1000', () => {
        expect(formatEnergy(1500)).toBe('1.50kWh');
    });

    it('returns kWh for exactly 1000', () => {
        expect(formatEnergy(1000)).toBe('1.00kWh');
    });

    it('handles zero', () => {
        expect(formatEnergy(0)).toBe('0.00Wh');
    });
});

describe('getMetricValue', () => {
    it('returns value when key exists', () => {
        expect(getMetricValue({ temp: 72 }, 'temp')).toBe(72);
    });

    it('returns default when key missing', () => {
        expect(getMetricValue({}, 'temp')).toBe(0);
    });

    it('returns default when value is null', () => {
        expect(getMetricValue({ temp: null }, 'temp')).toBe(0);
    });

    it('returns default when value is undefined', () => {
        expect(getMetricValue({ temp: undefined }, 'temp')).toBe(0);
    });

    it('returns custom default', () => {
        expect(getMetricValue({}, 'temp', -1)).toBe(-1);
    });

    it('returns zero when value is zero', () => {
        expect(getMetricValue({ temp: 0 }, 'temp', 99)).toBe(0);
    });
});

describe('hasMetric', () => {
    it('returns true for numeric value', () => {
        expect(hasMetric({ temp: 72 }, 'temp')).toBe(true);
    });

    it('returns true for zero', () => {
        expect(hasMetric({ temp: 0 }, 'temp')).toBe(true);
    });

    it('returns false for N/A', () => {
        expect(hasMetric({ temp: 'N/A' }, 'temp')).toBe(false);
    });

    it('returns false for Unknown', () => {
        expect(hasMetric({ arch: 'Unknown' }, 'arch')).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(hasMetric({ name: '' }, 'name')).toBe(false);
    });

    it('returns false for null', () => {
        expect(hasMetric({ temp: null }, 'temp')).toBe(false);
    });

    it('returns false for undefined key', () => {
        expect(hasMetric({}, 'temp')).toBe(false);
    });
});

describe('bulletClass', () => {
    it('returns empty for normal value', () => {
        expect(bulletClass(50, 80, 95)).toBe('');
    });

    it('returns warning at warn threshold', () => {
        expect(bulletClass(80, 80, 95)).toBe('warning');
    });

    it('returns warning between thresholds', () => {
        expect(bulletClass(90, 80, 95)).toBe('warning');
    });

    it('returns danger at danger threshold', () => {
        expect(bulletClass(95, 80, 95)).toBe('danger');
    });

    it('returns danger above danger threshold', () => {
        expect(bulletClass(100, 80, 95)).toBe('danger');
    });
});

describe('createAggregateCard', () => {
    it('returns HTML with aggregate card structure', () => {
        const html = createAggregateCard();
        expect(html).toContain('aggregate-card');
        expect(html).toContain('Total VRAM');
        expect(html).toContain('agg-vram-value');
        expect(html).toContain('agg-vram-bar');
    });
});

describe('createEnhancedOverviewCard', () => {
    const gpuInfo = {
        name: 'NVIDIA RTX 3090',
        utilization: 75,
        temperature: 72,
        memory_used: 8192,
        memory_total: 24576,
        power_draw: 250,
        power_limit: 350,
        fan_speed: 65,
        clock_graphics: 1800,
        performance_state: 'P0',
        driver_version: '535.129.03',
        architecture: 'Ampere'
    };

    it('returns HTML with GPU name', () => {
        const html = createEnhancedOverviewCard('0', gpuInfo);
        expect(html).toContain('RTX 3090');
    });

    it('renders the AMD UUID shape without changing it', () => {
        const html = createEnhancedOverviewCard('amd-0', {
            ...gpuInfo,
            vendor: 'amd',
            uuid: 'AMD-0ca417d32a15d25d'
        });

        expect(html).toContain('AMD-0ca417d32a15d25d');
    });

    it('includes metric elements', () => {
        const html = createEnhancedOverviewCard('0', gpuInfo);
        expect(html).toContain('1800 MHz');
    });

    it('hides absent AMD fan and P-state metrics', () => {
        const html = createEnhancedOverviewCard('amd-0', {
            vendor: 'amd',
            name: 'AMD RADEON PRO V620 Azure',
            utilization: 99,
            temperature: 53,
            memory_used: 1024,
            memory_total: 2048,
            power_draw: 196,
            power_limit: 250,
            clock_graphics: 2494,
            clock_memory: 1000
        });

        expect(html).not.toContain('sgo-fan-amd-0');
        expect(html).not.toContain('sgo-fan-badge-amd-0');
        expect(html).not.toContain('sgo-pstate-amd-0');
        expect(html).not.toContain('sgo-pstate-badge-amd-0');
    });
});

describe('createGPUCard optional metrics', () => {
    it('hides absent AMD fan and P-state cards and charts', () => {
        const html = createGPUCard('amd-0', {
            vendor: 'amd',
            name: 'AMD RADEON PRO V620 Azure',
            utilization: 99,
            temperature: 53,
            memory_used: 1024,
            memory_total: 2048,
            power_draw: 196,
            power_limit: 250,
            clock_graphics: 2494,
            clock_memory: 1000
        });

        expect(html).not.toContain('fan-val-amd-0');
        expect(html).not.toContain('chart-fanSpeed-amd-0');
        expect(html).not.toContain('pstate-amd-0');
        expect(html).not.toContain('pstate-header-amd-0');
    });

    it('keeps NVIDIA fan and P-state metrics', () => {
        const html = createGPUCard('0', {
            vendor: 'nvidia',
            name: 'NVIDIA RTX 3090',
            utilization: 75,
            temperature: 72,
            memory_used: 8192,
            memory_total: 24576,
            power_draw: 250,
            power_limit: 350,
            fan_speed: 65,
            performance_state: 'P0'
        });

        expect(html).toContain('fan-val-0');
        expect(html).toContain('chart-fanSpeed-0');
        expect(html).toContain('pstate-header-0');
    });

    it('shows initial UNTHROTTLED status as GPU Idle', () => {
        const html = createGPUCard('amd-0', {
            vendor: 'amd',
            name: 'AMD RADEON PRO V620 Azure',
            utilization: 99,
            temperature: 53,
            memory_used: 1024,
            memory_total: 2048,
            power_draw: 196,
            power_limit: 250,
            throttle_reasons: 'UNTHROTTLED'
        });

        expect(html).toContain('GPU Idle');
        expect(html).not.toContain('UNTHROTTLED');
    });
});

describe('updateGPUDisplay optional metrics', () => {
    it('does not append absent AMD fan chart samples', () => {
        document.body.innerHTML = createGPUCard('amd-0', {
            vendor: 'amd',
            name: 'AMD RADEON PRO V620 Azure',
            utilization: 99,
            temperature: 53,
            memory_used: 1024,
            memory_total: 2048,
            power_draw: 196,
            power_limit: 250
        });
        initGPUData('amd-0', { fanSpeed: 42 });
        const fanData = chartData['amd-0'].fanSpeed;
        updateGPUDisplay('amd-0', {
            vendor: 'amd',
            utilization: 99,
            temperature: 53,
            memory_used: 1024,
            memory_total: 2048,
            power_draw: 196,
            power_limit: 250
        });
        expect(fanData.data[fanData.data.length - 1]).toBe(42);
    });

    it('does not overwrite existing fan or P-state elements when absent', () => {
        document.body.innerHTML = `
            <span id="fan-amd-0">Fan 42%</span>
            <span id="fan-val-amd-0">42</span>
            <span id="pstate-amd-0">P0</span>
            <span id="pstate-header-amd-0">P0</span>
        `;
        initGPUData('amd-0');

        updateGPUDisplay('amd-0', {
            vendor: 'amd',
            utilization: 99,
            temperature: 53,
            memory_used: 1024,
            memory_total: 2048,
            power_draw: 196,
            power_limit: 250
        });

        expect(document.getElementById('fan-amd-0').textContent).toBe('Fan 42%');
        expect(document.getElementById('fan-val-amd-0').textContent).toBe('42');
        expect(document.getElementById('pstate-amd-0').textContent).toBe('P0');
        expect(document.getElementById('pstate-header-amd-0').textContent).toBe('P0');
    });
});

describe('updateProcesses', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="processes-container"></div>
            <span id="process-count"></span>
        `;
    });

    it('renders processes', () => {
        const processes = [
            { name: 'python3', pid: '1234', memory: 4096, gpu_id: '0' },
            { name: 'blender', pid: '5678', memory: 2048, gpu_id: '0' }
        ];
        updateProcesses(processes);
        const container = document.getElementById('processes-container');
        expect(container.innerHTML).toContain('python3');
        expect(container.innerHTML).toContain('blender');
    });

    it('handles empty process list', () => {
        updateProcesses([]);
        const container = document.getElementById('processes-container');
        expect(container.innerHTML).toContain('No active GPU processes');
    });
});

describe('createCompactOverviewCard', () => {
    const gpuInfo = {
        name: 'NVIDIA RTX 3090',
        utilization: 75,
        temperature: 72,
        memory_used: 8192,
        memory_total: 24576,
        power_draw: 250,
        power_limit: 350,
    };

    it('returns HTML with GPU name', () => {
        const html = createCompactOverviewCard('0', gpuInfo);
        expect(html).toContain('RTX 3090');
    });

    it('includes overview-gpu-card class', () => {
        const html = createCompactOverviewCard('0', gpuInfo);
        expect(html).toContain('overview-gpu-card');
    });

    it('includes compact metric elements with overview- IDs', () => {
        const html = createCompactOverviewCard('0', gpuInfo);
        expect(html).toContain('overview-util-0');
        expect(html).toContain('overview-temp-0');
        expect(html).toContain('overview-mem-0');
        expect(html).toContain('overview-power-0');
    });

    it('shows utilization percentage', () => {
        const html = createCompactOverviewCard('0', gpuInfo);
        expect(html).toContain('75%');
    });

    it('shows temperature with degree symbol', () => {
        const html = createCompactOverviewCard('0', gpuInfo);
        expect(html).toContain('72°');
    });

    it('shows memory as percentage', () => {
        const html = createCompactOverviewCard('0', gpuInfo);
        // 8192/24576 = 33.3%
        expect(html).toContain('33%');
    });

    it('shows power in watts', () => {
        const html = createCompactOverviewCard('0', gpuInfo);
        expect(html).toContain('250W');
    });

    it('includes mini chart canvas', () => {
        const html = createCompactOverviewCard('0', gpuInfo);
        expect(html).toContain('overview-chart-0');
        expect(html).toContain('<canvas');
    });

    it('includes onclick to switch view', () => {
        const html = createCompactOverviewCard('2', gpuInfo);
        expect(html).toContain("switchToView('gpu-2')");
    });
});
