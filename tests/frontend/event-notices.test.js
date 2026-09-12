import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const testDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(testDir, '../../static/js/event-notices.js'), 'utf8');
const template = readFileSync(join(testDir, '../../templates/index.html'), 'utf8');
const componentsCss = readFileSync(join(testDir, '../../static/css/components.css'), 'utf8');

function markup() {
    document.body.innerHTML = `
        <section id="event-notices" hidden>
            <button id="event-notices-clear">Clear all</button>
            <div id="event-notices-list"></div>
        </section>
    `;
}

function loadNotices(settings = {}) {
    delete window.GPUHotNotices;
    window.GPUHotSettings = {
        settings: {
            noticeGpuThrottle: false,
            noticeGpuMissing: false,
            noticeNodeOffline: false,
            noticeExternalFanStopped: false,
            ...settings
        },
        nodeDisplayLabel: (node, fallback) => fallback,
        gpuDisplayLabel: (_node, _gpu, fallback) => fallback
    };
    vm.runInThisContext(source, { filename: 'event-notices.js' });
    window.GPUHotNotices.init(document);
    return window.GPUHotNotices;
}

function hub(nodes) {
    return { mode: 'hub', nodes };
}

function online(gpus) {
    return { status: 'online', gpus };
}

describe('event notices', () => {
    beforeEach(() => {
        localStorage.clear();
        markup();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        delete window.GPUHotNotices;
        delete window.GPUHotSettings;
    });

    it('keeps every option off by default without showing or writing notices', () => {
        const setItem = vi.spyOn(Storage.prototype, 'setItem');
        const api = loadNotices();

        api.processPayload(hub({
            offline: { status: 'offline' },
            online: online({
                '0': { vendor: 'nvidia', throttle_reasons: 'HW Thermal' },
                '1': { fan_source: 'external', fan_rpm: 0 }
            })
        }));

        expect(api.notices).toEqual([]);
        expect(document.getElementById('event-notices').hidden).toBe(true);
        expect(setItem).not.toHaveBeenCalled();
    });

    it.each([
        ['noticeGpuThrottle', { vendor: 'nvidia', throttle_reasons: 'HW Slowdown' }, 'GPU throttling'],
        ['noticeExternalFanStopped', { fan_source: 'external', fan_speed: 0 }, 'External fan stopped']
    ])('creates only the independently enabled %s notice', (setting, gpu, title) => {
        const api = loadNotices({ [setting]: true });
        api.processPayload(hub({ node: online({ '0': gpu }) }));

        expect(api.notices).toHaveLength(1);
        expect(document.querySelector('.event-notice h3').textContent).toBe(title);
        expect(document.getElementById('event-notices').hidden).toBe(false);
    });

    it('keeps missing and offline events independently opt-in', () => {
        const api = loadNotices({ noticeGpuMissing: true });
        api.processPayload(hub({ node: online({ '0': {}, '1': {} }) }));
        api.processPayload(hub({ node: online({ '0': {} }), offline: { status: 'offline' } }));

        expect(api.notices).toHaveLength(1);
        expect(api.notices[0]).toMatchObject({ eventType: 'gpuMissing', node: 'node', gpu: '1' });

        window.GPUHotSettings.settings.noticeGpuMissing = false;
        window.GPUHotSettings.settings.noticeNodeOffline = true;
        api.processPayload(hub({ node: online({ '0': {} }), offline: { status: 'offline' } }));
        expect(api.notices.map(notice => notice.eventType)).toEqual(['gpuMissing', 'nodeOffline']);
    });

    it('tracks a throttle rise, detail change, clear, and later occurrence', () => {
        const api = loadNotices({ noticeGpuThrottle: true });
        api.processPayload(hub({ node: online({
            '0': { vendor: 'nvidia', throttle_reasons: 'HW Thermal' }
        }) }));
        const firstId = api.notices[0].id;
        const firstStart = api.notices[0].startedAt;

        vi.advanceTimersByTime(1000);
        api.processPayload(hub({ node: online({
            '0': { vendor: 'nvidia', throttle_reasons: 'Power Brake' }
        }) }));
        expect(api.notices).toHaveLength(1);
        expect(api.notices[0]).toMatchObject({ id: firstId, startedAt: firstStart });
        expect(api.notices[0].detail).toContain('Power Brake');

        api.processPayload(hub({ node: online({
            '0': { vendor: 'nvidia', throttle_reasons: 'None' }
        }) }));
        expect(api.notices[0].endedAt).not.toBeNull();

        vi.advanceTimersByTime(1000);
        api.processPayload(hub({ node: online({
            '0': { vendor: 'nvidia', throttle_reasons: 'SW Thermal' }
        }) }));
        expect(api.notices).toHaveLength(2);
        expect(api.notices[1].id).not.toBe(firstId);
    });

    it('keeps simultaneous throttle notices separate for each GPU on one node', () => {
        const api = loadNotices({ noticeGpuThrottle: true });
        const payload = hub({ node: online({
            '0': { vendor: 'nvidia', throttle_reasons: 'HW Thermal' },
            '1': { vendor: 'nvidia', throttle_reasons: 'Power Brake' }
        }) });

        api.processPayload(payload);
        api.processPayload(payload);

        expect(api.notices).toHaveLength(2);
        expect(api.notices.map(notice => notice.gpu)).toEqual(['0', '1']);
        expect(new Set(api.notices.map(notice => notice.id)).size).toBe(2);
    });

    it('persists a recovered notice with both observed times', () => {
        const api = loadNotices({ noticeGpuThrottle: true });
        api.processPayload(hub({ node: online({
            '0': { vendor: 'nvidia', throttle_reasons: 'HW Thermal' }
        }) }));
        vi.advanceTimersByTime(1000);
        api.processPayload(hub({ node: online({
            '0': { vendor: 'nvidia', throttle_reasons: 'None' }
        }) }));

        const saved = JSON.parse(localStorage.getItem(api.STORAGE_KEY));
        expect(saved.notices[0].startedAt).toBe('2026-09-12T12:00:00.000Z');
        expect(saved.notices[0].endedAt).toBe('2026-09-12T12:00:01.000Z');
        expect(document.querySelector('.event-notice').textContent).toContain('Ended');
    });

    it('recognizes only named NVIDIA throttle reasons and non-normal AMD states', () => {
        const api = loadNotices({ noticeGpuThrottle: true });
        api.processPayload(hub({ node: online({
            n0: { vendor: 'nvidia', throttle_reasons: 'Applications Clocks Setting' },
            n1: { vendor: 'nvidia', throttle_reasons: 'HW Slowdown, SW Thermal' },
            a0: { vendor: 'amd', throttle_reasons: 'UNTHROTTLED' },
            a1: { vendor: 'amd', throttle_reasons: 'POWER_LIMIT' },
            unknown: { vendor: 'other', throttle_reasons: 'HW Thermal' }
        }) }));

        expect(api.notices.map(notice => notice.gpu)).toEqual(['n1', 'a1']);
    });

    it('detects a missing GPU only after a complete online roster', () => {
        const api = loadNotices({ noticeGpuMissing: true, noticeNodeOffline: true });
        api.processPayload(hub({ node: online({ '0': {}, '1': {} }) }));
        api.processPayload(hub({ node: { status: 'offline' } }));
        expect(api.notices.map(notice => notice.eventType)).toEqual(['nodeOffline']);

        api.processPayload(hub({ node: online({ '0': {} }) }));
        expect(api.notices.map(notice => notice.eventType)).toEqual(['nodeOffline', 'gpuMissing']);
        expect(api.notices[0].endedAt).not.toBeNull();
        expect(api.notices[1]).toMatchObject({ node: 'node', gpu: '1', endedAt: null });
    });

    it('does not treat an incomplete payload as a clear or roster change', () => {
        const api = loadNotices({ noticeGpuMissing: true });
        api.processPayload(hub({ node: online({ '0': {}, '1': {} }) }));
        api.processPayload(hub({ node: { status: 'online' } }));
        api.processPayload(hub({ node: online({ '0': {}, '1': {} }) }));
        expect(api.notices).toEqual([]);
    });

    it('does not change a roster when one GPU entry is malformed', () => {
        const api = loadNotices({ noticeGpuMissing: true });
        api.processPayload(hub({ node: online({ '0': {}, '1': {} }) }));
        api.processPayload(hub({ node: online({ '0': {}, '1': null }) }));
        api.processPayload(hub({ node: online({ '0': {}, '1': {} }) }));
        expect(api.notices).toEqual([]);
    });

    it('does not infer an external fan from a native zero reading', () => {
        const api = loadNotices({ noticeExternalFanStopped: true });
        api.processPayload(hub({ node: online({
            native: { fan_speed: 0 },
            mapped: { fan_source: 'external', fan_rpm: 0 }
        }) }));
        expect(api.notices).toHaveLength(1);
        expect(api.notices[0].gpu).toBe('mapped');
    });

    it('keeps a dismissed active event hidden until it clears and recurs', () => {
        const api = loadNotices({ noticeNodeOffline: true });
        api.processPayload(hub({ node: { status: 'offline' } }));
        const firstId = api.notices[0].id;
        api.dismissNotice(firstId);
        api.processPayload(hub({ node: { status: 'offline' } }));
        expect(api.notices).toHaveLength(1);
        expect(document.getElementById('event-notices').hidden).toBe(true);

        api.processPayload(hub({ node: online({}) }));
        api.processPayload(hub({ node: { status: 'offline' } }));
        expect(api.notices).toHaveLength(2);
        expect(api.notices[1].dismissed).toBe(false);
    });

    it('evaluates the latest state immediately when an option is enabled', () => {
        const api = loadNotices();
        api.processPayload(hub({ node: { status: 'offline' } }));
        window.GPUHotSettings.settings.noticeNodeOffline = true;
        api.settingsChanged();
        expect(api.notices).toHaveLength(1);
    });

    it('clears all visible history without recreating an active event on the next frame', () => {
        const api = loadNotices({ noticeNodeOffline: true });
        const payload = hub({ node: { status: 'offline' } });
        api.processPayload(payload);
        document.getElementById('event-notices-clear').click();
        api.processPayload(payload);

        expect(api.notices).toEqual([]);
        expect(localStorage.getItem(api.STORAGE_KEY)).toBeNull();
        expect(document.getElementById('event-notices').hidden).toBe(true);
    });

    it('loads valid rows independently and rejects future, corrupt, and oversized storage', () => {
        const valid = {
            id: 'one', eventType: 'nodeOffline', node: 'node', gpu: null,
            detail: 'The node is offline.', startedAt: '2026-09-12T11:00:00.000Z',
            endedAt: null, dismissed: false
        };
        localStorage.setItem('gpu-hot.notices.v1', JSON.stringify({
            version: 1,
            notices: [valid, { ...valid, id: 'bad', eventType: 'unknown' }]
        }));
        expect(loadNotices().notices).toEqual([valid]);

        localStorage.setItem('gpu-hot.notices.v1', JSON.stringify({ version: 2, notices: [valid] }));
        expect(loadNotices().notices).toEqual([]);
        localStorage.setItem('gpu-hot.notices.v1', '{');
        expect(loadNotices().notices).toEqual([]);
        localStorage.setItem('gpu-hot.notices.v1', 'x'.repeat(262145));
        expect(loadNotices().notices).toEqual([]);
    });

    it('keeps only the newest active row for one event identity from storage', () => {
        const base = {
            eventType: 'nodeOffline', node: 'node', gpu: null,
            detail: 'The node is offline.', endedAt: null, dismissed: false
        };
        localStorage.setItem('gpu-hot.notices.v1', JSON.stringify({
            version: 1,
            notices: [
                { ...base, id: 'old', startedAt: '2026-09-12T10:00:00.000Z' },
                { ...base, id: 'new', startedAt: '2026-09-12T11:00:00.000Z' }
            ]
        }));

        expect(loadNotices().notices.map(notice => notice.id)).toEqual(['new']);
    });

    it('caps history at 100 entries by evicting the oldest ended notice first', () => {
        const rows = Array.from({ length: 101 }, (_value, index) => ({
            id: `n${index}`,
            eventType: 'nodeOffline',
            node: `node${index}`,
            gpu: null,
            detail: 'The node is offline.',
            startedAt: new Date(Date.UTC(2026, 8, 1, 0, 0, index)).toISOString(),
            endedAt: index === 1 ? new Date(Date.UTC(2026, 8, 1, 0, 1, index)).toISOString() : null,
            dismissed: false
        }));
        localStorage.setItem('gpu-hot.notices.v1', JSON.stringify({ version: 1, notices: rows }));
        const ids = loadNotices().notices.map(notice => notice.id);
        expect(ids).toHaveLength(100);
        expect(ids).not.toContain('n1');
        expect(ids).toContain('n0');
    });

    it('does not churn notices when more active events exist than the history cap', () => {
        const api = loadNotices({ noticeNodeOffline: true });
        const nodes = Object.fromEntries(Array.from(
            { length: 101 },
            (_value, index) => [`node${index}`, { status: 'offline' }]
        ));
        const setItem = vi.spyOn(Storage.prototype, 'setItem');

        api.processPayload(hub(nodes));
        expect(api.notices).toHaveLength(100);
        expect(setItem).toHaveBeenCalledTimes(1);

        api.processPayload(hub(nodes));
        expect(api.notices).toHaveLength(100);
        expect(setItem).toHaveBeenCalledTimes(1);
    });

    it('renders hostile labels and details as text and refreshes display overrides', () => {
        const api = loadNotices({ noticeGpuThrottle: true });
        window.GPUHotSettings.nodeDisplayLabel = () => '<img src=x onerror=alert(1)>';
        window.GPUHotSettings.gpuDisplayLabel = () => '<script>alert(1)</script>';
        api.processPayload(hub({ node: online({
            '0': { vendor: 'amd', throttle_reasons: '<svg onload=alert(1)>' }
        }) }));

        expect(document.querySelectorAll('.event-notice img, .event-notice script, .event-notice svg')).toHaveLength(0);
        expect(document.querySelector('.event-notice').textContent).toContain('<img src=x onerror=alert(1)>');
        expect(document.querySelector('.event-notice').textContent).toContain('<svg onload=alert(1)>');

        window.GPUHotSettings.nodeDisplayLabel = () => 'Friendly node';
        api.render();
        expect(document.querySelector('.event-notice').textContent).toContain('Friendly node');
    });

    it('contains quota failures and keeps live rendering available', () => {
        const api = loadNotices({ noticeNodeOffline: true });
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('quota');
        });
        expect(() => api.processPayload(hub({ node: { status: 'offline' } }))).not.toThrow();
        expect(document.querySelectorAll('.event-notice')).toHaveLength(1);
    });

    it('keeps focus on the same notice action when another notice arrives', () => {
        const api = loadNotices({ noticeNodeOffline: true });
        api.processPayload(hub({ first: { status: 'offline' } }));
        const firstButton = document.querySelector('.event-notice-dismiss');
        firstButton.focus();
        api.processPayload(hub({ first: { status: 'offline' }, second: { status: 'offline' } }));
        expect(document.activeElement.closest('[data-notice-id]').dataset.noticeId)
            .toBe(api.notices[0].id);
    });

    it('declares the hidden live region and four opt-in settings in the page', () => {
        const parsed = new DOMParser().parseFromString(template, 'text/html');
        const region = parsed.getElementById('event-notices');
        expect(region.hidden).toBe(true);
        expect(region.getAttribute('role')).toBe('log');
        expect(region.getAttribute('aria-live')).toBe('polite');
        expect(parsed.querySelectorAll('[data-notice-setting]')).toHaveLength(4);
    });

    it('keeps notices beneath the settings overlay and panel', () => {
        const noticeLayer = Number(componentsCss.match(/\.event-notices \{[\s\S]*?z-index: (\d+);/)[1]);
        const overlayLayer = Number(componentsCss.match(/\.settings-overlay \{[\s\S]*?z-index: (\d+);/)[1]);
        const panelLayer = Number(componentsCss.match(/\.settings-panel \{[\s\S]*?z-index: (\d+);/)[1]);

        expect(noticeLayer).toBeLessThan(overlayLayer);
        expect(noticeLayer).toBeLessThan(panelLayer);
    });
});
