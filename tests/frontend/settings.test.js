import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';
import vm from 'vm';

const testDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(testDir, '../../static/js/settings.js'), 'utf8');
const template = readFileSync(join(testDir, '../../templates/index.html'), 'utf8');
const componentsCss = readFileSync(join(testDir, '../../static/css/components.css'), 'utf8');
const layoutCss = readFileSync(join(testDir, '../../static/css/layout.css'), 'utf8');
const defaults = {
    'overview.utilization': true,
    'overview.temperature': true,
    'overview.memory': true,
    'overview.power': true,
    'overview.chart': true,
    'overview.showModel': false,
    'overview.showCardId': true,
    'overview.fan-speed': false,
    'overview.graphics-clock': false,
    'overview.memory-clock': false,
    'overview.memory-used': false,
    'overview.power-limit': false,
    'overview.memory-temperature': false,
    'overview.throttle-status': false,
    'overview.process-count': false,
    'overview.pcie-generation': false,
    'overview.pcie-width': false,
    'overview.encoder-load': false,
    'overview.decoder-load': false,
    'overview.performance-state': false,
    overviewMetricOrder: [
        'utilization', 'temperature', 'memory', 'power', 'fan-speed',
        'graphics-clock', 'memory-clock', 'memory-used', 'power-limit',
        'memory-temperature', 'throttle-status', 'process-count',
        'pcie-generation', 'pcie-width', 'encoder-load', 'decoder-load',
        'performance-state'
    ],
    overviewMetricsCustomized: false,
    theme: 'default',
    overviewMiniChartBehindDim: 25,
    noticeGpuThrottle: false,
    noticeGpuMissing: false,
    noticeNodeOffline: false,
    noticeExternalFanStopped: false
};
const tokensCss = readFileSync(join(testDir, '../../static/css/tokens.css'), 'utf8');

function panelMarkup() {
    document.body.innerHTML = `
        <button id="settings-open" aria-expanded="false">Settings</button>
        <div id="settings-overlay" hidden></div>
        <aside id="settings-panel" hidden inert aria-hidden="true">
            <button id="settings-close">Close</button>
            <div id="settings-connection-details" hidden></div>
            <label><input id="settings-move-connection-details" type="checkbox"></label>
            <input type="checkbox" data-overview-setting="utilization">
            <input type="checkbox" data-overview-setting="temperature">
            <input type="checkbox" data-overview-setting="memory">
            <input type="checkbox" data-overview-setting="power">
            <input type="checkbox" data-overview-setting="chart">
            <input type="checkbox" data-overview-setting="fan-speed">
            <input type="checkbox" data-overview-setting="graphics-clock">
            <input type="checkbox" data-overview-setting="memory-clock">
            <input type="checkbox" data-overview-setting="memory-used">
            <input type="checkbox" data-overview-setting="power-limit">
            <input type="checkbox" data-overview-setting="memory-temperature">
            <input type="checkbox" data-overview-setting="throttle-status">
            <input type="checkbox" data-overview-setting="process-count">
            <input type="checkbox" data-overview-setting="pcie-generation">
            <input type="checkbox" data-overview-setting="pcie-width">
            <input type="checkbox" data-overview-setting="encoder-load">
            <input type="checkbox" data-overview-setting="decoder-load">
            <input type="checkbox" data-overview-setting="performance-state">
            <input type="checkbox" data-overview-display="showModel">
            <input type="checkbox" data-overview-display="showCardId">
            <select id="settings-overview-chart-width">
                <option value="auto">Automatic</option>
                <option value="wide">Wide</option>
                <option value="full">Full row</option>
                <option value="behind">Behind metrics</option>
            </select>
            <label id="settings-overview-chart-behind-dim-field" hidden>
                <input id="settings-overview-chart-behind-dim" type="range" min="10" max="100" value="25">
                <output id="settings-overview-chart-behind-dim-value">25%</output>
            </label>
            <select id="settings-sidebar-width">
                <option value="standard">Standard</option>
                <option value="comfortable">Comfortable</option>
                <option value="wide">Wide</option>
            </select>
            <select id="settings-sidebar-label">
                <option value="index">Index</option>
                <option value="node-index">Node and index</option>
                <option value="short-name">Short name</option>
            </select>
            <input id="settings-sidebar-auto-hide" type="checkbox">
            <select id="settings-theme">
                <option value="default">Default</option>
                <option value="midnight">Midnight</option>
                <option value="high-contrast">High contrast</option>
            </select>
            <div class="settings-setup-actions">
                <button id="settings-copy-setup" type="button">Copy setup code</button>
                <button id="settings-paste-setup" type="button">Paste setup code</button>
                <span id="settings-setup-status"></span>
            </div>
            <dialog id="settings-setup-dialog" hidden>
                <h4 id="settings-setup-dialog-title">Enter setup code</h4>
                <textarea id="settings-setup-code"></textarea>
                <p id="settings-setup-dialog-status"></p>
                <button id="settings-setup-cancel" type="button">Cancel</button>
                <button id="settings-setup-import" type="button">Import</button>
            </dialog>
            <input type="checkbox" data-notice-setting="noticeGpuThrottle">
            <input type="checkbox" data-notice-setting="noticeGpuMissing">
            <input type="checkbox" data-notice-setting="noticeNodeOffline">
            <input type="checkbox" data-notice-setting="noticeExternalFanStopped">
            <div id="settings-label-list"></div>
            <button id="settings-reset">Reset settings</button>
            <p id="settings-status"></p>
        </aside>
        <div id="dashboard-status-home">
            <div id="connection-details">
                <span id="connection-status">Connected</span>
                <span id="version-current">v1.9.2</span>
            </div>
        </div>
        <div class="overview-gpu-card">
            <p class="gpu-uuid">GPU-id</p>
            <div class="overview-mini-chart" data-overview-metric="chart">
                <canvas id="overview-chart-0"></canvas>
            </div>
        </div>
    `;
}

function metricPanelRows() {
    const panel = document.getElementById('settings-panel');
    const inputs = Array.from(panel.querySelectorAll('[data-overview-setting]'));
    const metricList = document.createElement('div');
    metricList.className = 'settings-metric-list';
    inputs[0].before(metricList);
    inputs.forEach(input => {
        const label = document.createElement('label');
        label.className = 'settings-check-row';
        label.textContent = input.dataset.overviewSetting.replaceAll('-', ' ');
        input.replaceWith(label);
        label.prepend(input);
        metricList.appendChild(label);
    });
    const body = document.createElement('div');
    body.className = 'settings-body';
    metricList.before(body);
    body.appendChild(metricList);
    return metricList;
}

function loadSettingsModule() {
    delete window.GPUHotSettings;
    vm.runInThisContext(source, { filename: 'settings.js' });
    return window.GPUHotSettings;
}

