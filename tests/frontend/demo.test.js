import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const testDir = dirname(fileURLToPath(import.meta.url));
const demo = readFileSync(join(testDir, '../../docs/demo.html'), 'utf8');
const replayScript = readFileSync(join(testDir, '../../docs/demo-replay.js'), 'utf8');
const settings = readFileSync(join(testDir, '../../static/js/settings.js'), 'utf8');
const cards = readFileSync(join(testDir, '../../static/js/gpu-cards.js'), 'utf8');
const chartManager = readFileSync(join(testDir, '../../static/js/chart-manager.js'), 'utf8');

function demoWindow(search = '') {
    const page = new JSDOM(demo, {
        url: `http://localhost/docs/demo.html${search}`,
        runScripts: 'outside-only'
    });
    const { window } = page;
    window.TextEncoder = TextEncoder;
    window.TextDecoder = TextDecoder;
    window.Response = Response;
    window.fetch = async input => {
        const role = /demo-traces\/([a-z-]+)\.json$/.exec(String(input))?.[1];
        if (!role) return { ok: true, json: async () => ({}) };
        return { ok: true, json: async () => ({
            role,
            source: { power_limit: 300, clock_graphics_max: 2000,
                temp_idle: 35, temp_load: 80, memory_baseline: 12000 },
            samples: Array.from({ length: 80 }, (_, index) => {
                const util = role === 'idle-empty' || role === 'idle-model' ? 0 :
                    role === 'observer' ? index % 30 < 10 ? 96 : 2 : 80 + index % 10;
                return { util, mem_used: 12000 + index % 4, mem_total: 24576,
                    power: 40 + util * 2, temp: 35 + util * 0.4,
                    clock_graphics: 500 + util * 12, fan: 25 + util * 0.4 };
            })
        }) };
    };
    window.eval(replayScript);
    const inlineScripts = Array.from(window.document.querySelectorAll('script:not([src])'));
    const preset = inlineScripts.find(script => script.textContent.includes('demoPreset'));
    const feed = inlineScripts.find(script => script.textContent.includes('installDemoFeed'));
    return { page, window, preset, feed };
}

