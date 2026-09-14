import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const testDir = dirname(fileURLToPath(import.meta.url));
const demo = readFileSync(join(testDir, '../../docs/demo.html'), 'utf8');
const settings = readFileSync(join(testDir, '../../static/js/settings.js'), 'utf8');
const cards = readFileSync(join(testDir, '../../static/js/gpu-cards.js'), 'utf8');

function demoWindow(search = '') {
    const page = new JSDOM(demo, {
        url: `http://localhost/docs/demo.html${search}`,
        runScripts: 'outside-only'
    });
    const { window } = page;
    window.TextEncoder = TextEncoder;
    window.TextDecoder = TextDecoder;
    window.Response = Response;
    window.fetch = async () => ({ ok: true, json: async () => ({}) });
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

    it('generates four fresh nodes, an offline placeholder, model processes, and drifting metrics', () => {
        const { page, window, feed } = demoWindow();
        window.eval(feed.textContent);
        const first = window.GPUHotDemo.generateHubPayload(0);
        const later = window.GPUHotDemo.generateHubPayload(5);
        expect(first.mode).toBe('hub');
        expect(Object.values(first.nodes).filter(node => node.status === 'online')).toHaveLength(5);
        expect(Object.values(later.nodes).filter(node => node.status === 'online')).toHaveLength(4);
        expect(first.nodes.inf1.gpus).toHaveProperty('0');
        expect(first.nodes.inf1.gpus).toHaveProperty('1');
        expect(first.nodes.inf2.gpus).toHaveProperty('0');
        expect(first.nodes.inf2.gpus).toHaveProperty('1');
        expect(first.nodes['http://offline-node.example.invalid:1313'].status).toBe('online');
        expect(later.nodes['http://offline-node.example.invalid:1313'].status).toBe('offline');
        expect(first.nodes.inf1.processes[0].model).toBe('qwen38-q4');
        expect(first.nodes.inf1.gpus['0'].throttle_reasons).toBe('HW Thermal');
        expect(first.nodes['p4000-vm'].gpus['0']).not.toHaveProperty('temperature_memory');
        expect(first.nodes.inf1.gpus['0'].utilization).not.toBe(later.nodes.inf1.gpus['0'].utilization);
        page.window.close();
    });

    it('generates distinct burst, sustained, idle, and model-loading traffic', () => {
        const { page, window, feed } = demoWindow();
        window.eval(feed.textContent);
        const at = second => window.GPUHotDemo.generateHubPayload(second * 2);
        const inference = second => at(second).nodes['truenas-a10m'].gpus['0'];
        expect(inference(3).utilization).toBeLessThan(5);
        expect(inference(17).utilization).toBeGreaterThanOrEqual(90);
        expect(inference(50).utilization).toBeLessThan(5);
        expect(at(15).nodes.inf1.gpus['0'].utilization).toBeGreaterThanOrEqual(90);
        expect(at(25).nodes.inf2.gpus['1'].utilization).toBeGreaterThanOrEqual(90);
        expect(at(15).nodes.inf2.gpus['0'].utilization).toBe(0);
        expect(at(15).nodes['p4000-vm'].gpus['0'].memory_used).toBe(6144);
        expect(at(17).nodes.inf2.gpus['1'].memory_used).toBe(0);
        expect(at(18).nodes.inf2.gpus['1'].memory_used).toBe(8192);
        expect(at(18).nodes.inf2.gpus['1'].utilization).toBeGreaterThan(90);
        expect(at(18).nodes.inf2.processes.some(process => process.gpu_id === '1')).toBe(true);
        expect(inference(10).power_draw).toBeLessThan(inference(12).power_draw);
        expect(inference(10).temperature).toBeLessThan(inference(16).temperature);
        expect(inference(10).fan_speed).toBeLessThan(inference(16).fan_speed);
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

    it('keeps the star-count request inside the demo', async () => {
        const { page, window, feed } = demoWindow();
        let networkCalls = 0;
        window.fetch = async () => { networkCalls += 1; throw new Error('Unexpected network request'); };
        window.eval(feed.textContent);

        const response = await window.fetch('https://api.github.com/repos/psalias2006/gpu-hot');
        expect((await response.json()).stargazers_count).toBe(0);
        expect(networkCalls).toBe(0);
        page.window.close();
    });
});