describe('settings storage', () => {
    beforeEach(() => {
        localStorage.clear();
        window.history.replaceState(null, '', '/');
        document.body.innerHTML = '';
        document.documentElement.classList.remove(
            'settings-connection-in-panel',
            'overview-chart-width-wide',
            'overview-chart-width-full',
            'overview-chart-width-behind'
        );
        document.documentElement.style.removeProperty('--overview-chart-behind-dim');
        document.documentElement.style.removeProperty('--sidebar-width');
        delete window.updateSidebarLabels;
        delete window.applySidebarOrder;
        delete window.GPUHotNotices;
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('round trips the full settings set, including names, order, theme and Unicode', () => {
        const api = loadSettingsModule();
        const selected = {
            ...defaults,
            'overview.fan-speed': true,
            overviewMetricsCustomized: true,
            moveConnectionDetails: true,
            overviewMiniChartWidth: 'behind',
            overviewMiniChartBehindDim: 60,
            sidebarWidth: 'wide',
            sidebarLabel: 'node-index',
            sidebarAutoHide: true,
            noticeGpuThrottle: true,
            noticeGpuMissing: true,
            noticeNodeOffline: true,
            noticeExternalFanStopped: true,
            theme: 'midnight',
            sidebarOrder: [JSON.stringify(['node-a', '0'])],
            overviewMetricOrder: [...defaults.overviewMetricOrder].reverse(),
            labelOverrides: [{ kind: 'gpu', node: 'node-a', gpu: '0', label: 'Test \u03bb' }]
        };
        const code = api.exportSetupCode(selected);
        expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(api.decodeSetupCode(code)).toEqual(selected);
        const raw = JSON.parse(Buffer.from(code, 'base64url').toString('utf8'));
        raw.settings.unrecognized = true;
        expect(api.decodeSetupCode(Buffer.from(JSON.stringify(raw)).toString('base64url'))).toBeNull();
    });

    it('applies a setup URL before the panel initializes and removes only that parameter', () => {
        const api = loadSettingsModule();
        const code = api.exportSetupCode({ ...defaults, theme: 'high-contrast', moveConnectionDetails: true });
        window.history.replaceState(null, '', `/?keep=1&setup=${code}#section`);
        const imported = loadSettingsModule();
        expect(imported.settings.theme).toBe('high-contrast');
        expect(document.documentElement.dataset.theme).toBe('high-contrast');
        expect(document.documentElement.classList.contains('settings-connection-in-panel')).toBe(true);
        expect(window.location.search).toBe('?keep=1');
        expect(window.location.hash).toBe('#section');
        expect(imported.loadSettings().theme).toBe('high-contrast');
    });

    it('asks before replacing stored settings from a URL or the panel', async () => {
        panelMarkup();
        const originalClipboard = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
        const readText = vi.fn();
        Object.defineProperty(window.navigator, 'clipboard', {
            configurable: true, value: { readText }
        });
        const api = loadSettingsModule();
        const code = api.exportSetupCode({ ...defaults, theme: 'midnight' });
        readText.mockResolvedValue(code);
        api.saveSettings({ ...defaults, theme: 'high-contrast' });
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        window.history.replaceState(null, '', `/?setup=${code}`);
        expect(loadSettingsModule().settings.theme).toBe('high-contrast');
        expect(confirm).toHaveBeenCalledOnce();
        expect(window.location.search).toBe('');
        document.getElementById('settings-paste-setup').click();
        await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
        expect(api.loadSettings().theme).toBe('high-contrast');
        confirm.mockReturnValue(true);
        vi.useFakeTimers();
        document.getElementById('settings-paste-setup').click();
        await vi.advanceTimersByTimeAsync(0);
        expect(api.loadSettings().theme).toBe('midnight');
        vi.useRealTimers();
        if (originalClipboard) Object.defineProperty(window.navigator, 'clipboard', originalClipboard);
        else delete window.navigator.clipboard;
    });

    it('copies directly and fades the success status without a dialog', async () => {
        panelMarkup();
        const writeText = vi.fn().mockResolvedValue(undefined);
        const originalClipboard = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
        Object.defineProperty(window.navigator, 'clipboard', {
            configurable: true,
            value: { writeText }
        });
        const prompt = vi.spyOn(window, 'prompt');
        const api = loadSettingsModule();
        vi.useFakeTimers();
        document.getElementById('settings-copy-setup').click();
        await vi.advanceTimersByTimeAsync(0);
        expect(writeText).toHaveBeenCalledOnce();
        expect(api.decodeSetupCode(writeText.mock.calls[0][0])).toEqual(defaults);
        expect(prompt).not.toHaveBeenCalled();
        expect(document.getElementById('settings-setup-status').textContent).toBe('Copied to clipboard');
        expect(document.getElementById('settings-setup-status').classList.contains('is-visible')).toBe(true);
        await vi.advanceTimersByTimeAsync(2600);
        expect(document.getElementById('settings-setup-status').textContent).toBe('');
        vi.useRealTimers();
        if (originalClipboard) Object.defineProperty(window.navigator, 'clipboard', originalClipboard);
        else delete window.navigator.clipboard;
    });

    it('opens Enter setup code when clipboard reading is denied', async () => {
        panelMarkup();
        const originalClipboard = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
        Object.defineProperty(window.navigator, 'clipboard', {
            configurable: true,
            value: { readText: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) }
        });
        const api = loadSettingsModule();
        document.getElementById('settings-open').click();
        document.getElementById('settings-paste-setup').click();
        await vi.waitFor(() => expect(document.getElementById('settings-setup-dialog').open).toBe(true));
        expect(document.getElementById('settings-paste-setup').textContent).toBe('Enter setup code');
        expect(document.getElementById('settings-setup-dialog-title').textContent).toBe('Enter setup code');
        const codeField = document.getElementById('settings-setup-code');
        codeField.value = 'not valid!';
        document.getElementById('settings-setup-import').click();
        expect(document.getElementById('settings-setup-dialog-status').textContent).toMatch(/could not be read/);
        expect(document.getElementById('settings-setup-dialog').open).toBe(true);
        codeField.value = api.exportSetupCode({ ...defaults, theme: 'midnight' });
        vi.useFakeTimers();
        document.getElementById('settings-setup-import').click();
        expect(api.loadSettings().theme).toBe('midnight');
        expect(document.getElementById('settings-setup-dialog').open).toBe(false);
        vi.useRealTimers();
        if (originalClipboard) Object.defineProperty(window.navigator, 'clipboard', originalClipboard);
        else delete window.navigator.clipboard;
    });

    it('keeps keyboard focus inside the setup dialog and closes it before the panel', () => {
        panelMarkup();
        const originalClipboard = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');
        Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: {} });
        loadSettingsModule();
        document.getElementById('settings-open').click();
        expect(document.getElementById('settings-paste-setup').textContent).toBe('Enter setup code');
        document.getElementById('settings-paste-setup').click();
        const dialog = document.getElementById('settings-setup-dialog');
        expect(dialog.open).toBe(true);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        expect(dialog.contains(document.activeElement)).toBe(true);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(dialog.open).toBe(false);
        expect(document.getElementById('settings-panel').hidden).toBe(false);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.getElementById('settings-panel').hidden).toBe(true);
        if (originalClipboard) Object.defineProperty(window.navigator, 'clipboard', originalClipboard);
        else delete window.navigator.clipboard;
    });

    it.each([
        ['missing data', null],
        ['malformed JSON', '{'],
        ['unexpected shape', JSON.stringify([])],
        ['newer version', JSON.stringify({ version: 2, settings: { future: true } })]
    ])('uses defaults for %s', (_label, value) => {
        if (value !== null) localStorage.setItem('gpu-hot.settings.v1', value);
        expect(loadSettingsModule().settings).toEqual(defaults);
    });

    it('does not overwrite settings written by a newer version', () => {
        const future = JSON.stringify({ version: 2, settings: { future: true } });
        localStorage.setItem('gpu-hot.settings.v1', future);
        const setItem = vi.spyOn(Storage.prototype, 'setItem');

        expect(loadSettingsModule().settings).toEqual(defaults);
        expect(setItem).not.toHaveBeenCalled();
        expect(localStorage.getItem('gpu-hot.settings.v1')).toBe(future);
    });

    it('retains the explicit newer-version guard', () => {
        expect(source).toMatch(
            /if \(raw\.version > STORAGE_VERSION\) return null;/
        );
    });

    it('migrates the version zero envelope and drops unknown settings', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 0,
            settings: { unknown: 'value' }
        }));
        const api = loadSettingsModule();
        expect(api.settings).toEqual(defaults);
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY))).toEqual({
            version: 1,
            settings: defaults
        });
    });

    it('stores only allowlisted settings in a versioned envelope', () => {
        const api = loadSettingsModule();
        expect(api.saveSettings({ moveConnectionDetails: true, unknown: 'value' })).toBe(true);
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY))).toEqual({
            version: 1,
            settings: { ...defaults, moveConnectionDetails: true }
        });
    });

    it('keeps model off and card ID on by default, then saves and resets both choices', () => {
        panelMarkup();
        const api = loadSettingsModule();
        const model = document.querySelector('[data-overview-display="showModel"]');
        const cardId = document.querySelector('[data-overview-display="showCardId"]');
        const uuid = document.querySelector('.gpu-uuid');
        expect(model.checked).toBe(false);
        expect(cardId.checked).toBe(true);
        expect(uuid.hidden).toBe(false);
        expect(componentsCss).toMatch(/\.gpu-uuid\[hidden\],\s*\.gpu-detail-uuid\[hidden\]\s*\{\s*display:\s*none;/);

        model.checked = true;
        model.dispatchEvent(new Event('change'));
        cardId.checked = false;
        cardId.dispatchEvent(new Event('change'));
        expect(api.settings['overview.showModel']).toBe(true);
        expect(api.settings['overview.showCardId']).toBe(false);
        expect(uuid.hidden).toBe(true);
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY)).settings['overview.showModel']).toBe(true);

        document.getElementById('settings-reset').click();
        expect(model.checked).toBe(false);
        expect(cardId.checked).toBe(true);
        expect(uuid.hidden).toBe(false);
    });

    it('stores each event notice choice independently and leaves the others off', () => {
        panelMarkup();
        const api = loadSettingsModule();
        const throttle = document.querySelector('[data-notice-setting="noticeGpuThrottle"]');
        throttle.checked = true;
        throttle.dispatchEvent(new Event('change'));

        expect(api.settings.noticeGpuThrottle).toBe(true);
        expect(api.settings.noticeGpuMissing).toBe(false);
        expect(api.settings.noticeNodeOffline).toBe(false);
        expect(api.settings.noticeExternalFanStopped).toBe(false);
    });

    it('reset turns off every event choice without erasing notice history', () => {
        panelMarkup();
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: {
                noticeGpuThrottle: true,
                noticeGpuMissing: true,
                noticeNodeOffline: true,
                noticeExternalFanStopped: true
            }
        }));
        localStorage.setItem('gpu-hot.notices.v1', 'saved history');
        const settingsChanged = vi.fn();
        window.GPUHotNotices = { settingsChanged };
        const api = loadSettingsModule();

        document.getElementById('settings-reset').click();

        expect(api.settings).toEqual(defaults);
        expect(Array.from(document.querySelectorAll('[data-notice-setting]'))
            .every(input => input.checked === false)).toBe(true);
        expect(localStorage.getItem('gpu-hot.notices.v1')).toBe('saved history');
        expect(settingsChanged).toHaveBeenCalled();
    });

    it('resets the notice and Behind metrics settings without reviving the removed star option', () => {
        panelMarkup();
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: {
                noticeGpuThrottle: true,
                noticeGpuMissing: true,
                noticeNodeOffline: true,
                noticeExternalFanStopped: true,
                showStarPrompt: false,
                overviewMiniChartWidth: 'behind',
                overviewMiniChartBehindDim: 75
            }
        }));
        localStorage.setItem('gpu-hot.notices.v1', 'saved history');
        localStorage.setItem('gpuHotStarPromptDismissed', 'true');
        const settingsChanged = vi.fn();
        window.GPUHotNotices = { settingsChanged };
        const api = loadSettingsModule();

        document.getElementById('settings-reset').click();

        expect(api.settings).toEqual(defaults);
        expect(Array.from(document.querySelectorAll('[data-notice-setting]'))
            .every(input => input.checked === false)).toBe(true);
        expect(api.settings).not.toHaveProperty('showStarPrompt');
        expect(document.getElementById('settings-overview-chart-width').value).toBe('auto');
        expect(document.getElementById('settings-overview-chart-behind-dim').value).toBe('25');
        expect(document.documentElement.classList.contains('overview-chart-width-behind')).toBe(false);
        expect(document.documentElement.style.getPropertyValue('--overview-chart-behind-dim')).toBe('0.25');
        expect(localStorage.getItem('gpu-hot.notices.v1')).toBe('saved history');
        expect(localStorage.getItem('gpuHotStarPromptDismissed')).toBe('true');
        expect(settingsChanged).toHaveBeenCalledOnce();
    });

    it('keeps only boolean metric choices and fills missing defaults', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: {
                'overview.utilization': false,
                'overview.temperature': 'no',
                unknown: true
            }
        }));

        expect(loadSettingsModule().settings).toEqual({
            ...defaults,
            'overview.utilization': false
        });
    });

    it('drops invalid values for the connection-details option', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { moveConnectionDetails: 'yes' }
        }));
        expect(loadSettingsModule().settings).toEqual(defaults);
    });

    it('keeps an allowlisted mini chart width and drops unsupported values', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { overviewMiniChartWidth: 'wide' }
        }));
        expect(loadSettingsModule().settings).toEqual({
            ...defaults,
            overviewMiniChartWidth: 'wide'
        });

        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { overviewMiniChartWidth: 'huge' }
        }));
        expect(loadSettingsModule().settings).toEqual(defaults);
    });

    it('applies a stored mini chart width while the head script is evaluated', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { overviewMiniChartWidth: 'wide' }
        }));

        loadSettingsModule();

        expect(document.documentElement.classList.contains('overview-chart-width-wide')).toBe(true);
    });

    it('migrates a saved pin away and applies the single hide setting before the page is ready', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: {
                sidebarWidth: 'comfortable',
                sidebarLabel: 'node-index',
                sidebarAutoHide: true,
                sidebarPinned: true
            }
        }));

        const api = loadSettingsModule();

        expect(api.settings).toEqual({
            ...defaults,
            sidebarWidth: 'comfortable',
            sidebarLabel: 'node-index',
            sidebarAutoHide: true
        });
        expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('72px');
        expect(document.documentElement.classList.contains('sidebar-auto-hide')).toBe(true);
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY)).settings).toEqual(api.settings);
        expect(localStorage.getItem(api.STORAGE_KEY)).not.toContain('sidebarPinned');
    });

    it('stores a valid sidebar order with the other settings defaults', () => {
        const api = loadSettingsModule();
        const order = [JSON.stringify(['node-a', '0']), JSON.stringify(['node-b', '1'])];
        expect(api.saveSettings({ sidebarOrder: order, unknown: 'value' })).toBe(true);
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY))).toEqual({
            version: 1,
            settings: { ...defaults, sidebarOrder: order }
        });
    });

    it.each([
        ['a non-array', 'node-a-0'],
        ['a duplicate key', [JSON.stringify(['node-a', '0']), JSON.stringify(['node-a', '0'])]],
        ['a malformed key', ['node-a-0']],
        ['an empty identity part', [JSON.stringify(['', '0'])]]
    ])('drops %s from the saved order', (_label, sidebarOrder) => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { sidebarOrder }
        }));

        expect(loadSettingsModule().settings).toEqual(defaults);
    });

    it('stores only valid label overrides alongside defaults', () => {
        const api = loadSettingsModule();
        const labels = [
            { kind: 'node', node: 'node-a', label: 'Render box' },
            { kind: 'gpu', node: 'node-a', gpu: '0', label: 'Primary GPU' }
        ];
        expect(api.saveSettings({ labelOverrides: labels, unknown: 'value' })).toBe(true);
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY))).toEqual({
            version: 1,
            settings: { ...defaults, labelOverrides: labels }
        });
    });

    it.each([
        ['an empty identity', [{ kind: 'gpu', node: 'node-a', gpu: '', label: 'GPU' }]],
        ['an overlong identity', [{ kind: 'node', node: 'n'.repeat(257), label: 'Node' }]],
        ['an overlong label', [{ kind: 'node', node: 'node-a', label: 'x'.repeat(81) }]],
        ['an invalid kind', [{ kind: 'system', node: 'node-a', label: 'System' }]]
    ])('drops label overrides with %s', (_label, labelOverrides) => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { labelOverrides }
        }));
        expect(loadSettingsModule().settings).toEqual(defaults);
    });

    it('keeps valid rows when neighboring rows are invalid or duplicated', () => {
        const first = { kind: 'node', node: 'node-a', label: 'First' };
        const validGpu = { kind: 'gpu', node: 'node-a', gpu: '0', label: 'Primary' };
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: {
                labelOverrides: [
                    first,
                    { kind: 'node', node: 'node-a', label: 'Duplicate' },
                    { kind: 'gpu', node: 'node-a', gpu: '1', label: 'x'.repeat(81) },
                    validGpu
                ]
            }
        }));

        expect(loadSettingsModule().settings.labelOverrides).toEqual([first, validGpu]);
    });

    it('bounds the number of stored label overrides', () => {
        const makeLabels = count => Array.from({ length: count }, (_, index) => ({
            kind: 'gpu', node: 'node-a', gpu: String(index), label: `GPU ${index}`
        }));
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { labelOverrides: makeLabels(512) }
        }));
        expect(loadSettingsModule().settings.labelOverrides).toHaveLength(512);

        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { labelOverrides: makeLabels(513) }
        }));
        expect(loadSettingsModule().settings.labelOverrides).toHaveLength(512);
    });

    it('returns defaults when storage reads fail and reports write failures', () => {
        const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('read failed');
        });
        const api = loadSettingsModule();
        expect(api.settings).toEqual(defaults);
        getItem.mockRestore();

        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });
        expect(api.saveSettings({})).toBe(false);
    });

    it('resets stored settings and reports removal failures', () => {
        const api = loadSettingsModule();
        localStorage.setItem(api.STORAGE_KEY, 'stored');
        expect(api.resetSettings()).toBe(true);
        expect(localStorage.getItem(api.STORAGE_KEY)).toBeNull();

        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('remove failed');
        });
        expect(api.resetSettings()).toBe(false);
    });
});