describe('static fork demo', () => {
    it('loads fork assets, applies the preset through settings before first paint, and cleans the URL', () => {
        const { page, window, preset } = demoWindow('?preset=features');
        expect(demo).toContain('src="../static/js/socket-handlers.js"');
        expect(demo).toContain('href="../static/css/components.css"');
        expect(demo).not.toContain('cdn.jsdelivr.net/gh/psalias2006/gpu-hot');
        expect(preset.compareDocumentPosition(window.document.querySelector('script[src="../static/js/settings.js"]'))
            & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        window.eval(preset.textContent);
        expect(window.location.search).toMatch(/setup=/);
        window.eval(settings);
        expect(window.location.search).toBe('');
        expect(window.GPUHotSettings.settings.theme).toBe('midnight');
        expect(window.GPUHotSettings.settings.overviewMiniChartWidth).toBe('behind');
        expect(window.GPUHotSettings.settings['overview.showModel']).toBe(true);
        expect(window.GPUHotSettings.settings.labelOverrides).toHaveLength(2);
        expect(demo).toContain('data-overview-display="showModel"');
        expect(cards).toContain("['process-model-heading', 'Model']");
        page.window.close();
    });

    it('keeps the author defaults in default mode', () => {
        const { page, window, preset } = demoWindow('?preset=default');
        window.eval(preset.textContent);
        window.eval(settings);
        expect(window.GPUHotSettings.settings.theme).toBe('default');
        expect(window.GPUHotSettings.settings['overview.fan-speed']).toBe(false);
        expect(window.location.search).toBe('');
        page.window.close();
    });

    it('switches demo presets without asking to replace saved settings', () => {
        const { page, window, preset } = demoWindow('?preset=default');
        window.localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1, settings: { theme: 'midnight' }
        }));
        window.localStorage.setItem('gpu-hot.notices.v1', 'old demo notices');
        window.confirm = () => { throw new Error('The demo should not ask for confirmation'); };

        window.eval(preset.textContent);
        expect(window.localStorage.getItem('gpu-hot.settings.v1')).toBeNull();
        expect(window.localStorage.getItem('gpu-hot.notices.v1')).toBeNull();
        window.eval(settings);
        expect(window.GPUHotSettings.settings.theme).toBe('default');
        page.window.close();
    });

    it('generates four fresh nodes, an offline placeholder, model processes, and drifting metrics', async () => {
        const { page, window, feed } = demoWindow();
        window.eval(feed.textContent);
        await window.GPUHotDemo.ready;
        const first = window.GPUHotDemo.generateHubPayload(0);
        const later = window.GPUHotDemo.generateHubPayload(5);
        expect(first.mode).toBe('hub');
        expect(Object.values(first.nodes).filter(node => node.status === 'online')).toHaveLength(5);
        expect(Object.values(later.nodes).filter(node => node.status === 'online')).toHaveLength(4);
        expect(first.nodes.inf1.gpus).toHaveProperty('0');
        expect(first.nodes.inf1.gpus).toHaveProperty('1');
        expect(first.nodes.inf2.gpus).toHaveProperty('0');
        expect(first.nodes.inf2.gpus).toHaveProperty('1');
        expect(first.nodes['http://compute-04.demo.invalid:1313'].status).toBe('online');
        expect(later.nodes['http://compute-04.demo.invalid:1313'].status).toBe('offline');
        expect(first.nodes.inf1.processes[0].model).toBe('qwen38-q4');
        expect(first.nodes['truenas-a10m'].processes[0].model).toBe('gpt-oss-32k:latest');
        expect(first.nodes.inf1.processes[1].model).toBe('Llama-3.3-70B-Instruct-Q4_K_M');
        expect(first.nodes.inf1.gpus['0'].throttle_reasons).toBe('HW Thermal');
        expect(first.nodes['p4000-vm'].gpus['0']).not.toHaveProperty('temperature_memory');
        expect(first.nodes.inf1.gpus['0'].utilization).not.toBe(later.nodes.inf1.gpus['0'].utilization);
        page.window.close();
    });

    it('uses recorded roles for busy, observer, idle and model-loading cards', async () => {
        const { page, window, feed } = demoWindow();
        window.eval(feed.textContent);
        await window.GPUHotDemo.ready;
        const first = window.GPUHotDemo.generateHubPayload(0).nodes;
        const later = window.GPUHotDemo.generateHubPayload(36).nodes;
        expect(first.inf1.gpus['0'].utilization).toBeGreaterThanOrEqual(80);
        expect(first.inf2.gpus['0'].utilization).toBe(0);
        expect(first['p4000-vm'].gpus['0'].utilization).toBe(0);
        expect(first.inf2.gpus['1'].memory_used).toBe(0);
        expect(later.inf2.gpus['1'].memory_used).toBeGreaterThan(17000);
        expect(later.inf2.processes.some(process => process.gpu_id === '1')).toBe(true);
        expect(first['truenas-a10m'].gpus['0'].fan_speed).toBe(0);
        expect(first.inf1.gpus['0'].fan_speed).toBeGreaterThan(0);
        page.window.close();
    });

    it('keeps every replayed card inside its board limits with credible model placement', async () => {
        const { page, window, feed } = demoWindow();
        window.eval(feed.textContent);
        await window.GPUHotDemo.ready;
        const expected = {
            'NVIDIA A10M': { memory: 24576, power: 150, graphics: 1695,
                memoryClock: 6251, pcie: 4, fan: false, temperature: [38, 77] },
            'NVIDIA RTX A6000': { memory: 49152, power: 300, graphics: 2100,
                memoryClock: 8001, pcie: 4, fan: true, temperature: [36, 78] },
            'NVIDIA RTX 4090': { memory: 24576, power: 450, graphics: 2520,
                memoryClock: 10501, pcie: 4, fan: true, temperature: [36, 80] },
            'AMD Radeon Pro V620': { memory: 32768, power: 300, graphics: 2200,
                memoryClock: 2000, pcie: 4, fan: false, temperature: [39, 80] },
            'NVIDIA Quadro P4000': { memory: 8192, power: 105, graphics: 1708,
                memoryClock: 3802, pcie: 3, fan: true, temperature: [36, 76] }
        };
        const allowedModels = new Set([
            'gpt-oss-32k:latest', 'qwen38-q4', 'Llama-3.3-70B-Instruct-Q4_K_M',
            'Qwen3.8-Flash-Next-Q4_K_M'
        ]);
        const payloads = new Map();

        for (let tick = 0; tick <= 200; tick += 1) {
            const payload = window.GPUHotDemo.generateHubPayload(tick);
            payloads.set(tick, payload);
            for (const node of Object.values(payload.nodes)) {
                if (node.status !== 'online') continue;
                for (const gpu of Object.values(node.gpus)) {
                    const spec = expected[gpu.name];
                    expect(spec, gpu.name).toBeDefined();
                    expect(gpu.memory_total).toBe(spec.memory);
                    expect(gpu.power_limit).toBe(spec.power);
                    expect(gpu.pcie_gen_max).toBe(spec.pcie);
                    expect(gpu.pcie_width_max).toBe(16);
                    expect(gpu.memory_used).toBeGreaterThanOrEqual(0);
                    expect(gpu.memory_used).toBeLessThanOrEqual(gpu.memory_total);
                    expect(gpu.memory_free).toBe(gpu.memory_total - gpu.memory_used);
                    expect(gpu.power_draw).toBeGreaterThanOrEqual(0);
                    expect(gpu.power_draw).toBeLessThanOrEqual(gpu.power_limit);
                    expect(gpu.clock_graphics).toBeLessThanOrEqual(spec.graphics);
                    expect(gpu.clock_sm).toBeLessThanOrEqual(spec.graphics);
                    expect(gpu.clock_sm_max).toBe(spec.graphics);
                    expect(gpu.clock_memory).toBeLessThanOrEqual(spec.memoryClock);
                    expect(gpu.temperature).toBeGreaterThanOrEqual(spec.temperature[0]);
                    expect(gpu.temperature).toBeLessThanOrEqual(spec.temperature[1]);
                    if (!spec.fan) {
                        expect(gpu.fan_speed).toBe(0);
                        expect(gpu.fan_rpm).toBe(0);
                    } else {
                        expect(gpu.fan_speed).toBeGreaterThan(0);
                        expect(gpu.fan_rpm).toBeGreaterThan(0);
                    }
                }
                for (const process of node.processes) {
                    expect(allowedModels.has(process.model)).toBe(true);
                    const gpu = node.gpus[process.gpu_id];
                    expect(process.memory).toBeLessThanOrEqual(gpu.memory_used);
                    if (process.model === 'Llama-3.3-70B-Instruct-Q4_K_M') {
                        expect(gpu.memory_total).toBeGreaterThanOrEqual(49152);
                        expect(process.memory).toBeGreaterThanOrEqual(35000);
                    }
                }
            }
        }
        const at = tick => payloads.get(tick).nodes;
        expect(at(0).inf1.gpus['1'].memory_used).toBeGreaterThan(40000);
        expect(at(0).inf2.gpus['0'].utilization).toBe(0);
        expect(at(35).inf2.gpus['1'].memory_used).toBe(0);
        expect(at(36).inf2.gpus['1'].memory_used).toBeGreaterThan(17000);
        expect(at(36).inf2.processes[1].model).toBe('Qwen3.8-Flash-Next-Q4_K_M');
        expect(at(36)['p4000-vm'].processes).toHaveLength(0);
        page.window.close();
    });

    it('delivers the generated frame through an in-page socket without a network connection', async () => {
        const { page, window, feed } = demoWindow();
        window.eval(feed.textContent);
        const socket = new window.WebSocket();
        const message = new Promise(resolve => { socket.onmessage = event => resolve(JSON.parse(event.data)); });
        const frame = await message;
        expect(socket.readyState).toBe(window.WebSocket.OPEN);
        expect(frame.mode).toBe('hub');
        expect(frame.nodes.inf1.processes[0].model).toBe('qwen38-q4');
        socket.close();
        expect(socket.readyState).toBe(window.WebSocket.CLOSED);
        page.window.close();
    });

    it('starts mini and detail charts with recorded history instead of a flat baseline', async () => {
        const { page, window, feed } = demoWindow();
        window.eval(`${chartManager}\n${feed.textContent}\nwindow.demoChartData = chartData;`);
        const socket = new window.WebSocket();
        await new Promise(resolve => { socket.onmessage = resolve; });
        const history = window.demoChartData['truenas-a10m-0'];
        expect(history.utilization.data).toHaveLength(240);
        expect(new Set(history.utilization.data).size).toBeGreaterThan(1);
        expect(history.temperature.data).toHaveLength(240);
        expect(history.clocks.graphicsData).toHaveLength(240);
        socket.close();
        page.window.close();
    });

    it('keeps the star-count request inside the demo', async () => {
        const { page, window, feed } = demoWindow();
        let networkCalls = 0;
        const fixtureFetch = window.fetch;
        window.fetch = async input => {
            if (String(input).startsWith('./demo-traces/')) return fixtureFetch(input);
            networkCalls += 1;
            throw new Error('Unexpected network request');
        };
        window.eval(feed.textContent);

        const response = await window.fetch('https://api.github.com/repos/psalias2006/gpu-hot');
        expect((await response.json()).stargazers_count).toBe(0);
        expect(networkCalls).toBe(0);
        page.window.close();
    });
});
