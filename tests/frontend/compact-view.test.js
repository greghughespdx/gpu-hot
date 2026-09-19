/** Tests for the isolated compact GPU embed view. */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '../..');
const html = readFileSync(join(root, 'templates/compact.html'), 'utf-8');
const source = readFileSync(join(root, 'static/js/compact-view.js'), 'utf-8');

describe('compact GPU view', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = `
            <main><span id="connection-state"></span>
            <section id="gpu-list" aria-busy="true"><p>Loading GPU activity.</p></section></main>`;
        globalThis.fetch = vi.fn();
        vm.runInThisContext(source, { filename: 'compact-view.js' });
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        delete globalThis.GpuHotCompactView;
    });

    it('uses only local, read-only assets without dashboard controls', () => {
        expect(html).toContain('/static/css/compact.css');
        expect(html).toContain('/static/js/compact-view.js');
        expect(html).not.toMatch(/https?:\/\//);
        expect(html).not.toMatch(/<(button|nav|form|a)\b/i);
        expect(html).not.toMatch(/process/i);
        expect(source).toContain("fetch('/api/gpu-data'");
        expect(source).not.toContain('innerHTML');
        expect(source).not.toContain('outerHTML');
    });

    it('renders two fixed GPU labels and clamps malformed values safely', () => {
        const view = globalThis.GpuHotCompactView;
        view.render(view.localGpus({
            gpus: {
                '0': { utilization: '<img src=x>', memory_used: 'bad', memory_total: Infinity },
                '1': { utilization: 42.9, memory_used: 2048, memory_total: 4096 },
                '2': { utilization: 99, memory_used: 1, memory_total: 2 }
            }
        }));

        const cards = document.querySelectorAll('.gpu-card');
        expect(cards).toHaveLength(2);
        expect(cards[0].querySelector('h2').textContent).toBe('GPU 1');
        expect(cards[1].querySelector('h2').textContent).toBe('GPU 2');
        expect(cards[0].textContent).toContain('0%');
        expect(cards[0].textContent).not.toContain('<img');
        expect(cards[1].textContent).toContain('2.0 GB of 4.0 GB');
        expect(document.querySelector('.history polyline')).not.toBeNull();
    });

    it('shows a useful unavailable state when the data request fails', async () => {
        globalThis.fetch.mockRejectedValueOnce(new Error('offline'));
        await globalThis.GpuHotCompactView.refresh();

        expect(document.querySelector('#gpu-list').textContent).toContain('unavailable right now');
        expect(document.querySelector('#connection-state').textContent).toBe('GPU activity unavailable');
        expect(document.querySelector('#connection-state').className).toContain('is-unavailable');
    });
});