describe('theme settings', () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.removeAttribute('data-theme');
        panelMarkup();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        document.documentElement.removeAttribute('data-theme');
    });

    it('keeps the default theme attribute-free', () => {
        const api = loadSettingsModule();

        expect(api.THEMES).toEqual(['default', 'midnight', 'high-contrast']);
        expect(api.settings.theme).toBe('default');
        expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    });

    it.each(['midnight', 'high-contrast'])('applies saved %s during module load', theme => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { theme }
        }));

        const api = loadSettingsModule();

        expect(api.settings.theme).toBe(theme);
        expect(document.documentElement.dataset.theme).toBe(theme);
    });

    it('applies the saved theme before registering deferred panel setup', () => {
        const applyPosition = source.indexOf(
            'applyTheme(settings.theme, global.document, false)'
        );
        const readyPosition = source.indexOf("global.document.readyState === 'loading'");

        expect(applyPosition).toBeGreaterThan(-1);
        expect(readyPosition).toBeGreaterThan(applyPosition);
    });

    it('ignores an unknown saved theme', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { theme: 'unknown' }
        }));

        const api = loadSettingsModule();

        expect(api.settings.theme).toBe('default');
        expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    });

    it('saves and applies a selected theme', () => {
        const event = vi.fn();
        window.addEventListener('gpu-hot:themechange', event, { once: true });
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const select = document.getElementById('settings-theme');

        select.value = 'midnight';
        select.dispatchEvent(new Event('change'));

        expect(api.settings.theme).toBe('midnight');
        expect(document.documentElement.dataset.theme).toBe('midnight');
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY)).settings.theme).toBe('midnight');
        expect(event).toHaveBeenCalledOnce();
    });

    it('keeps the current theme when saving fails', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const select = document.getElementById('settings-theme');
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });

        select.value = 'midnight';
        select.dispatchEvent(new Event('change'));

        expect(select.value).toBe('default');
        expect(api.settings.theme).toBe('default');
        expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
        expect(document.getElementById('settings-status').textContent)
            .toBe('This display change could not be saved. Try again.');
    });

    it('reset restores the default theme and picker', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { theme: 'high-contrast' }
        }));
        const api = loadSettingsModule();
        api.initSettingsPanel();

        document.getElementById('settings-reset').click();

        expect(api.settings.theme).toBe('default');
        expect(document.getElementById('settings-theme').value).toBe('default');
        expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    });
});

