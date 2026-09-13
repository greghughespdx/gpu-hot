import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const testDir = dirname(fileURLToPath(import.meta.url));
const demo = readFileSync(join(testDir, '../../docs/demo.html'), 'utf8');
const settings = readFileSync(join(testDir, '../../static/js/settings.js'), 'utf8');

function demoWindow(search = '') {
    const page = new JSDOM(demo, {
        url: `http://localhost/docs/demo.html${search}`,
        runScripts: 'outside-only'
    });
    const { window } = page;
    window.TextEncoder = TextEncoder;
    window.TextDecoder = TextDecoder;
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
        expect(window.GPUHotSettings.settings.labelOverrides).toHaveLength(2);
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

    it('generates four fresh nodes, an offline placeholder, model processes, and drifting metrics', () => {
        const { page, window, feed } = demoWindow();
        window.eval(feed.textContent);
        const first = window.GPUHotDemo.generateHubPayload(0);
        const later = window.GPUHotDemo.generateHubPayload(5);
        expect(first.mode).toBe('hub');
        expect(Object.values(first.nodes).filter(node => node.status === 'online')).toHaveLength(4);
        expect(first.nodes.inf1.gpus).toHaveProperty('0');
        expect(first.nodes.inf1.gpus).toHaveProperty('1');
        expect(first.nodes.inf2.gpus).toHaveProperty('0');
        expect(first.nodes.inf2.gpus).toHaveProperty('1');
        expect(first.nodes['http://offline-node.example.invalid:1313'].status).toBe('offline');
        expect(first.nodes.inf1.processes[0].model).toBe('qwen38-q4');
        expect(first.nodes.inf1.gpus['0'].throttle_reasons).toBe('HW Thermal');
        expect(first.nodes['p4000-vm'].gpus['0']).not.toHaveProperty('temperature_memory');
        expect(first.nodes.inf1.gpus['0'].utilization).not.toBe(later.nodes.inf1.gpus['0'].utilization);
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
});
