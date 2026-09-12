import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
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
    theme: 'default',
    showStarPrompt: true,
    overviewMiniChartBehindDim: 30,
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
            <select id="settings-overview-chart-width">
                <option value="auto">Automatic</option>
                <option value="wide">Wide</option>
                <option value="full">Full row</option>
                <option value="behind">Behind metrics</option>
            </select>
            <label id="settings-overview-chart-behind-dim-field" hidden>
                <input id="settings-overview-chart-behind-dim" type="range" min="10" max="100" value="30">
                <output id="settings-overview-chart-behind-dim-value">30%</output>
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
            <input id="settings-sidebar-pinned" type="checkbox">
            <select id="settings-theme">
                <option value="default">Default</option>
                <option value="midnight">Midnight</option>
                <option value="high-contrast">High contrast</option>
            </select>
            <input type="checkbox" data-notice-setting="noticeGpuThrottle">
            <input type="checkbox" data-notice-setting="noticeGpuMissing">
            <input type="checkbox" data-notice-setting="noticeNodeOffline">
            <input type="checkbox" data-notice-setting="noticeExternalFanStopped">
            <input id="settings-show-star-prompt" type="checkbox">
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
            <div class="overview-mini-chart" data-overview-metric="chart">
                <canvas id="overview-chart-0"></canvas>
            </div>
        </div>
    `;
}

function loadSettingsModule() {
    delete window.GPUHotSettings;
    vm.runInThisContext(source, { filename: 'settings.js' });
    return window.GPUHotSettings;
}

describe('settings storage', () => {
    beforeEach(() => {
        localStorage.clear();
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
        delete window.setStarPromptEnabled;
    });
    afterEach(() => { vi.restoreAllMocks(); });

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

    it('resets the composed notice, star, and Behind metrics settings together', () => {
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
        const setStarPromptEnabled = vi.fn();
        window.GPUHotNotices = { settingsChanged };
        window.setStarPromptEnabled = setStarPromptEnabled;
        const api = loadSettingsModule();

        document.getElementById('settings-reset').click();

        expect(api.settings).toEqual(defaults);
        expect(Array.from(document.querySelectorAll('[data-notice-setting]'))
            .every(input => input.checked === false)).toBe(true);
        expect(document.getElementById('settings-show-star-prompt').checked).toBe(true);
        expect(document.getElementById('settings-overview-chart-width').value).toBe('auto');
        expect(document.getElementById('settings-overview-chart-behind-dim').value).toBe('30');
        expect(document.documentElement.classList.contains('overview-chart-width-behind')).toBe(false);
        expect(document.documentElement.style.getPropertyValue('--overview-chart-behind-dim')).toBe('0.3');
        expect(localStorage.getItem('gpu-hot.notices.v1')).toBe('saved history');
        expect(localStorage.getItem('gpuHotStarPromptDismissed')).toBe('true');
        expect(settingsChanged).toHaveBeenCalledOnce();
        expect(setStarPromptEnabled).toHaveBeenCalledWith(true);
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

    it('validates and applies stored left bar settings before the page is ready', () => {
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
            sidebarAutoHide: true,
            sidebarPinned: true
        });
        expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('72px');
        expect(document.documentElement.classList.contains('sidebar-auto-hide')).toBe(true);
        expect(document.documentElement.classList.contains('sidebar-pinned')).toBe(true);
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
    afterEach(() => { vi.restoreAllMocks(); });

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

    it('releases sidebar focus after Escape when unpinned auto-hide is active', () => {
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
        expect(document.documentElement.classList.contains('sidebar-pinned')).toBe(false);
        expect(source).toMatch(
            /settings\.sidebarAutoHide === true && settings\.sidebarPinned !== true\) \{\s*openButton\.blur\(\);/
        );
        expect(layoutCss).toMatch(
            /html\.sidebar-auto-hide:not\(\.sidebar-pinned\) \.sidebar \{[\s\S]*?translateX\(calc\(-100% \+ 8px\)\)/
        );
        expect(layoutCss).toMatch(
            /html\.sidebar-auto-hide:not\(\.sidebar-pinned\) \.main \{\s*margin-left: 8px;/
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
            .toBe('calc(560px + var(--overview-chart-behind-lead-in))');
        expect(card.style.getPropertyValue('--overview-chart-behind-fade-end'))
            .toBe('calc(660px + var(--overview-chart-behind-lead-in))');
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY)).settings)
            .toMatchObject({ 'overview.fan-speed': true, 'overview.graphics-clock': true });
    });

    it('removes the Behind metrics mask when visible metrics wrap', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { 'overview.fan-speed': true }
        }));
        document.body.insertAdjacentHTML('beforeend', `
            <div class="overview-gpu-card">
                <div class="overview-metric" data-overview-metric="utilization"></div>
                <div class="overview-metric" data-overview-metric="temperature"></div>
                <div class="overview-metric" data-overview-metric="memory"></div>
                <div class="overview-metric" data-overview-metric="power"></div>
                <div class="overview-metric" data-overview-metric="fan-speed"></div>
                <div class="overview-mini-chart"></div>
            </div>
        `);
        const api = loadSettingsModule();
        const card = document.querySelectorAll('.overview-gpu-card')[1];
        const metrics = card.querySelectorAll('.overview-metric');
        metrics.forEach((metric, index) => {
            metric.getBoundingClientRect = () => ({ left: index * 80, right: index * 80 + 72,
                top: index === metrics.length - 1 ? 50 : 10 });
        });
        card.querySelector('.overview-mini-chart').getBoundingClientRect = () => ({ left: 0 });

        api.applyOverviewMetricVisibility(document);

        expect(card.querySelector('.overview-mini-chart').style.maskImage).toBe('none');
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

    it('stores the star prompt choice and applies it immediately', () => {
        const setEnabled = vi.fn();
        window.setStarPromptEnabled = setEnabled;
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const control = document.getElementById('settings-show-star-prompt');

        expect(control.checked).toBe(true);
        control.click();

        expect(api.settings.showStarPrompt).toBe(false);
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY)).settings.showStarPrompt).toBe(false);
        expect(setEnabled).toHaveBeenCalledWith(false);
    });

    it('reset restores the star prompt choice to on', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { showStarPrompt: false }
        }));
        const setEnabled = vi.fn();
        window.setStarPromptEnabled = setEnabled;
        const api = loadSettingsModule();
        api.initSettingsPanel();

        expect(document.getElementById('settings-show-star-prompt').checked).toBe(false);
        document.getElementById('settings-reset').click();

        expect(api.settings.showStarPrompt).toBe(true);
        expect(document.getElementById('settings-show-star-prompt').checked).toBe(true);
        expect(setEnabled).toHaveBeenCalledWith(true);
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
        expect(document.documentElement.style.getPropertyValue('--overview-chart-behind-dim')).toBe('0.3');
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
        expect(api.settings.overviewMiniChartBehindDim).toBe(30);
        expect(document.documentElement.classList.contains('overview-chart-width-behind')).toBe(true);
        expect(document.documentElement.style.getPropertyValue('--overview-chart-behind-dim')).toBe('0.3');
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

        expect(loadSettingsModule().settings.overviewMiniChartBehindDim).toBe(30);
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

    it('applies left bar settings and clears a pin when auto-hide is turned off', () => {
        const api = loadSettingsModule();
        window.updateSidebarLabels = vi.fn();
        api.initSettingsPanel();
        const width = document.getElementById('settings-sidebar-width');
        const autoHide = document.getElementById('settings-sidebar-auto-hide');
        const pinned = document.getElementById('settings-sidebar-pinned');

        width.value = 'wide';
        width.dispatchEvent(new Event('change'));
        autoHide.checked = true;
        autoHide.dispatchEvent(new Event('change'));
        pinned.checked = true;
        pinned.dispatchEvent(new Event('change'));
        expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('96px');
        expect(document.documentElement.classList.contains('sidebar-pinned')).toBe(true);

        autoHide.checked = false;
        autoHide.dispatchEvent(new Event('change'));
        expect(pinned.checked).toBe(false);
        expect(pinned.disabled).toBe(true);
        expect(api.settings.sidebarPinned).toBe(false);
        expect(document.documentElement.classList.contains('sidebar-pinned')).toBe(false);
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

    it('offers the four mini chart widths and the conditional strength control once', () => {
        const parsed = new DOMParser().parseFromString(template, 'text/html');
        const select = parsed.getElementById('settings-overview-chart-width');

        expect(Array.from(select.options).map(option => option.value))
            .toEqual(['auto', 'wide', 'full', 'behind']);
        expect(parsed.querySelectorAll('#settings-overview-chart-behind-dim')).toHaveLength(1);
        expect(parsed.getElementById('settings-overview-chart-behind-dim-field').hidden).toBe(true);
    });

    it('offers every left bar option inside settings', () => {
        const parsed = new DOMParser().parseFromString(template, 'text/html');
        expect(Array.from(parsed.getElementById('settings-sidebar-width').options)
            .map(option => option.value)).toEqual(['standard', 'comfortable', 'wide']);
        expect(Array.from(parsed.getElementById('settings-sidebar-label').options)
            .map(option => option.value)).toEqual(['index', 'node-index', 'short-name']);
        expect(parsed.getElementById('settings-sidebar-auto-hide')).not.toBeNull();
        expect(parsed.getElementById('settings-sidebar-pinned')).not.toBeNull();
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
        expect(tokensCss).toMatch(/--overview-chart-behind-dim: 0\.3;/);
        expect(tokensCss).toMatch(/--overview-chart-behind-lead-in: 32px;/);
        expect(tokensCss).toMatch(
            /--overview-chart-behind-fade-start: calc\([^;]*var\(--overview-chart-behind-lead-in\)\);/
        );
        expect(componentsCss).toMatch(
            /overview-chart-width-behind \.overview-metrics \{[^}]*z-index: 2;[^}]*\}/
        );
        expect(componentsCss).toMatch(
            /@media \(min-width: 769px\)[\s\S]*?overview-chart-width-behind \.overview-mini-chart \{[\s\S]*?grid-column: 2 \/ 4;[\s\S]*?mask-image:/
        );
        expect(componentsCss).toMatch(
            /data-overview-visible-metrics="1"[\s\S]*?--overview-chart-behind-fade-start: var\(--overview-chart-behind-lead-in\);[\s\S]*?--overview-chart-behind-fade-end: calc\(var\(--overview-chart-behind-fade-start\) \+ var\(--overview-metric-width\)\);/
        );
        expect(componentsCss).toMatch(
            /data-overview-visible-metrics="2"[\s\S]*?--overview-chart-behind-fade-start: calc\(var\(--overview-metric-width\) \+ var\(--overview-metric-gap\) \+ var\(--overview-chart-behind-lead-in\)\);[\s\S]*?--overview-chart-behind-fade-end: calc\(var\(--overview-chart-behind-fade-start\) \+ var\(--overview-metric-width\)\);/
        );
        expect(componentsCss).toMatch(
            /data-overview-visible-metrics="3"[\s\S]*?--overview-chart-behind-fade-start: calc\(var\(--overview-metric-width\) \+ var\(--overview-metric-gap\) \+ var\(--overview-metric-width\) \+ var\(--overview-metric-gap\) \+ var\(--overview-chart-behind-lead-in\)\);[\s\S]*?--overview-chart-behind-fade-end: calc\(var\(--overview-chart-behind-fade-start\) \+ var\(--overview-metric-width\)\);/
        );
        expect(componentsCss).toMatch(
            /data-overview-visible-metrics="4"[\s\S]*?--overview-chart-behind-fade-start: calc\(var\(--overview-metric-width\)[^;]*var\(--overview-chart-behind-lead-in\)\);[\s\S]*?--overview-chart-behind-fade-end: calc\(var\(--overview-chart-behind-fade-start\) \+ var\(--overview-metric-width\)\);/
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
            /@media \(max-width: 768px\), \(max-height: 480px\) and \(orientation: landscape\)[\s\S]*?html\.sidebar-auto-hide:not\(\.sidebar-pinned\) \.main,[\s\S]*?margin-left: 0;/
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