describe('settings panel', () => {
    beforeEach(() => {
        localStorage.clear();
        panelMarkup();
        document.documentElement.classList.remove(
            'settings-connection-in-panel',
            'overview-chart-width-wide',
            'overview-chart-width-full'
        );
        document.documentElement.style.removeProperty('--sidebar-width');
        delete window.updateSidebarLabels;
        delete window.applySidebarOrder;
    });
    afterEach(() => {
        vi.restoreAllMocks();
        delete document.elementFromPoint;
    });

    it('keeps the unconfigured single-GPU hero markup and restores it on reset', () => {
        metricPanelRows();
        const single = document.createElement('article');
        single.className = 'single-gpu-overview';
        single.dataset.gpuId = '0';
        single.innerHTML = `<div class="sgo-metrics-grid">
            <div class="metric-cell"><span id="sgo-util-0">10</span></div>
            <div class="metric-cell"><span id="sgo-temp-0">40</span></div>
            <div class="metric-cell"><span id="sgo-mem-0">2 GB</span></div>
            <div class="metric-cell"><span id="sgo-power-0">80 W</span></div>
            <div class="metric-cell"><span id="sgo-fan-0">30%</span></div>
            </div><div class="sgo-mini-chart"></div>`;
        document.body.appendChild(single);
        const original = single.outerHTML;
        const api = loadSettingsModule();
        api.initSettingsPanel();
        expect(single.outerHTML).toBe(original);

        const grip = document.querySelector('[data-metric-order="memory"] .settings-metric-grip');
        grip.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true
        }));
        expect(api.settings.overviewMetricOrder.slice(0, 4))
            .toEqual(['utilization', 'memory', 'temperature', 'power']);
        expect([...single.querySelectorAll('[data-overview-metric]')].slice(0, 4)
            .map(cell => cell.dataset.overviewMetric))
            .toEqual(['utilization', 'memory', 'temperature', 'power']);
        expect(single.querySelectorAll('.single-overview-extra')).toHaveLength(12);
        expect(single.querySelector('[data-overview-metric="fan-speed"]').hidden).toBe(true);

        document.getElementById('settings-reset').click();
        expect([...single.querySelectorAll('.sgo-metrics-grid > .metric-cell')]
            .map(cell => cell.querySelector('span')?.id))
            .toEqual(['sgo-util-0', 'sgo-temp-0', 'sgo-mem-0', 'sgo-power-0', 'sgo-fan-0']);
        expect(single.querySelector('.single-overview-extra')).toBeNull();
        expect(single.querySelector('.sgo-mini-chart').hidden).toBe(false);
    });

    it('reorders every compact card without changing values and saves the order', () => {
        metricPanelRows();
        document.body.insertAdjacentHTML('beforeend', [0, 1].map(id => `
            <article class="overview-gpu-card"><div class="overview-metrics">
                <div data-overview-metric="utilization">${id} util</div>
                <div data-overview-metric="temperature">${id} temp</div>
                <div data-overview-metric="memory">${id} mem</div>
                <div data-overview-metric="power">${id} power</div>
            </div><div class="overview-mini-chart"></div></article>`).join(''));
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const powerCells = Array.from(document.querySelectorAll('.overview-metrics'))
            .map(card => card.querySelector('[data-overview-metric="power"]'));
        const grip = document.querySelector('[data-metric-order="power"] .settings-metric-grip');
        grip.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true
        }));
        expect(document.activeElement).toBe(grip);
        expect(document.getElementById('settings-status').textContent).toContain('position 3');
        for (const [index, card] of Array.from(document.querySelectorAll('.overview-gpu-card .overview-metrics')).entries()) {
            expect([...card.children].map(cell => cell.dataset.overviewMetric))
                .toEqual(['utilization', 'temperature', 'power', 'memory']);
            expect(card.children[2]).toBe(powerCells[index]);
            expect([...card.children].map(cell => cell.textContent))
                .toEqual(card.firstElementChild.textContent.startsWith('0')
                    ? ['0 util', '0 temp', '0 power', '0 mem']
                    : ['1 util', '1 temp', '1 power', '1 mem']);
        }
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY)).settings.overviewMetricOrder.slice(0, 4))
            .toEqual(['utilization', 'temperature', 'power', 'memory']);
        const temperature = document.querySelector('[data-overview-setting="temperature"]');
        temperature.click();
        temperature.click();
        expect([...document.querySelector('.overview-metrics').children]
            .map(cell => cell.dataset.overviewMetric))
            .toEqual(['utilization', 'temperature', 'power', 'memory']);
        document.getElementById('settings-reset').click();
        expect([...document.querySelector('.overview-metrics').children]
            .map(cell => cell.dataset.overviewMetric))
            .toEqual(['utilization', 'temperature', 'memory', 'power']);
    });

    it('measures the fade from the last visible cell after a reorder', () => {
        metricPanelRows();
        document.body.insertAdjacentHTML('beforeend', `
            <article class="overview-gpu-card"><div class="overview-metrics">
                <div class="overview-metric" data-overview-metric="utilization">10</div>
                <div class="overview-metric" data-overview-metric="temperature">40</div>
                <div class="overview-metric" data-overview-metric="memory">50</div>
                <div class="overview-metric" data-overview-metric="power">80</div>
            </div><div class="overview-mini-chart"></div></article>`);
        const card = document.querySelectorAll('.overview-gpu-card')[1];
        const api = loadSettingsModule();
        api.initSettingsPanel();
        card.querySelector('.overview-mini-chart').getBoundingClientRect = () => ({ left: 0 });
        card.querySelectorAll('.overview-metric').forEach(metric => {
            metric.getBoundingClientRect = () => {
                const index = Array.from(metric.parentElement.children).indexOf(metric);
                return { top: 0, left: index * 112, right: index * 112 + 72 };
            };
        });
        document.querySelector('[data-metric-order="power"] .settings-metric-grip')
            .dispatchEvent(new KeyboardEvent('keydown', {
                key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true
            }));
        expect(card.querySelector('.overview-metrics').lastElementChild.dataset.overviewMetric).toBe('memory');
        expect(card.style.getPropertyValue('--overview-chart-behind-fade-start'))
            .toBe('calc(408px + var(--overview-chart-behind-text-pad))');
        expect(api.settings.overviewMetricOrder[2]).toBe('power');
    });

    it('rejects duplicate saved metrics and appends new metrics to a partial order', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1, settings: { overviewMetricOrder: ['power', 'power'] }
        }));
        expect(loadSettingsModule().settings.overviewMetricOrder).toEqual(defaults.overviewMetricOrder);
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1, settings: { overviewMetricOrder: ['power'] }
        }));
        const order = loadSettingsModule().settings.overviewMetricOrder;
        expect(order).toHaveLength(17);
        expect(order[0]).toBe('power');
        expect(new Set(order).size).toBe(17);
    });

    it('keeps Mini chart in its original fifth settings position', () => {
        const fieldset = metricPanelRows();
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const displayedMetrics = () => Array.from(fieldset.children)
            .filter(child => child.matches('.settings-metric-row, label'))
            .map(child => child.dataset.metricOrder
                || child.querySelector('[data-overview-setting]')?.dataset.overviewSetting);

        expect(displayedMetrics().slice(0, 6))
            .toEqual(['utilization', 'temperature', 'memory', 'power', 'chart', 'fan-speed']);
        const grip = fieldset.querySelector('[data-metric-order="fan-speed"] .settings-metric-grip');
        grip.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true
        }));
        expect(displayedMetrics()[4]).toBe('chart');
        expect(api.settings.overviewMetricOrder[3]).toBe('fan-speed');
    });

    it('drags only from the grip, opens a gap, and saves only a changed order', () => {
        const fieldset = metricPanelRows();
        const api = loadSettingsModule();
        api.initSettingsPanel();
        fieldset.setPointerCapture = vi.fn();
        const first = fieldset.querySelector('[data-metric-order="utilization"]');
        const second = fieldset.querySelector('[data-metric-order="temperature"]');
        const grip = second.querySelector('.settings-metric-grip');
        const rectangle = row => ({
            left: 10, top: Array.from(fieldset.querySelectorAll('.settings-metric-row')).indexOf(row) * 20,
            width: 200, height: 20
        });
        first.getBoundingClientRect = () => rectangle(first);
        second.getBoundingClientRect = () => rectangle(second);
        const animation = { cancel: vi.fn() };
        first.animate = vi.fn(() => animation);
        second.animate = vi.fn(() => animation);
        document.elementFromPoint = vi.fn(() => first);
        const dispatch = (type, target, x, y) => {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.assign(event, { pointerId: 7, pointerType: 'mouse', button: 0, clientX: x, clientY: y });
            target.dispatchEvent(event);
        };
        for (const target of [second.querySelector('label'), second.querySelector('input')]) {
            dispatch('pointerdown', target, 20, 30);
            dispatch('pointermove', target, 20, 5);
            expect(document.querySelector('.settings-metric-ghost')).toBeNull();
            expect(api.settings.overviewMetricOrder.slice(0, 2))
                .toEqual(['utilization', 'temperature']);
            dispatch('pointerup', target, 20, 5);
        }
        const checkbox = second.querySelector('input');
        const checkedBefore = checkbox.checked;
        checkbox.click();
        expect(checkbox.checked).toBe(!checkedBefore);
        expect(api.settings.overviewMetricOrder.slice(0, 2))
            .toEqual(['utilization', 'temperature']);
        dispatch('pointerdown', grip, 20, 30);
        dispatch('pointermove', grip, 20, 5);
        expect(document.querySelector('.settings-metric-ghost')).not.toBeNull();
        expect(second.classList.contains('settings-metric-moving')).toBe(true);
        expect(fieldset.setPointerCapture).toHaveBeenCalledWith(7);
        expect(first.animate).toHaveBeenCalled();
        dispatch('pointerup', grip, 20, 5);
        expect(document.querySelector('.settings-metric-ghost')).toBeNull();
        expect(api.settings.overviewMetricOrder.slice(0, 2)).toEqual(['temperature', 'utilization']);

        const stored = localStorage.getItem(api.STORAGE_KEY);
        const write = vi.spyOn(Storage.prototype, 'setItem');
        dispatch('pointerdown', grip, 20, 30);
        dispatch('pointerup', grip, 20, 30);
        expect(localStorage.getItem(api.STORAGE_KEY)).toBe(stored);
        expect(write).not.toHaveBeenCalled();

        const reloaded = loadSettingsModule();
        expect(reloaded.settings.overviewMetricOrder.slice(0, 2)).toEqual(['temperature', 'utilization']);
    });

    it('lets a phone swipe scroll and a still touch hold start ordering', () => {
        vi.useFakeTimers();
        const previousMatchMedia = window.matchMedia;
        try {
            const fieldset = metricPanelRows();
            const body = fieldset.parentElement;
            window.matchMedia = vi.fn(() => ({ matches: true }));
            const api = loadSettingsModule();
            api.initSettingsPanel();
            fieldset.setPointerCapture = vi.fn();
            const first = fieldset.querySelector('[data-metric-order="utilization"]');
            const second = fieldset.querySelector('[data-metric-order="temperature"]');
            const grip = second.querySelector('.settings-metric-grip');
            first.getBoundingClientRect = () => ({ top: 0, height: 20 });
            second.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 20 });
            document.elementFromPoint = vi.fn(() => first);
            const dispatch = (type, x, y) => {
                const event = new Event(type, { bubbles: true, cancelable: true });
                Object.assign(event, { pointerId: 8, pointerType: 'touch', button: 0, clientX: x, clientY: y });
                grip.dispatchEvent(event);
            };
            body.scrollTop = 50;
            dispatch('pointerdown', 20, 30);
            expect(fieldset.setPointerCapture).toHaveBeenCalledWith(8);
            dispatch('pointermove', 20, 10);
            expect(body.scrollTop).toBe(70);
            expect(document.querySelector('.settings-metric-ghost')).toBeNull();
            dispatch('pointerup', 20, 10);
            expect(api.settings.overviewMetricOrder[0]).toBe('utilization');

            dispatch('pointerdown', 20, 30);
            vi.advanceTimersByTime(300);
            dispatch('pointermove', 20, 5);
            expect(document.querySelector('.settings-metric-ghost')).not.toBeNull();
            dispatch('pointerup', 20, 5);
            expect(api.settings.overviewMetricOrder[0]).toBe('temperature');
        } finally {
            window.matchMedia = previousMatchMedia;
            vi.useRealTimers();
        }
    });

    it('cancels a metric drag without changing the saved order', () => {
        const fieldset = metricPanelRows();
        const api = loadSettingsModule();
        api.initSettingsPanel();
        fieldset.setPointerCapture = vi.fn();
        const first = fieldset.querySelector('[data-metric-order="utilization"]');
        const second = fieldset.querySelector('[data-metric-order="temperature"]');
        const grip = second.querySelector('.settings-metric-grip');
        second.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 20 });
        first.getBoundingClientRect = () => ({ left: 10, top: 0, width: 200, height: 20 });
        document.elementFromPoint = vi.fn(() => first);
        const dispatch = type => {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.assign(event, { pointerId: 9, pointerType: 'mouse', button: 0,
                clientX: 20, clientY: type === 'pointerdown' ? 30 : 5 });
            grip.dispatchEvent(event);
        };
        const before = localStorage.getItem(api.STORAGE_KEY);
        dispatch('pointerdown');
        dispatch('pointermove');
        expect(fieldset.querySelector('.settings-metric-row').dataset.metricOrder).toBe('temperature');
        dispatch('pointercancel');

        expect(fieldset.querySelector('.settings-metric-row').dataset.metricOrder).toBe('utilization');
        expect(document.querySelector('.settings-metric-ghost')).toBeNull();
        expect(localStorage.getItem(api.STORAGE_KEY)).toBe(before);
        expect(api.settings.overviewMetricOrder.slice(0, 2)).toEqual(['utilization', 'temperature']);
    });

    it('Escape cancels a metric drag without closing Settings or saving the order', () => {
        const fieldset = metricPanelRows();
        const api = loadSettingsModule();
        api.initSettingsPanel();
        document.getElementById('settings-open').click();
        fieldset.setPointerCapture = vi.fn();
        const first = fieldset.querySelector('[data-metric-order="utilization"]');
        const second = fieldset.querySelector('[data-metric-order="temperature"]');
        const grip = second.querySelector('.settings-metric-grip');
        first.getBoundingClientRect = () => ({ left: 10, top: 0, width: 200, height: 20 });
        second.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 20 });
        document.elementFromPoint = vi.fn(() => first);
        const dispatch = type => {
            const event = new Event(type, { bubbles: true, cancelable: true });
            Object.assign(event, { pointerId: 10, pointerType: 'mouse', button: 0,
                clientX: 20, clientY: type === 'pointerdown' ? 30 : 5 });
            grip.dispatchEvent(event);
        };
        const write = vi.spyOn(Storage.prototype, 'setItem');
        dispatch('pointerdown');
        dispatch('pointermove');
        expect(document.querySelector('.settings-metric-ghost')).not.toBeNull();
        expect(fieldset.querySelector('.settings-metric-row').dataset.metricOrder).toBe('temperature');

        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        document.body.dispatchEvent(escape);
        expect(escape.defaultPrevented).toBe(true);
        expect(document.getElementById('settings-panel').hidden).toBe(false);
        expect(fieldset.querySelector('.settings-metric-row').dataset.metricOrder).toBe('utilization');
        expect(document.querySelector('.settings-metric-ghost')).toBeNull();
        dispatch('pointerup');
        expect(write).not.toHaveBeenCalled();
        expect(api.settings.overviewMetricOrder.slice(0, 2)).toEqual(['utilization', 'temperature']);
    });

    it('restores the metric rows when saving their order fails', () => {
        const fieldset = metricPanelRows();
        const api = loadSettingsModule();
        api.initSettingsPanel();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('storage unavailable');
        });
        const grip = fieldset.querySelector('[data-metric-order="temperature"] .settings-metric-grip');
        grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }));

        expect(fieldset.querySelector('.settings-metric-row').dataset.metricOrder).toBe('utilization');
        expect(api.settings.overviewMetricOrder[0]).toBe('utilization');
        expect(document.getElementById('settings-status').textContent)
            .toBe('This order could not be saved. Try again.');
        expect(document.activeElement).toBe(grip);
    });

    it('is hidden until the gear opens it and restores focus when closed', () => {
        const openButton = document.getElementById('settings-open');
        const panel = document.getElementById('settings-panel');
        const overlay = document.getElementById('settings-overlay');
        const api = loadSettingsModule();
        api.initSettingsPanel();

        document.body.focus();
        expect(document.activeElement).toBe(document.body);
        openButton.click();
        expect(panel.hidden).toBe(false);
        expect(panel.hasAttribute('inert')).toBe(false);
        expect(panel.getAttribute('aria-hidden')).toBe('false');
        expect(overlay.hidden).toBe(false);
        expect(document.activeElement).toBe(document.getElementById('settings-close'));

        document.getElementById('settings-close').click();
        expect(panel.hidden).toBe(true);
        expect(panel.hasAttribute('inert')).toBe(true);
        expect(panel.getAttribute('aria-hidden')).toBe('true');
        expect(overlay.hidden).toBe(true);
        expect(openButton.getAttribute('aria-expanded')).toBe('false');
        expect(document.activeElement).toBe(openButton);
    });

    it('closes on Escape and outside click but not on a panel click', () => {
        const openButton = document.getElementById('settings-open');
        const panel = document.getElementById('settings-panel');
        const overlay = document.getElementById('settings-overlay');
        const api = loadSettingsModule();
        api.initSettingsPanel();

        openButton.click();
        panel.click();
        expect(panel.hidden).toBe(false);
        panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(panel.hidden).toBe(true);

        openButton.click();
        overlay.click();
        expect(panel.hidden).toBe(true);
    });

    it('releases sidebar focus after Escape when auto-hide is active', () => {
        const openButton = document.getElementById('settings-open');
        const panel = document.getElementById('settings-panel');
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const autoHide = document.getElementById('settings-sidebar-auto-hide');
        const blur = vi.spyOn(openButton, 'blur');

        autoHide.checked = true;
        autoHide.dispatchEvent(new Event('change'));
        openButton.click();
        panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        expect(panel.hidden).toBe(true);
        expect(blur).toHaveBeenCalledOnce();
        expect(document.activeElement).not.toBe(openButton);
        expect(document.documentElement.classList.contains('sidebar-auto-hide')).toBe(true);
        expect(source).toMatch(
            /settings\.sidebarAutoHide === true\) \{\s*openButton\.blur\(\);/
        );
        expect(layoutCss).toMatch(
            /html\.sidebar-auto-hide \.sidebar \{[\s\S]*?translateX\(calc\(-100% \+ 8px\)\)/
        );
        expect(layoutCss).toMatch(
            /html\.sidebar-auto-hide \.main \{\s*margin-left: 8px;/
        );
        expect(layoutCss).toMatch(
            /html\.sidebar-auto-hide \.sidebar:hover,\s*html\.sidebar-auto-hide \.sidebar:focus-within \{\s*transform: translateX\(0\);/
        );
    });

    it('keeps keyboard focus inside the open panel', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        document.getElementById('settings-open').click();
        const closeButton = document.getElementById('settings-close');
        const resetButton = document.getElementById('settings-reset');

        resetButton.focus();
        resetButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        expect(document.activeElement).toBe(closeButton);

        closeButton.focus();
        closeButton.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Tab', shiftKey: true, bubbles: true
        }));
        expect(document.activeElement).toBe(resetButton);
    });

    it('recovers focus and Escape handling after focus leaves the open panel', () => {
        const outsideButton = document.createElement('button');
        outsideButton.textContent = 'Outside';
        document.body.appendChild(outsideButton);
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const openButton = document.getElementById('settings-open');
        const panel = document.getElementById('settings-panel');

        openButton.click();
        outsideButton.focus();
        expect(document.activeElement).toBe(document.getElementById('settings-close'));

        outsideButton.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', bubbles: true, cancelable: true
        }));
        expect(panel.hidden).toBe(true);
        expect(document.activeElement).toBe(openButton);
    });

    it('removes both document-level modal handlers when the panel closes', () => {
        const remove = vi.spyOn(document, 'removeEventListener');
        const api = loadSettingsModule();
        api.initSettingsPanel();
        document.getElementById('settings-open').click();

        document.getElementById('settings-close').click();

        expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function));
        expect(remove).toHaveBeenCalledWith('focusin', expect.any(Function));
    });

    it('enables desktop body scrolling only when panel content exceeds the viewport', () => {
        const panel = document.getElementById('settings-panel');
        let scrollHeight = 1292;
        Object.defineProperty(panel, 'scrollHeight', { configurable: true, get: () => scrollHeight });
        Object.defineProperty(panel, 'clientHeight', { configurable: true, get: () => 900 });
        const api = loadSettingsModule();
        api.initSettingsPanel();

        document.getElementById('settings-open').click();
        expect(panel.classList.contains('settings-overflow')).toBe(true);

        scrollHeight = 800;
        api.updateSettingsPanelOverflow(document);
        expect(panel.classList.contains('settings-overflow')).toBe(false);
    });

    it('skips controls hidden by CSS when wrapping keyboard focus', () => {
        const hiddenLink = document.createElement('a');
        hiddenLink.href = '#';
        hiddenLink.style.display = 'none';
        hiddenLink.textContent = 'Hidden update';
        document.getElementById('settings-panel').appendChild(hiddenLink);
        const api = loadSettingsModule();
        api.initSettingsPanel();
        document.getElementById('settings-open').click();
        const closeButton = document.getElementById('settings-close');

        closeButton.focus();
        closeButton.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Tab', shiftKey: true, bubbles: true
        }));

        expect(document.activeElement).toBe(document.getElementById('settings-reset'));
    });

    it('shows whether reset succeeded without closing the panel', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { sidebarOrder: [JSON.stringify(['node-a', '0'])] }
        }));
        window.applySidebarOrder = vi.fn();
        window.applyDashboardOrder = vi.fn();
        const api = loadSettingsModule();
        api.initSettingsPanel();
        document.getElementById('settings-open').click();
        document.getElementById('settings-reset').click();

        expect(document.getElementById('settings-status').textContent).toBe('Settings reset.');
        expect(document.getElementById('settings-panel').hidden).toBe(false);
        expect(api.settings).toEqual(defaults);
        expect(window.applySidebarOrder).toHaveBeenCalledOnce();
        expect(window.applyDashboardOrder).toHaveBeenCalledOnce();
    });

    it('persists metric choices and applies them to every All page row', () => {
        document.body.insertAdjacentHTML('beforeend', `
            <div class="overview-gpu-card">
                <div data-overview-metric="temperature"></div>
                <div data-overview-metric="power"></div>
            </div>
            <div class="overview-gpu-card">
                <div data-overview-metric="temperature"></div>
                <div data-overview-metric="power"></div>
            </div>
        `);
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const temperature = document.querySelector('[data-overview-setting="temperature"]');

        expect(temperature.checked).toBe(true);
        temperature.click();

        expect(document.querySelectorAll('[data-overview-metric="temperature"]:not([hidden])'))
            .toHaveLength(0);
        expect(document.querySelectorAll('[data-overview-metric="power"]:not([hidden])'))
            .toHaveLength(2);
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY)).settings['overview.temperature'])
            .toBe(false);
    });

    it('keeps every extra metric off until the viewer selects it', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();

        expect(api.EXTRA_OVERVIEW_METRICS).toEqual([
            'fan-speed', 'graphics-clock', 'memory-clock', 'memory-used',
            'power-limit', 'memory-temperature', 'throttle-status', 'process-count',
            'pcie-generation', 'pcie-width', 'encoder-load', 'decoder-load',
            'performance-state'
        ]);
        for (const metric of api.EXTRA_OVERVIEW_METRICS) {
            expect(api.settings[`overview.${metric}`]).toBe(false);
            expect(document.querySelector(`[data-overview-setting="${metric}"]`).checked).toBe(false);
        }
        expect(api.visibleOverviewMetricCount()).toBe(4);
    });

    it('persists selected extras and measures the Behind metrics mask', () => {
        document.body.insertAdjacentHTML('beforeend', `
            <div class="overview-gpu-card">
                <div class="overview-metric" data-overview-metric="utilization"></div>
                <div class="overview-metric" data-overview-metric="temperature"></div>
                <div class="overview-metric" data-overview-metric="memory"></div>
                <div class="overview-metric" data-overview-metric="power"></div>
                <div class="overview-metric" data-overview-metric="fan-speed" hidden></div>
                <div class="overview-metric" data-overview-metric="graphics-clock" hidden></div>
                <div class="overview-mini-chart"></div>
            </div>
        `);
        const api = loadSettingsModule();
        api.initSettingsPanel();

        const card = document.querySelectorAll('.overview-gpu-card')[1];
        const metrics = card.querySelectorAll('[data-overview-metric]');
        const rectangles = [
            [100, 172], [212, 284], [324, 396], [436, 508], [548, 620], [660, 760]
        ];
        metrics.forEach((metric, index) => {
            metric.getBoundingClientRect = () => ({
                left: rectangles[index][0], right: rectangles[index][1], top: 10
            });
        });
        card.querySelector('.overview-mini-chart').getBoundingClientRect = () => ({ left: 100 });

        document.querySelector('[data-overview-setting="fan-speed"]').click();
        document.querySelector('[data-overview-setting="graphics-clock"]').click();

        expect(api.visibleOverviewMetricCount()).toBe(6);
        expect(card.dataset.overviewVisibleMetrics).toBe('6');
        expect(card.classList.contains('overview-has-extra-metrics')).toBe(true);
        expect(card.querySelector('[data-overview-metric="fan-speed"]').hidden).toBe(false);
        expect(card.querySelector('[data-overview-metric="graphics-clock"]').hidden).toBe(false);
        expect(card.style.getPropertyValue('--overview-chart-behind-fade-start'))
            .toBe('calc(660px + var(--overview-chart-behind-text-pad))');
        expect(card.style.getPropertyValue('--overview-chart-behind-fade-end'))
            .toBe('calc(var(--overview-chart-behind-fade-start) + var(--overview-metric-gap))');
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY)).settings)
            .toMatchObject({ 'overview.fan-speed': true, 'overview.graphics-clock': true });
    });

    it('starts the fade after the widest rendered text and spans one metric gap', () => {
        document.body.insertAdjacentHTML('beforeend', `
            <div class="overview-gpu-card">
                <div class="overview-metric" data-overview-metric="utilization"></div>
                <div class="overview-metric" data-overview-metric="temperature"></div>
                <div class="overview-metric" data-overview-metric="memory"></div>
                <div class="overview-metric" data-overview-metric="power">
                    <div class="overview-metric-value">13.3 GB</div>
                    <div class="overview-metric-label">MEMORY USED</div>
                </div>
                <div class="overview-mini-chart"></div>
            </div>
        `);
        const api = loadSettingsModule();
        document.documentElement.classList.add('overview-chart-width-behind');
        const card = document.querySelectorAll('.overview-gpu-card')[1];
        const metrics = card.querySelectorAll('.overview-metric');
        metrics.forEach((metric, index) => {
            metric.getBoundingClientRect = () => ({
                left: index * 112, right: index * 112 + 72, top: 10
            });
        });
        card.querySelector('.overview-mini-chart').getBoundingClientRect = () => ({ left: 0 });
        const createRange = document.createRange.bind(document);
        vi.spyOn(document, 'createRange').mockImplementation(() => {
            const range = createRange();
            range.getBoundingClientRect = () => ({ right: range.toString() === 'MEMORY USED' ? 432 : 390 });
            return range;
        });

        api.applyOverviewMetricVisibility(document);

        expect(card.style.getPropertyValue('--overview-chart-behind-fade-start'))
            .toBe('calc(432px + var(--overview-chart-behind-text-pad))');
        expect(card.style.getPropertyValue('--overview-chart-behind-fade-end'))
            .toBe('calc(var(--overview-chart-behind-fade-start) + var(--overview-metric-gap))');
        expect(tokensCss).toContain('--overview-chart-behind-text-pad: var(--space-xs);');
        expect(tokensCss).toContain('--overview-metric-gap: var(--space-xl);');
    });

    it.each([
        [5, 1440], [6, 1440], [5, 390], [6, 390]
    ])('keeps the chosen opacity when %i metrics wrap at %i px', (count, width) => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: {
                'overview.fan-speed': true,
                'overview.graphics-clock': count === 6,
                overviewMiniChartWidth: 'behind',
                overviewMiniChartBehindDim: 45
            }
        }));
        document.body.insertAdjacentHTML('beforeend', `
            <div class="overview-gpu-card">
                <div class="overview-metric" data-overview-metric="utilization"></div>
                <div class="overview-metric" data-overview-metric="temperature"></div>
                <div class="overview-metric" data-overview-metric="memory"></div>
                <div class="overview-metric" data-overview-metric="power"></div>
                <div class="overview-metric" data-overview-metric="fan-speed"></div>
                <div class="overview-metric" data-overview-metric="graphics-clock"></div>
                <div class="overview-mini-chart"></div>
            </div>
        `);
        const api = loadSettingsModule();
        const card = document.querySelectorAll('.overview-gpu-card')[1];
        const metrics = card.querySelectorAll('.overview-metric');
        metrics.forEach((metric, index) => {
            metric.getBoundingClientRect = () => ({ left: index * 80, right: index * 80 + 72,
                top: index >= (width === 390 ? 2 : 4) ? 50 : 10 });
        });
        const chart = card.querySelector('.overview-mini-chart');
        chart.getBoundingClientRect = () => ({ left: 0 });
        chart.style.maskImage = 'none';

        api.applyOverviewMetricVisibility(document);

        expect(card.classList.contains('overview-metrics-wrapped')).toBe(true);
        expect(chart.style.maskImage).toBe('');
        expect(document.documentElement.style.getPropertyValue('--overview-chart-behind-dim'))
            .toBe('0.45');
        expect(componentsCss).toMatch(
            /\.overview-metrics-wrapped:not\(\.overview-chart-hidden\) \.overview-mini-chart \{[^}]*-webkit-mask-image: linear-gradient\(to right,[^}]*var\(--overview-chart-behind-dim\)\) 0,[^}]*var\(--overview-chart-behind-dim\)\) 100%\);[^}]*mask-image: linear-gradient\(to right,[^}]*var\(--overview-chart-behind-dim\)\) 0,[^}]*var\(--overview-chart-behind-dim\)\) 100%\);/
        );

        metrics.forEach(metric => {
            metric.getBoundingClientRect = () => ({ left: 10, right: 82, top: 10 });
        });
        api.applyOverviewMetricVisibility(document);
        expect(card.classList.contains('overview-metrics-wrapped')).toBe(false);
        expect(card.style.getPropertyValue('--overview-chart-behind-fade-end'))
            .toBe('calc(var(--overview-chart-behind-fade-start) + var(--overview-metric-gap))');
    });

    it('fills a newly enabled metric from the latest GPU payload immediately', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const card = gpuCardElementFromMarkup(createCompactOverviewCard, 'fresh-0', {
            name: 'Test GPU', memory_total: 1, fan_speed: 67
        });
        document.body.appendChild(card);
        expect(card.querySelector('[data-overview-extra="fan-speed"] .overview-metric-value').textContent)
            .toBe('Not reported');

        document.querySelector('[data-overview-setting="fan-speed"]').click();

        expect(card.querySelector('[data-overview-extra="fan-speed"] .overview-metric-value').textContent)
            .toBe('67%');
    });

    it('keeps the previous choice when storage rejects a change', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });
        const power = document.querySelector('[data-overview-setting="power"]');

        power.click();

        expect(power.checked).toBe(true);
        expect(api.isOverviewMetricVisible('power')).toBe(true);
        expect(document.getElementById('settings-status').textContent)
            .toBe('This setting could not be saved. Try again.');
    });

    it('migrates the removed star prompt choice out of stored settings', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { showStarPrompt: false, theme: 'midnight' }
        }));
        const api = loadSettingsModule();
        expect(api.settings.theme).toBe('midnight');
        expect(api.settings).not.toHaveProperty('showStarPrompt');
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY)).settings)
            .toEqual({ ...defaults, theme: 'midnight' });
    });

    it('reset restores every metric and the chart column', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { ...defaults, 'overview.chart': false, 'overview.memory': false }
        }));
        document.body.insertAdjacentHTML('beforeend', `
            <div class="overview-gpu-card overview-chart-hidden">
                <div data-overview-metric="memory" hidden></div>
                <div data-overview-metric="chart" hidden></div>
            </div>
        `);
        const api = loadSettingsModule();
        api.initSettingsPanel();

        expect(document.querySelector('.overview-gpu-card').classList.contains('overview-chart-hidden'))
            .toBe(true);

        document.getElementById('settings-reset').click();

        expect(document.querySelectorAll('[data-overview-setting]:not(:checked)')).toHaveLength(13);
        expect(document.querySelectorAll('[data-overview-metric="memory"][hidden]')).toHaveLength(0);
        expect(document.querySelectorAll('[data-overview-metric="chart"][hidden]')).toHaveLength(0);
        expect(document.querySelector('.overview-gpu-card').classList.contains('overview-chart-hidden'))
            .toBe(false);
        expect(document.getElementById('settings-overview-chart-width').value).toBe('auto');
        expect(document.documentElement.classList.contains('overview-chart-width-wide')).toBe(false);
        expect(document.documentElement.classList.contains('overview-chart-width-full')).toBe(false);
        expect(document.documentElement.classList.contains('overview-chart-width-behind')).toBe(false);
        expect(document.documentElement.style.getPropertyValue('--overview-chart-behind-dim')).toBe('0.25');
    });

    it('persists a wider chart and asks the chart to resize', () => {
        const resize = vi.fn();
        const getChart = vi.fn(() => ({ resize }));
        const originalGetChart = Chart.getChart;
        Chart.getChart = getChart;
        try {
            const api = loadSettingsModule();
            api.initSettingsPanel();
            const select = document.getElementById('settings-overview-chart-width');

            select.value = 'wide';
            select.dispatchEvent(new Event('change'));

            expect(document.documentElement.classList.contains('overview-chart-width-wide')).toBe(true);
            expect(api.settings.overviewMiniChartWidth).toBe('wide');
            expect(getChart).toHaveBeenCalledWith(document.getElementById('overview-chart-0'));
            expect(resize).toHaveBeenCalledOnce();
        } finally {
            Chart.getChart = originalGetChart;
        }
    });

    it('applies Behind metrics before first paint with its chosen default strength', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { overviewMiniChartWidth: 'behind' }
        }));

        const api = loadSettingsModule();

        expect(api.settings.overviewMiniChartWidth).toBe('behind');
        expect(api.settings.overviewMiniChartBehindDim).toBe(25);
        expect(document.documentElement.classList.contains('overview-chart-width-behind')).toBe(true);
        expect(document.documentElement.style.getPropertyValue('--overview-chart-behind-dim')).toBe('0.25');
    });

    it('shows and persists the Behind metrics strength only for that width', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const width = document.getElementById('settings-overview-chart-width');
        const field = document.getElementById('settings-overview-chart-behind-dim-field');
        const dim = document.getElementById('settings-overview-chart-behind-dim');
        const value = document.getElementById('settings-overview-chart-behind-dim-value');

        expect(field.hidden).toBe(true);
        width.value = 'behind';
        width.dispatchEvent(new Event('change'));
        expect(field.hidden).toBe(false);

        dim.value = '45';
        dim.dispatchEvent(new Event('input'));
        expect(value.textContent).toBe('45%');
        dim.dispatchEvent(new Event('change'));

        expect(api.settings.overviewMiniChartBehindDim).toBe(45);
        expect(document.documentElement.style.getPropertyValue('--overview-chart-behind-dim')).toBe('0.45');
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY)).settings)
            .toMatchObject({ overviewMiniChartWidth: 'behind', overviewMiniChartBehindDim: 45 });

        width.value = 'full';
        width.dispatchEvent(new Event('change'));
        expect(field.hidden).toBe(true);
    });

    it.each([9, 101, 10.5])('rejects invalid Behind metrics strength %s', dim => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { overviewMiniChartBehindDim: dim }
        }));

        expect(loadSettingsModule().settings.overviewMiniChartBehindDim).toBe(25);
    });

    it('tracks the visible metric span for existing cards', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { 'overview.temperature': false, 'overview.power': false }
        }));
        const api = loadSettingsModule();
        api.initSettingsPanel();

        expect(api.visibleOverviewMetricCount()).toBe(2);
        expect(document.querySelector('.overview-gpu-card').dataset.overviewVisibleMetrics).toBe('2');

        const memory = document.querySelector('[data-overview-setting="memory"]');
        memory.checked = false;
        memory.dispatchEvent(new Event('change'));
        expect(document.querySelector('.overview-gpu-card').dataset.overviewVisibleMetrics).toBe('1');
    });

    it('sanitizes an unsupported chart width from the live change path', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const select = document.getElementById('settings-overview-chart-width');

        select.value = 'unsupported';
        select.dispatchEvent(new Event('change'));

        expect(select.value).toBe('auto');
        expect(api.settings.overviewMiniChartWidth).toBeUndefined();
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY)).settings)
            .toEqual(defaults);
    });

    it('applies one hide choice and keeps the bar open when it is off', () => {
        const api = loadSettingsModule();
        window.updateSidebarLabels = vi.fn();
        api.initSettingsPanel();
        const width = document.getElementById('settings-sidebar-width');
        const autoHide = document.getElementById('settings-sidebar-auto-hide');

        width.value = 'wide';
        width.dispatchEvent(new Event('change'));
        autoHide.checked = true;
        autoHide.dispatchEvent(new Event('change'));
        expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('96px');
        expect(document.documentElement.classList.contains('sidebar-auto-hide')).toBe(true);
        expect(api.settings.sidebarAutoHide).toBe(true);

        autoHide.checked = false;
        autoHide.dispatchEvent(new Event('change'));
        expect(api.settings.sidebarAutoHide).toBe(false);
        expect(document.documentElement.classList.contains('sidebar-auto-hide')).toBe(false);
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY)).settings.sidebarAutoHide).toBe(false);
    });

    it.each(['auto', 'wide', 'full', 'behind'])(
        'keeps the mini chart column removed at %s width when the chart is hidden',
        width => {
            localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
                version: 1,
                settings: {
                    'overview.chart': false,
                    overviewMiniChartWidth: width,
                    sidebarWidth: 'wide'
                }
            }));
            const api = loadSettingsModule();

            api.initSettingsPanel();

            expect(document.querySelector('.overview-gpu-card').classList)
                .toContain('overview-chart-hidden');
            expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('96px');
            expect(document.documentElement.classList.contains('overview-chart-width-wide'))
                .toBe(width === 'wide');
            expect(document.documentElement.classList.contains('overview-chart-width-full'))
                .toBe(width === 'full');
            expect(document.documentElement.classList.contains('overview-chart-width-behind'))
                .toBe(width === 'behind');
        }
    );

    it('renders connected label fields as text and allows duplicate display labels', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const nodeOutput = document.createElement('span');
        const gpuOutput = document.createElement('span');
        const secondGpuOutput = document.createElement('span');
        document.body.append(nodeOutput, gpuOutput, secondGpuOutput);
        const unsafeNode = '<img src=x onerror=alert(1)>';

        api.registerNodeLabelTarget(unsafeNode);
        api.registerGpuLabelTarget(unsafeNode, '0');
        api.registerGpuLabelTarget(unsafeNode, '1');
        api.bindNodeLabel(nodeOutput, unsafeNode);
        api.bindGpuLabel(gpuOutput, unsafeNode, '0');
        api.bindGpuLabel(secondGpuOutput, unsafeNode, '1');
        const inputs = document.querySelectorAll('#settings-label-list input');

        expect(inputs).toHaveLength(3);
        expect(document.querySelector('#settings-label-list img')).toBeNull();
        expect(document.getElementById('settings-label-list').textContent).toContain(unsafeNode);
        inputs[0].value = 'Shared label';
        inputs[0].dispatchEvent(new Event('change'));
        inputs[1].value = 'Shared label';
        inputs[1].dispatchEvent(new Event('change'));
        inputs[2].value = 'Shared label';
        inputs[2].dispatchEvent(new Event('change'));

        expect(nodeOutput.textContent).toBe('Shared label');
        expect(gpuOutput.textContent).toBe('Shared label');
        expect(secondGpuOutput.textContent).toBe('Shared label');
        expect(new Set([
            nodeOutput.dataset.displayLabelKey,
            gpuOutput.dataset.displayLabelKey,
            secondGpuOutput.dataset.displayLabelKey
        ])).toHaveProperty('size', 3);
        expect(api.settings.labelOverrides).toHaveLength(3);
    });

    it('groups the current names by displayed node and keeps overrides above the style', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const node = document.createElement('div');
        const gpu = document.createElement('button');
        document.body.append(node, gpu);
        api.registerNodeLabelTarget('node-a');
        api.registerGpuLabelTarget('node-a', '0');
        api.bindNodeLabel(node, 'node-a');
        api.bindGpuLabel(gpu, 'node-a', '0', '0');
        document.getElementById('settings-open').click();

        const group = document.querySelector('.settings-label-node');
        expect(group.dataset.node).toBe('node-a');
        expect(group.querySelector('h4').textContent).toBe('node-a');
        expect(Array.from(group.querySelectorAll('.settings-label-field span'), item => item.textContent))
            .toEqual(['Node name', 'GPU 0']);

        const gpuInput = group.querySelectorAll('input')[1];
        gpuInput.value = 'Training card';
        gpuInput.dispatchEvent(new Event('change'));
        expect(gpu.textContent).toBe('Training card');
        expect(group.querySelectorAll('.settings-label-field span')[1].textContent)
            .toBe('GPU 0');
        expect(group.querySelectorAll('input')[1]).toBe(gpuInput);

        const nodeInput = group.querySelectorAll('input')[0];
        nodeInput.value = 'Compute';
        nodeInput.dispatchEvent(new Event('change'));
        expect(group.querySelector('h4').textContent).toBe('Compute');
        expect(group.querySelectorAll('.settings-label-field span')[0].textContent)
            .toBe('Node name');
    });

    it('drops disconnected names from the panel without deleting saved overrides', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const node = document.createElement('div');
        document.body.append(node);
        api.registerNodeLabelTarget('node-a');
        api.bindNodeLabel(node, 'node-a');
        const input = document.querySelector('#settings-label-list input');
        input.value = 'Workstation';
        input.dispatchEvent(new Event('change'));
        node.remove();

        api.pruneLabelTargets(document);

        expect(document.querySelectorAll('#settings-label-list input')).toHaveLength(0);
        expect(api.settings.labelOverrides).toEqual([{ kind: 'node', node: 'node-a', label: 'Workstation' }]);
    });

    it('keeps an unfinished name edit when a different node disconnects', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const firstNode = document.createElement('span');
        const secondNode = document.createElement('span');
        document.body.append(firstNode, secondNode);
        api.registerNodeLabelTarget('node-a');
        api.registerNodeLabelTarget('node-b');
        api.bindNodeLabel(firstNode, 'node-a');
        api.bindNodeLabel(secondNode, 'node-b');
        document.getElementById('settings-open').click();
        const draftInput = document.querySelector('.settings-label-node[data-node="node-a"] input');
        draftInput.focus();
        draftInput.value = 'Still typing';
        const write = vi.spyOn(Storage.prototype, 'setItem');
        secondNode.remove();

        api.pruneLabelTargets(document);

        expect(document.querySelector('.settings-label-node[data-node="node-a"] input')).toBe(draftInput);
        expect(document.activeElement).toBe(draftInput);
        expect(draftInput.value).toBe('Still typing');
        expect(document.querySelector('.settings-label-node[data-node="node-b"]')).toBeNull();
        expect(write).not.toHaveBeenCalled();
        expect(api.settings.labelOverrides).toBeUndefined();
    });

    it('keeps a focused draft through a four-GPU node reconnect', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const firstNode = document.createElement('span');
        const secondNode = document.createElement('span');
        document.body.append(firstNode, secondNode);
        api.registerNodeLabelTarget('node-a');
        api.bindNodeLabel(firstNode, 'node-a');
        api.registerNodeLabelTarget('node-b');
        api.bindNodeLabel(secondNode, 'node-b');
        document.getElementById('settings-open').click();
        const draftInput = document.querySelector('.settings-label-node[data-node="node-a"] input');
        draftInput.focus();
        draftInput.value = 'Unfinished';
        draftInput.setSelectionRange(2, 6);
        const write = vi.spyOn(Storage.prototype, 'setItem');

        secondNode.remove();
        api.pruneLabelTargets(document);
        const returnedNode = document.createElement('span');
        document.body.append(returnedNode);
        api.registerNodeLabelTarget('node-b');
        api.bindNodeLabel(returnedNode, 'node-b');
        for (let gpu = 0; gpu < 4; gpu += 1) {
            const output = document.createElement('span');
            document.body.append(output);
            api.registerGpuLabelTarget('node-b', String(gpu));
            api.bindGpuLabel(output, 'node-b', String(gpu));
        }

        expect(document.querySelector('.settings-label-node[data-node="node-a"] input'))
            .toBe(draftInput);
        expect(document.activeElement).toBe(draftInput);
        expect(draftInput.value).toBe('Unfinished');
        expect(draftInput.selectionStart).toBe(2);
        expect(draftInput.selectionEnd).toBe(6);
        expect(document.querySelectorAll('.settings-label-node[data-node="node-b"] input'))
            .toHaveLength(5);
        expect(write).not.toHaveBeenCalled();
    });

    it('holds its own draft through disconnect without a detach commit', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const firstNode = document.createElement('span');
        const secondNode = document.createElement('span');
        document.body.append(firstNode, secondNode);
        api.registerNodeLabelTarget('node-a');
        api.bindNodeLabel(firstNode, 'node-a');
        api.registerNodeLabelTarget('node-b');
        api.bindNodeLabel(secondNode, 'node-b');
        document.getElementById('settings-open').click();
        const field = document.querySelector('.settings-label-node[data-node="node-b"] .settings-label-field');
        const input = field.querySelector('input');
        input.focus();
        input.value = 'Not confirmed';
        input.setSelectionRange(4, 8);
        const write = vi.spyOn(Storage.prototype, 'setItem');
        const originalRemove = Element.prototype.remove;
        vi.spyOn(Element.prototype, 'remove').mockImplementation(function () {
            if (this === field) input.dispatchEvent(new Event('change'));
            return originalRemove.call(this);
        });

        secondNode.remove();
        api.pruneLabelTargets(document);
        expect(write).not.toHaveBeenCalled();
        expect(api.settings.labelOverrides).toBeUndefined();

        const returnedNode = document.createElement('span');
        document.body.append(returnedNode);
        api.registerNodeLabelTarget('node-b');
        api.bindNodeLabel(returnedNode, 'node-b');
        const restored = document.querySelector('.settings-label-node[data-node="node-b"] input');
        expect(restored.value).toBe('Not confirmed');
        expect(restored.selectionStart).toBe(4);
        expect(restored.selectionEnd).toBe(8);
        expect(write).not.toHaveBeenCalled();

        restored.dispatchEvent(new Event('change'));
        expect(api.settings.labelOverrides).toEqual([
            { kind: 'node', node: 'node-b', label: 'Not confirmed' }
        ]);
    });

    it('holds a draft when the last displayed node disconnects', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const node = document.createElement('span');
        document.body.append(node);
        api.registerNodeLabelTarget('node-a');
        api.bindNodeLabel(node, 'node-a');
        document.getElementById('settings-open').click();
        const input = document.querySelector('#settings-label-list input');
        input.focus();
        input.value = 'Come back';
        const write = vi.spyOn(Storage.prototype, 'setItem');
        const list = document.getElementById('settings-label-list');
        const originalReplace = list.replaceChildren;
        vi.spyOn(list, 'replaceChildren').mockImplementation(function (...children) {
            input.dispatchEvent(new Event('change'));
            return originalReplace.apply(this, children);
        });

        node.remove();
        api.pruneLabelTargets(document);
        expect(write).not.toHaveBeenCalled();
        expect(list.textContent).toBe('');

        const returnedNode = document.createElement('span');
        document.body.append(returnedNode);
        api.registerNodeLabelTarget('node-a');
        api.bindNodeLabel(returnedNode, 'node-a');
        expect(list.querySelector('input').value).toBe('Come back');
        expect(write).not.toHaveBeenCalled();
    });

    it('does not replace an active field when the same GPU is reported again', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        api.registerGpuLabelTarget('node-a', '0');
        const input = document.querySelector('#settings-label-list input');
        input.value = 'Typing now';

        api.registerGpuLabelTarget('node-a', '0');

        expect(document.querySelector('#settings-label-list input')).toBe(input);
        expect(input.value).toBe('Typing now');
    });

    it('renders a stored label as text on its first binding', () => {
        const unsafeLabel = '<img src=x onerror=alert(1)>';
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: {
                labelOverrides: [{ kind: 'node', node: 'node-a', label: unsafeLabel }]
            }
        }));
        const api = loadSettingsModule();
        const output = document.createElement('span');
        document.body.appendChild(output);

        api.bindNodeLabel(output, 'node-a');

        expect(output.textContent).toBe(unsafeLabel);
        expect(output.querySelector('img')).toBeNull();
    });

    it('renders a label edit as text everywhere it is already displayed', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const nodeLabel = document.createElement('span');
        const cardHeading = document.createElement('h2');
        document.body.append(nodeLabel, cardHeading);
        api.registerNodeLabelTarget('node-a');
        api.bindNodeLabel(nodeLabel, 'node-a');
        api.bindNodeLabel(cardHeading, 'node-a');
        const input = document.querySelector('#settings-label-list input');

        input.value = '<img src=x onerror=alert(1)>';
        input.dispatchEvent(new Event('change'));

        expect(nodeLabel.textContent).toBe('<img src=x onerror=alert(1)>');
        expect(cardHeading.textContent).toBe('<img src=x onerror=alert(1)>');
        expect(nodeLabel.children).toHaveLength(0);
        expect(cardHeading.children).toHaveLength(0);
    });

    it('restores default labels on blank input and reset', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const output = document.createElement('span');
        document.body.appendChild(output);
        api.registerGpuLabelTarget('node-a', '0');
        api.bindGpuLabel(output, 'node-a', '0');
        let input = document.querySelector('#settings-label-list input');

        input.value = 'Training GPU';
        input.dispatchEvent(new Event('change'));
        expect(output.textContent).toBe('Training GPU');
        input.value = '   ';
        input.dispatchEvent(new Event('change'));
        expect(output.textContent).toBe('GPU 0');

        input = document.querySelector('#settings-label-list input');
        input.value = 'Training GPU';
        input.dispatchEvent(new Event('change'));
        document.getElementById('settings-reset').click();
        expect(output.textContent).toBe('GPU 0');
        expect(api.settings).toEqual(defaults);
        expect(document.querySelector('#settings-label-list input').value).toBe('');
    });

    it('restores separate text and tooltip defaults on the same control', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const button = document.createElement('button');
        document.body.appendChild(button);
        api.registerGpuLabelTarget('node-a', '0');
        api.bindGpuLabel(button, 'node-a', '0', '0');
        api.bindGpuLabel(button, 'node-a', '0', 'GPU node-a-0', 'title');
        const input = document.querySelector('#settings-label-list input');

        expect(button.textContent).toBe('0');
        expect(button.title).toBe('GPU node-a-0');
        input.value = 'Training card';
        input.dispatchEvent(new Event('change'));
        expect(button.textContent).toBe('Training card');
        expect(button.title).toBe('Training card');
        input.value = '';
        input.dispatchEvent(new Event('change'));
        expect(button.textContent).toBe('0');
        expect(button.title).toBe('GPU node-a-0');
    });

    it('keeps the prior label when storage rejects a change', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const output = document.createElement('span');
        document.body.appendChild(output);
        api.registerNodeLabelTarget('node-a');
        api.bindNodeLabel(output, 'node-a');
        const input = document.querySelector('#settings-label-list input');
        input.value = 'Existing label';
        input.dispatchEvent(new Event('change'));
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });

        input.value = 'New label';
        input.dispatchEvent(new Event('change'));

        expect(output.textContent).toBe('Existing label');
        expect(input.value).toBe('Existing label');
        expect(document.getElementById('settings-status').textContent)
            .toBe('Labels could not be saved. Try again.');
    });

    it('explains a reset failure and keeps the panel open', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        document.getElementById('settings-open').click();
        vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
            throw new Error('remove failed');
        });
        document.getElementById('settings-reset').click();

        expect(document.getElementById('settings-status').textContent)
            .toBe('Settings could not be reset. Try again.');
        expect(document.getElementById('settings-panel').hidden).toBe(false);
    });

    it('keeps connection details above the dashboard by default', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();

        expect(document.getElementById('settings-move-connection-details').checked).toBe(false);
        expect(document.getElementById('connection-details').parentElement.id)
            .toBe('dashboard-status-home');
        expect(document.getElementById('dashboard-status-home').hidden).toBe(false);
        expect(document.getElementById('settings-connection-details').hidden).toBe(true);
    });

    it('moves the existing live status and version into settings when selected', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const option = document.getElementById('settings-move-connection-details');

        option.checked = true;
        option.dispatchEvent(new Event('change'));
        document.getElementById('connection-status').textContent = 'Reconnecting...';
        document.getElementById('version-current').textContent = 'v2.0.0';

        expect(document.getElementById('connection-details').parentElement.id)
            .toBe('settings-connection-details');
        expect(document.getElementById('dashboard-status-home').hidden).toBe(true);
        expect(document.getElementById('settings-connection-details').hidden).toBe(false);
        expect(document.getElementById('connection-status').textContent).toBe('Reconnecting...');
        expect(document.getElementById('version-current').textContent).toBe('v2.0.0');
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY)).settings)
            .toEqual({ ...defaults, moveConnectionDetails: true });
    });

    it('applies a stored relocation and reset restores the default location', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { moveConnectionDetails: true }
        }));
        const api = loadSettingsModule();
        api.initSettingsPanel();
        expect(document.getElementById('connection-details').parentElement.id)
            .toBe('settings-connection-details');

        document.getElementById('settings-reset').click();

        expect(document.getElementById('connection-details').parentElement.id)
            .toBe('dashboard-status-home');
        expect(document.getElementById('settings-move-connection-details').checked).toBe(false);
        expect(localStorage.getItem(api.STORAGE_KEY)).toBeNull();
    });

    it('hides the dashboard location at module evaluation when relocation is stored', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { moveConnectionDetails: true }
        }));
        document.body.innerHTML = '';

        loadSettingsModule();

        expect(document.documentElement.classList.contains('settings-connection-in-panel'))
            .toBe(true);
    });

    it('keeps the current location when the option cannot be saved', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });
        const option = document.getElementById('settings-move-connection-details');
        option.checked = true;

        option.dispatchEvent(new Event('change'));

        expect(option.checked).toBe(false);
        expect(document.getElementById('connection-details').parentElement.id)
            .toBe('dashboard-status-home');
        expect(document.getElementById('settings-status').textContent)
            .toBe('This display change could not be saved. Try again.');
    });
});

