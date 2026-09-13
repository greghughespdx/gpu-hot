/**
 * Tests for static/js/gpu-cards.js
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const settingsSource = readFileSync(join(
    dirname(fileURLToPath(import.meta.url)), '../../static/js/settings.js'
), 'utf8');

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

    it('uses the numeric default when a collector metric is not numeric', () => {
        expect(getMetricValue({ temp: '<img src=x>' }, 'temp', 7)).toBe(7);
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

    it('includes metric elements', () => {
        const html = createEnhancedOverviewCard('0', gpuInfo);
        expect(html).toContain('1800 MHz');
    });
});

describe('updateProcesses', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="processes-container"></div>
            <span id="process-count"></span>
        `;
    });
    afterEach(() => { delete window.GPUHotSettings; });

    it('renders processes with their system names', () => {
        const processes = [
            { name: 'python3', pid: '1234', memory: 4096, gpu_id: '0', node_name: 'render-1', gpu_key: 'render-1-0' },
            { name: 'blender', pid: '5678', memory: 2048, gpu_id: '0', node_name: 'render-2', gpu_key: 'render-2-0' }
        ];
        updateProcesses(processes);
        const container = document.getElementById('processes-container');
        expect([...container.querySelectorAll('.process-name')].map(el => el.textContent)).toEqual(['python3', 'blender']);
        expect([...container.querySelectorAll('.process-system')].map(el => el.textContent)).toEqual(['render-1', 'render-2']);
    });

    it('keeps the process System name in sync with a node rename', () => {
        localStorage.clear();
        vm.runInThisContext(settingsSource, { filename: 'settings.js' });
        const api = window.GPUHotSettings;
        updateProcesses([{
            name: 'worker', pid: '17', memory: 512, node_name: 'render-1', gpu_key: 'render-1-0'
        }]);
        const system = document.querySelector('.process-system');
        expect(system.textContent).toBe('render-1');

        api.settings.labelOverrides = [{ kind: 'node', node: 'render-1', label: 'Compute' }];
        api.applyDisplayLabels(document);
        expect(system.textContent).toBe('Compute');
        expect(document.querySelector('.process-name').textContent).toBe('worker');
    });

    it('handles empty process list', () => {
        updateProcesses([]);
        const container = document.getElementById('processes-container');
        expect(container.textContent).toContain('No active GPU processes');
    });

    it('treats process and system names as text', () => {
        updateProcesses([{
            name: '<img src=x onerror=alert(1)>',
            pid: '1234',
            memory: 512,
            gpu_id: '0',
            node_name: '<b>render-1</b>',
            gpu_key: 'render-1-0'
        }]);

        const container = document.getElementById('processes-container');
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('b')).toBeNull();
        expect(container.querySelector('.process-name').textContent).toBe('<img src=x onerror=alert(1)>');
        expect(container.querySelector('.process-system').textContent).toBe('<b>render-1</b>');
    });

    it('filters a GPU page by both system and GPU id', () => {
        updateProcesses([
            { name: 'same-system-other-gpu', pid: '1', memory: 100, node_name: 'render-1', gpu_key: 'render-1-1' },
            { name: 'selected', pid: '2', memory: 200, node_name: 'render-1', gpu_key: 'render-1-0' },
            { name: 'same-gpu-other-system', pid: '3', memory: 300, node_name: 'render-2', gpu_key: 'render-2-0' }
        ]);

        renderProcessesForView('gpu-render-1-0');

        expect([...document.querySelectorAll('.process-name')].map(el => el.textContent)).toEqual(['selected']);
        expect(document.getElementById('process-count').textContent).toBe('1');
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
        expect(html).toContain('data-overview-visible-metrics="4"');
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

    it('marks hidden metric columns from browser settings', () => {
        window.GPUHotSettings = {
            isOverviewMetricVisible: metric => !['temperature', 'chart'].includes(metric),
            visibleOverviewMetricCount: () => 3
        };
        try {
            const html = createCompactOverviewCard('0', gpuInfo);

            expect(html).toContain('data-overview-metric="temperature" hidden');
            expect(html).toContain('data-overview-metric="chart" hidden');
            expect(html).toContain('overview-gpu-card overview-chart-hidden');
            expect(html).toContain('data-overview-visible-metrics="3"');
            expect(html).not.toContain('data-overview-metric="utilization" hidden');
        } finally {
            delete window.GPUHotSettings;
        }
    });

    it('includes onclick to switch view', () => {
        const html = createCompactOverviewCard('2', gpuInfo);
        expect(html).toContain("switchToView('gpu-2')");
    });
});

describe('opt-in All page metrics', () => {
    const extraMetricIds = [
        'fan-speed', 'graphics-clock', 'memory-clock', 'memory-used',
        'power-limit', 'memory-temperature', 'throttle-status', 'process-count',
        'pcie-generation', 'pcie-width', 'encoder-load', 'decoder-load',
        'performance-state'
    ];

    beforeEach(() => {
        document.body.innerHTML = '';
        window.GPUHotSettings = {
            isOverviewMetricVisible: metric => extraMetricIds.includes(metric)
                || ['utilization', 'temperature', 'memory', 'power', 'chart'].includes(metric),
            visibleOverviewMetricCount: () => 17
        };
    });

    it('does no recurring value work for extra metrics that are off', () => {
        window.GPUHotSettings.isOverviewMetricVisible = metric => metric === 'fan-speed';
        const card = gpuCardElementFromMarkup(createCompactOverviewCard, '0', {
            name: 'Test GPU', memory_total: 1, fan_speed: 60, clock_graphics: 1800
        });
        document.body.appendChild(card);

        const fan = card.querySelector('[data-overview-extra="fan-speed"]');
        const clock = card.querySelector('[data-overview-extra="graphics-clock"]');
        expect(fan.querySelector('.overview-metric-value').textContent).toBe('60%');
        expect(clock.querySelector('.overview-metric-value').textContent).toBe('Not reported');

        updateOverviewExtraMetrics(card, '0', { fan_speed: 70, clock_graphics: 1900 });

        expect(fan.querySelector('.overview-metric-value').textContent).toBe('70%');
        expect(clock.querySelector('.overview-metric-value').textContent).toBe('Not reported');
    });

    it('does not look up extra metric cells when every extra is off', () => {
        window.GPUHotSettings.isOverviewMetricVisible = () => false;
        const card = gpuCardElementFromMarkup(createCompactOverviewCard, '0', {
            name: 'Test GPU', memory_total: 1, fan_speed: 60
        });
        const originalQuerySelector = card.querySelector.bind(card);
        let lookupCount = 0;
        card.querySelector = (...args) => {
            lookupCount += 1;
            return originalQuerySelector(...args);
        };

        updateOverviewExtraMetrics(card, '0', { fan_speed: 70 });

        expect(lookupCount).toBe(0);
    });

    it('renders every selected payload metric as a card cell', () => {
        const card = gpuCardElementFromMarkup(createCompactOverviewCard, 'node-a-0', {
            name: 'Test GPU', utilization: 75, temperature: 62,
            memory_used: 8192, memory_total: 24576, power_draw: 250,
            fan_speed: 65, clock_graphics: 1800, clock_memory: 9000,
            power_limit: 350, temperature_memory: 72, throttle_reasons: 'HW Thermal',
            pcie_gen: 4, pcie_width: 16, encoder_utilization: 20,
            decoder_utilization: 10, performance_state: 'P0'
        }, { processCount: 3 });
        document.body.appendChild(card);

        const values = Object.fromEntries(extraMetricIds.map(metric => [
            metric,
            card.querySelector(`[data-overview-extra="${metric}"] .overview-metric-value`).textContent
        ]));
        expect(values).toEqual({
            'fan-speed': '65%',
            'graphics-clock': '1800 MHz',
            'memory-clock': '9000 MHz',
            'memory-used': '8.0 GB',
            'power-limit': '350 W',
            'memory-temperature': '72 C',
            'throttle-status': 'HW Thermal',
            'process-count': '3',
            'pcie-generation': 'Gen 4',
            'pcie-width': 'x16',
            'encoder-load': '20%',
            'decoder-load': '10%',
            'performance-state': 'P0'
        });
        expect(card.classList.contains('overview-has-extra-metrics')).toBe(true);
        expect(card.dataset.overviewVisibleMetrics).toBe('17');
    });

    it('uses text rendering for collector status and explains missing values', () => {
        const card = gpuCardElementFromMarkup(createCompactOverviewCard, '0', {
            name: 'Test GPU', memory_used: 0, memory_total: 1,
            throttle_reasons: '<img src=x onerror="window.__extraMetricXss=1">'
        });
        document.body.appendChild(card);

        const throttle = card.querySelector('[data-overview-extra="throttle-status"]');
        const fan = card.querySelector('[data-overview-extra="fan-speed"]');
        const memory = card.querySelector('[data-overview-extra="memory-used"]');
        expect(throttle.querySelector('.overview-metric-value').textContent)
            .toBe('<img src=x onerror="window.__extraMetricXss=1">');
        expect(throttle.querySelector('img')).toBeNull();
        expect(window.__extraMetricXss).toBeUndefined();
        expect(fan.querySelector('.overview-metric-value').textContent).toBe('Not reported');
        expect(memory.querySelector('.overview-metric-value').textContent).toBe('0.0 GB');

        updateOverviewExtraMetrics(card, '0', {
            fan_speed: null,
            memory_used: null
        }, { processCount: null });
        expect(fan.querySelector('.overview-metric-value').textContent).toBe('Not reported');
        expect(memory.querySelector('.overview-metric-value').textContent).toBe('Not reported');
        expect(card.querySelector('[data-overview-extra="process-count"] .overview-metric-value').textContent)
            .toBe('Not reported');
    });

    it('updates selected values without changing the metric structure', () => {
        const card = gpuCardElementFromMarkup(createCompactOverviewCard, '0', {
            name: 'Test GPU', memory_used: 1024, memory_total: 4096, fan_speed: 20
        }, { processCount: 1 });
        document.body.appendChild(card);
        const initialCells = card.querySelectorAll('[data-overview-extra]').length;

        updateOverviewExtraMetrics(document, '0', {
            fan_speed: 80, memory_used: 2048, performance_state: 'P2'
        }, { processCount: 4 });

        expect(card.querySelector('#overview-extra-fan-speed-0').textContent).toBe('80%');
        expect(card.querySelector('#overview-extra-memory-used-0').textContent).toBe('2.0 GB');
        expect(card.querySelector('#overview-extra-process-count-0').textContent).toBe('4');
        expect(card.querySelector('#overview-extra-performance-state-0').textContent).toBe('P2');
        expect(card.querySelectorAll('[data-overview-extra]')).toHaveLength(initialCells);
    });
});

describe('formatFanRpm', () => {
    it('formats a tachometer reading from an external fan controller', () => {
        expect(formatFanRpm({ fan_rpm: 3705 })).toBe('3705 RPM');
    });

    it('rounds a fractional reading', () => {
        expect(formatFanRpm({ fan_rpm: 3704.6 })).toBe('3705 RPM');
    });

    it('is empty when no fan controller is mapped', () => {
        expect(formatFanRpm({ fan_speed: 65 })).toBe('');
        expect(formatFanRpm({ fan_rpm: null })).toBe('');
        expect(formatFanRpm({})).toBe('');
    });
});

describe('fan RPM in the GPU card', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('renders the RPM sub-value when the payload has one', () => {
        document.body.innerHTML = createGPUCard('0', {
            name: 'Test GPU', fan_speed: 56.9, fan_rpm: 3705
        });
        const rpm = document.getElementById('fan-rpm-0');
        expect(rpm.textContent).toBe('3705 RPM');
        expect(rpm.hidden).toBe(false);
    });

    it('hides the RPM sub-value when the payload has none', () => {
        document.body.innerHTML = createGPUCard('0', {
            name: 'Test GPU', fan_speed: 65
        });
        const rpm = document.getElementById('fan-rpm-0');
        expect(rpm.textContent).toBe('');
        expect(rpm.hidden).toBe(true);
    });

    it('fills the RPM sub-value in on a later update', () => {
        document.body.innerHTML = createGPUCard('0', { name: 'Test GPU', fan_speed: 65 });
        updateGPUDisplay('0', { fan_speed: 56.9, fan_rpm: 3441 });
        const rpm = document.getElementById('fan-rpm-0');
        expect(rpm.textContent).toBe('3441 RPM');
        expect(rpm.hidden).toBe(false);
    });

    it('clears the RPM sub-value when the reading goes away', () => {
        document.body.innerHTML = createGPUCard('0', {
            name: 'Test GPU', fan_speed: 56.9, fan_rpm: 3441
        });
        updateGPUDisplay('0', { fan_speed: 65 });
        const rpm = document.getElementById('fan-rpm-0');
        expect(rpm.textContent).toBe('');
        expect(rpm.hidden).toBe(true);
    });
});

describe('collector text rendering', () => {
    const hostileText = '<img src=x onerror="window.__collectorTextExecuted=1">';
    const gpuInfo = {
        name: 'Test GPU',
        utilization: 1,
        temperature: 1,
        memory_used: 1,
        memory_total: 1024,
        power_draw: 1,
        power_limit: 100,
        fan_speed: 1
    };

    it.each([
        ['compact overview', 'uuid', createCompactOverviewCard],
        ['single-GPU overview', 'uuid', createEnhancedOverviewCard],
        ['single-GPU overview', 'performance_state', createEnhancedOverviewCard],
        ['single-GPU overview', 'driver_version', createEnhancedOverviewCard],
        ['single-GPU overview', 'architecture', createEnhancedOverviewCard],
        ['detail card', 'performance_state', createGPUCard],
        ['detail card', 'driver_version', createGPUCard],
        ['detail card', 'architecture', createGPUCard],
        ['detail card', 'throttle_reasons', createGPUCard]
    ])('%s renders hostile %s as text', (_cardType, field, markupFactory) => {
        const container = document.createElement('div');
        container.innerHTML = markupFactory('0', { ...gpuInfo, [field]: hostileText });

        expect(container.querySelector('img')).toBeNull();
        expect(container.textContent).toContain(hostileText);
        if (field === 'uuid') {
            expect(container.querySelector('[title]').title).toBe(hostileText);
        }
    });

    it('stays safe when the candidate binds the card identity and label', () => {
        const card = gpuCardElementFromMarkup(createCompactOverviewCard, 'node-a-0', {
            ...gpuInfo,
            name: 'Operator label',
            uuid: hostileText
        });

        expect(card.dataset.gpuId).toBe('node-a-0');
        expect(card.querySelector('.overview-gpu-name h2').textContent).toBe('GPU node-a-0');
        expect(card.querySelector('.overview-gpu-name p').textContent).toBe('Operator label');
        expect(card.querySelector('.gpu-uuid').textContent).toBe(hostileText);
        expect(card.querySelector('.gpu-uuid').title).toBe(hostileText);
        expect(card.querySelector('img')).toBeNull();
        expect(card.hasAttribute('onclick')).toBe(false);
    });

    it('keeps hostile numeric-looking fields out of candidate card markup', () => {
        const numericFields = [
            'pcie_gen', 'pcie_width', 'pcie_gen_max', 'pcie_width_max',
            'clock_sm_max', 'clock_graphics', 'clock_memory', 'clock_sm',
            'clock_video', 'memory_utilization', 'temperature_memory',
            'decoder_sessions', 'encoder_sessions', 'encoder_utilization',
            'decoder_utilization', 'memory_free', 'bar1_memory_used',
            'energy_consumption_wh', 'power_draw', 'power_limit',
            'memory_used', 'memory_total', 'utilization', 'temperature',
            'fan_speed'
        ];
        const hostileInfo = {
            ...gpuInfo,
            ...Object.fromEntries(numericFields.map(field => [field, hostileText])),
            brand: hostileText
        };
        const cards = [
            gpuCardElementFromMarkup(createCompactOverviewCard, '0', hostileInfo),
            gpuCardElementFromMarkup(createEnhancedOverviewCard, '0', hostileInfo),
            gpuCardElementFromMarkup(createGPUCard, '0', hostileInfo)
        ];

        cards.forEach(card => expect(card.querySelector('img')).toBeNull());
        expect(cards[1].querySelector('#sgo-clock-gr-0').textContent).toBe('Not reported MHz');
        expect(cards[2].querySelector('#clock-gr-0').textContent).toBe('Not reported');
        expect(cards[2].querySelector('#brand-0').textContent).toBe(hostileText);
        expect(cards[2].querySelector('#brand-0 img')).toBeNull();
    });

    it.each([
        ['object with a non-callable toString', JSON.parse('{"toString":"bad"}')],
        ['array', [12]],
        ['boolean', true],
        ['nested object', { value: { amount: 12 } }]
    ])('keeps candidate cards visible when numeric data is a %s', (_name, badValue) => {
        const data = {
            ...gpuInfo,
            utilization: badValue,
            memory_used: badValue,
            power_draw: badValue,
            fan_speed: badValue,
            clock_graphics: badValue,
            pcie_gen: badValue,
            energy_consumption_wh: badValue
        };
        const cards = [
            gpuCardElementFromMarkup(createCompactOverviewCard, '0', data),
            gpuCardElementFromMarkup(createEnhancedOverviewCard, '0', data),
            gpuCardElementFromMarkup(createGPUCard, '0', data)
        ];

        cards.forEach(card => expect(card).toBeInstanceOf(Element));
        expect(cards[1].textContent).toContain('Not reported');
        expect(cards[2].querySelector('#clock-gr-0').textContent).toBe('Not reported');
        expect(getMetricValue({ metric: badValue }, 'metric', 7)).toBe(7);
        expect(formatOverviewNumber(badValue)).toBe('Not reported');
        expect(formatOverviewMemoryGb(badValue)).toBe('Not reported');
        if (badValue !== true && !Array.isArray(badValue)) {
            expect(formatOverviewText(badValue)).toBe('Not reported');
        }
    });

    it('keeps a reported zero instead of treating it as missing', () => {
        const card = gpuCardElementFromMarkup(createGPUCard, '0', {
            ...gpuInfo, pcie_gen: 0, pcie_width: 0
        });

        expect(card.querySelector('#pcie-0').textContent).toBe('Gen 0');
        expect(card.querySelector('#pcie-0').closest('.metric-cell').querySelector('.metric-sub').textContent)
            .toBe('x0 lanes');
    });

    it('does not stringify an object inside a throttle detail array', () => {
        expect(formatOverviewText([JSON.parse('{"toString":"bad"}')]))
            .toBe('Not reported');
    });
});