describe('settings page contract', () => {
    it('loads settings in the head and provides one bottom-bar gear', () => {
        const parsed = new DOMParser().parseFromString(template, 'text/html');
        const settingsScript = parsed.querySelector('head script[src="/static/js/settings.js"]');
        const bottomBar = parsed.querySelector('.sidebar-bottom');
        const gear = bottomBar.querySelectorAll('#settings-open');

        expect(settingsScript).not.toBeNull();
        expect(gear).toHaveLength(1);
        expect(bottomBar.lastElementChild).toBe(gear[0]);
        expect(gear[0].getAttribute('aria-controls')).toBe('settings-panel');
    });

    it('offers only the default and two dark demonstration themes', () => {
        const parsed = new DOMParser().parseFromString(template, 'text/html');
        const options = Array.from(parsed.querySelectorAll('#settings-theme option'));

        expect(options.map(option => option.value)).toEqual([
            'default', 'midnight', 'high-contrast'
        ]);
        expect(tokensCss.match(/:root\[data-theme=/g)).toHaveLength(2);
        expect(tokensCss).not.toMatch(/data-theme=["']light/);
    });

    it('defines both demonstration themes through root data attributes', () => {
        expect(tokensCss).toMatch(/:root\[data-theme="midnight"\]\s*\{/);
        expect(tokensCss).toMatch(/:root\[data-theme="high-contrast"\]\s*\{/);
    });

    it('marks the slide-over as a hidden modal dialog', () => {
        const parsed = new DOMParser().parseFromString(template, 'text/html');
        const panel = parsed.getElementById('settings-panel');

        expect(panel.hidden).toBe(true);
        expect(panel.getAttribute('role')).toBe('dialog');
        expect(panel.getAttribute('aria-modal')).toBe('true');
        expect(panel.getAttribute('aria-labelledby')).toBe('settings-title');
    });

    it('provides one movable connection region and its setting', () => {
        const parsed = new DOMParser().parseFromString(template, 'text/html');
        const details = parsed.querySelectorAll('#connection-details');
        const option = parsed.querySelectorAll('#settings-move-connection-details');

        expect(details).toHaveLength(1);
        expect(option).toHaveLength(1);
        expect(details[0].parentElement.id).toBe('dashboard-status-home');
        expect(parsed.getElementById('settings-connection-details').hidden).toBe(true);
        expect(option[0].getAttribute('type')).toBe('checkbox');
    });

    it('offers each All page metric once', () => {
        const parsed = new DOMParser().parseFromString(template, 'text/html');
        const metrics = Array.from(parsed.querySelectorAll('[data-overview-setting]'))
            .map(input => input.dataset.overviewSetting);

        expect(metrics).toEqual([
            'utilization', 'temperature', 'memory', 'power', 'chart',
            'fan-speed', 'graphics-clock', 'memory-clock', 'memory-used',
            'power-limit', 'memory-temperature', 'throttle-status', 'process-count',
            'pcie-generation', 'pcie-width', 'encoder-load', 'decoder-load',
            'performance-state'
        ]);
        expect(new Set(metrics).size).toBe(18);
    });

    it('offers the four mini chart widths and the conditional opacity control once', () => {
        const parsed = new DOMParser().parseFromString(template, 'text/html');
        const select = parsed.getElementById('settings-overview-chart-width');

        expect(Array.from(select.options).map(option => option.value))
            .toEqual(['auto', 'wide', 'full', 'behind']);
        expect(parsed.querySelectorAll('#settings-overview-chart-behind-dim')).toHaveLength(1);
        expect(parsed.getElementById('settings-overview-chart-behind-dim-field').querySelector('span').textContent).toBe('Opacity');
        expect(parsed.getElementById('settings-overview-chart-behind-dim-field').hidden).toBe(true);
    });

    it('offers every left bar option inside settings', () => {
        const parsed = new DOMParser().parseFromString(template, 'text/html');
        expect(Array.from(parsed.getElementById('settings-sidebar-width').options)
            .map(option => option.value)).toEqual(['standard', 'comfortable', 'wide']);
        expect(Array.from(parsed.getElementById('settings-sidebar-label').options)
            .map(option => option.value)).toEqual(['index', 'node-index', 'short-name']);
        expect(parsed.getElementById('settings-sidebar-label').closest('#settings-label-list')).toBeNull();
        expect(parsed.getElementById('settings-sidebar-label').closest('[aria-labelledby="settings-labels-title"]'))
            .not.toBeNull();
        expect(parsed.getElementById('settings-labels-title').textContent).toBe('Names');
        expect(parsed.getElementById('settings-sidebar-auto-hide')).not.toBeNull();
        expect(parsed.getElementById('settings-sidebar-auto-hide').parentElement.textContent)
            .toContain('Hide the left bar when not in use');
        expect(parsed.getElementById('settings-sidebar-pinned')).toBeNull();
    });

    it('uses five grouped sections with one heading shape and no helper copy', () => {
        const parsed = new DOMParser().parseFromString(template, 'text/html');
        const sections = Array.from(parsed.querySelectorAll('.settings-body > .settings-group'));

        expect(sections.map(section => section.querySelector('h3').textContent))
            .toEqual(['General', 'All page metrics', 'Left bar', 'Names', 'Event notices']);
        expect(parsed.querySelectorAll('fieldset, legend')).toHaveLength(0);
        expect(sections[0].querySelector('#settings-theme')).not.toBeNull();
        expect(sections[0].querySelector('#settings-move-connection-details')).not.toBeNull();
        expect(parsed.getElementById('settings-show-star-prompt')).toBeNull();
        expect(Array.from(sections[0].querySelectorAll('select, input'), control => control.id))
            .toEqual(['settings-theme', 'settings-move-connection-details']);
        expect(sections[0].querySelector('[for="settings-move-connection-details"] span').textContent)
            .toBe('Move connection details into this panel');
        expect(parsed.querySelectorAll('.settings-body .settings-help')).toHaveLength(0);
        expect(parsed.querySelectorAll('.settings-body .settings-note')).toHaveLength(1);
        expect(sections[1].querySelector('.settings-note').textContent).toBe('Drag to reorder');
        expect(sections[1].querySelector('#settings-overview-chart-width')).not.toBeNull();
        expect(sections[1].querySelector('#settings-overview-chart-behind-dim')).not.toBeNull();
        expect(sections[1].querySelector('.settings-metric-list').children).toHaveLength(20);
        expect(sections[1].querySelector('[data-overview-setting="chart"]')
            .closest('.settings-chart-row')).not.toBeNull();
        expect(sections[1].querySelector('.settings-subgroup-after').children).toHaveLength(2);
    });

    it('gives every section the grouped-card style and every select the same row shape', () => {
        const page = new JSDOM(template, { pretendToBeVisual: true });
        try {
            const style = page.window.document.createElement('style');
            style.textContent = componentsCss;
            page.window.document.head.appendChild(style);

            const sections = Array.from(page.window.document.querySelectorAll('.settings-body > .settings-group'));
            for (const section of sections) {
                const heading = section.querySelector('h3');
                const headingStyle = page.window.getComputedStyle(heading);
                const sectionStyle = page.window.getComputedStyle(section);
                expect(headingStyle.fontWeight).toBe('600');
                expect(headingStyle.letterSpacing).toBe('0.10em');
                expect(sectionStyle.gridTemplateColumns).toBe('minmax(0, 1fr)');
            }
            const selectIds = ['settings-theme', 'settings-overview-chart-width',
                'settings-sidebar-width', 'settings-sidebar-label'];
            selectIds.forEach(id => {
                const field = page.window.document.getElementById(id).closest('.settings-row-select');
                expect(page.window.getComputedStyle(field).display).toBe('grid');
                expect(page.window.getComputedStyle(field).gridTemplateColumns)
                    .toBe('minmax(0, 1fr) minmax(0, 190px)');
            });
            const chartRow = page.window.document.querySelector('.settings-chart-row');
            expect(page.window.getComputedStyle(chartRow).paddingLeft).toBe('22px');
        } finally {
            page.window.close();
        }
    });

    it('uses the full viewport width at phone size', () => {
        expect(componentsCss).toMatch(
            /@media \(max-width: 768px\), \(max-height: 480px\) and \(orientation: landscape\)[\s\S]*?\.settings-panel \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100vw;/
        );
    });

    it('keeps the hidden panel out of layout', () => {
        expect(componentsCss).toMatch(
            /\.settings-panel\[hidden\] \{\s*display: none;\s*\}/
        );
    });

    it('keeps relocated connection details within the phone-width panel', () => {
        expect(componentsCss).toMatch(
            /@media \(max-width: 768px\), \(max-height: 480px\) and \(orientation: landscape\)[\s\S]*?\.settings-connection-details \.header-row \{[\s\S]*?width: 100%;/
        );
    });

    it('hides the original connection location before it can paint', () => {
        expect(componentsCss).toMatch(
            /html\.settings-connection-in-panel #dashboard-status-home \{\s*display: none;\s*\}/
        );
    });

    it('keeps hidden metrics out of layout and removes the hidden chart column', () => {
        expect(componentsCss).toMatch(
            /\[data-overview-metric\]\[hidden\] \{\s*display: none;\s*\}/
        );
        expect(componentsCss).toMatch(
            /\.overview-gpu-card\.overview-chart-hidden \{\s*grid-template-columns: 180px 1fr;\s*\}/
        );
        expect(componentsCss).toMatch(
            /@media \(max-width: 768px\), \(max-height: 480px\) and \(orientation: landscape\)[\s\S]*?\.overview-gpu-card\.overview-chart-hidden \{\s*grid-template-columns: 1fr;\s*\}/
        );
    });

    it('defines wider and full-row chart layouts only above phone width', () => {
        expect(componentsCss).toMatch(
            /@media \(min-width: 1201px\)[\s\S]*?overview-chart-width-wide[\s\S]*?180px 1fr 320px;/
        );
        expect(componentsCss).toMatch(
            /@media \(min-width: 1201px\)[\s\S]*?overview-chart-width-full[\s\S]*?180px 1fr;/
        );
        expect(componentsCss).toMatch(
            /@media \(min-width: 769px\)[\s\S]*?overview-chart-width-full \.overview-mini-chart \{[\s\S]*?grid-column: 1 \/ -1;/
        );
        expect(componentsCss).toMatch(
            /@media \(min-width: 1201px\)[\s\S]*?html \.overview-gpu-card\.overview-chart-hidden \{\s*grid-template-columns: 180px 1fr;/
        );
        expect(componentsCss).toMatch(
            /@media \(min-width: 769px\) and \(max-width: 1200px\)[\s\S]*?html \.overview-gpu-card\.overview-chart-hidden \{\s*grid-template-columns: 140px 1fr;/
        );
    });

    it('layers Behind metrics only on desktop and respects the visible metric count', () => {
        expect(tokensCss).toMatch(/--overview-chart-behind-dim: 0\.25;/);
        expect(tokensCss).toMatch(/--overview-chart-behind-text-pad: var\(--space-xs\);/);
        expect(tokensCss).not.toContain('--overview-chart-behind-lead-in');
        expect(tokensCss).toMatch(
            /--overview-chart-behind-fade-start: calc\([^;]*var\(--overview-metric-width\)[^;]*var\(--overview-chart-behind-text-pad\)\);/
        );
        expect(componentsCss).toMatch(
            /overview-chart-width-behind \.overview-metrics \{[^}]*z-index: 2;[^}]*\}/
        );
        expect(componentsCss).toMatch(
            /@media \(min-width: 769px\)[\s\S]*?overview-chart-width-behind \.overview-mini-chart \{[\s\S]*?grid-column: 2 \/ 4;[\s\S]*?mask-image:/
        );
        expect(componentsCss).toMatch(
            /data-overview-visible-metrics="1"[\s\S]*?--overview-chart-behind-fade-start: calc\(var\(--overview-metric-width\) \+ var\(--overview-chart-behind-text-pad\)\);[\s\S]*?--overview-chart-behind-fade-end: calc\(var\(--overview-chart-behind-fade-start\) \+ var\(--overview-metric-gap\)\);/
        );
        expect(componentsCss).toMatch(
            /data-overview-visible-metrics="2"[\s\S]*?--overview-chart-behind-fade-start: calc\(var\(--overview-metric-width\) \+ var\(--overview-metric-gap\) \+ var\(--overview-metric-width\) \+ var\(--overview-chart-behind-text-pad\)\);[\s\S]*?--overview-chart-behind-fade-end: calc\(var\(--overview-chart-behind-fade-start\) \+ var\(--overview-metric-gap\)\);/
        );
        expect(componentsCss).toMatch(
            /data-overview-visible-metrics="3"[\s\S]*?--overview-chart-behind-fade-start: calc\(var\(--overview-metric-width\) \+ var\(--overview-metric-gap\) \+ var\(--overview-metric-width\) \+ var\(--overview-metric-gap\) \+ var\(--overview-metric-width\) \+ var\(--overview-chart-behind-text-pad\)\);[\s\S]*?--overview-chart-behind-fade-end: calc\(var\(--overview-chart-behind-fade-start\) \+ var\(--overview-metric-gap\)\);/
        );
        expect(componentsCss).toMatch(
            /data-overview-visible-metrics="4"[\s\S]*?--overview-chart-behind-fade-start: calc\(var\(--overview-metric-width\)[^;]*var\(--overview-chart-behind-text-pad\)\);[\s\S]*?--overview-chart-behind-fade-end: calc\(var\(--overview-chart-behind-fade-start\) \+ var\(--overview-metric-gap\)\);/
        );
        expect(componentsCss).toMatch(
            /data-overview-visible-metrics="0"[\s\S]*?\.overview-mini-chart \{[\s\S]*?grid-column: 3;[\s\S]*?mask-image: none;/
        );
        expect(componentsCss).toMatch(
            /@media \(max-width: 768px\), \(max-height: 480px\) and \(orientation: landscape\)[\s\S]*?overview-chart-width-behind \.overview-mini-chart \{[^}]*grid-column: 1;[^}]*grid-row: auto;[^}]*z-index: auto;[^}]*pointer-events: auto;[^}]*mask-image: none;/
        );
        expect(componentsCss).toMatch(
            /overview-chart-width-behind \.overview-gpu-name,\s*html\.overview-chart-width-behind \.overview-metrics \{[^}]*grid-column: auto;[^}]*grid-row: auto;[^}]*z-index: auto;[^}]*\}/
        );
    });

    it('keeps left bar width and auto-hide effects out of the phone layout', () => {
        expect(layoutCss).toMatch(/\.sidebar \{[\s\S]*?width: var\(--sidebar-width\);/);
        expect(layoutCss).toMatch(
            /@media \(max-width: 768px\), \(max-height: 480px\) and \(orientation: landscape\)[\s\S]*?\.sidebar-btn \{\s*width: 40px;/
        );
        expect(layoutCss).toMatch(
            /@media \(max-width: 768px\), \(max-height: 480px\) and \(orientation: landscape\)[\s\S]*?html\.sidebar-auto-hide \.main,[\s\S]*?margin-left: 0;/
        );
    });

    it('makes every phone navigation button horizontally reachable', () => {
        expect(layoutCss).toMatch(
            /@media \(max-width: 768px\), \(max-height: 480px\) and \(orientation: landscape\)[\s\S]*?\.sidebar-nav \{[\s\S]*?overflow-x: auto;[\s\S]*?overflow-y: hidden;/
        );
        expect(layoutCss).toMatch(
            /@media \(max-width: 768px\), \(max-height: 480px\) and \(orientation: landscape\)[\s\S]*?\.sidebar-bottom \{[\s\S]*?flex-direction: row;/
        );
    });

    it('keeps the settings body scrollable within the dynamic viewport', () => {
        expect(componentsCss).toMatch(
            /\.settings-panel \{[\s\S]*?height: 100vh;[\s\S]*?height: 100dvh;/
        );
        expect(componentsCss).toMatch(
            /@media \(max-width: 768px\), \(max-height: 480px\) and \(orientation: landscape\)[\s\S]*?\.settings-body \{[\s\S]*?flex: 1;[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/
        );
        const baseBody = componentsCss.match(/\.settings-body \{([\s\S]*?)\}/)?.[1];
        expect(baseBody).not.toContain('overflow-y: auto');
    });

    it('keeps system readouts visible and metrics packed in phone landscape', () => {
        const responsiveBlock = componentsCss.match(
            /@media \(max-width: 768px\), \(max-height: 480px\) and \(orientation: landscape\) \{([\s\S]*?)\n\}/
        )?.[1];
        const landscapeBlock = componentsCss.match(
            /@media \(max-height: 480px\) and \(orientation: landscape\) \{([\s\S]*?)\n\}/
        )?.[1];

        expect(responsiveBlock).toMatch(/\.system-info \{[\s\S]*?flex-direction: row;/);
        expect(responsiveBlock).toMatch(/\.system-metric \{[\s\S]*?width: auto;/);
        expect(landscapeBlock).not.toContain('repeat(4, minmax(0, 1fr))');
    });

    it('keeps the system readouts inside the phone bar and reserves the same viewport space', () => {
        const responsiveBlock = layoutCss.match(
            /@media \(max-width: 768px\), \(max-height: 480px\) and \(orientation: landscape\) \{([\s\S]*?)\n\}/
        )?.[1];
        const componentBlock = componentsCss.match(
            /@media \(max-width: 768px\), \(max-height: 480px\) and \(orientation: landscape\) \{([\s\S]*?)\n\}/
        )?.[1];

        expect(responsiveBlock).toContain('--phone-sidebar-height: 56px');
        expect(responsiveBlock).toMatch(/\.sidebar \{[\s\S]*?height: var\(--phone-sidebar-height\);/);
        expect(responsiveBlock).toMatch(/\.main \{[\s\S]*?margin-bottom: var\(--phone-sidebar-height\);/);
        expect(componentBlock).toMatch(/\.system-info \{[\s\S]*?max-height: 100%;/);
        expect(componentBlock).toMatch(/\.system-metric \{[\s\S]*?max-height: 100%;/);
    });

    it('stacks overview cards and wraps names in phone landscape', () => {
        expect(componentsCss).toMatch(
            /@media \(max-height: 480px\) and \(orientation: landscape\)[\s\S]*?\.overview-gpu-card,[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
        );
        expect(componentsCss).toMatch(
            /@media \(max-height: 480px\) and \(orientation: landscape\)[\s\S]*?\.overview-gpu-name p\.gpu-uuid \{[\s\S]*?overflow-wrap: anywhere;/
        );
    });
});
