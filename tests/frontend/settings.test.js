import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const testDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(testDir, '../../static/js/settings.js'), 'utf8');
const template = readFileSync(join(testDir, '../../templates/index.html'), 'utf8');
const componentsCss = readFileSync(join(testDir, '../../static/css/components.css'), 'utf8');
const defaults = {
    'overview.utilization': true,
    'overview.temperature': true,
    'overview.memory': true,
    'overview.power': true,
    'overview.chart': true
};

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
            <button id="settings-reset">Reset settings</button>
            <p id="settings-status"></p>
        </aside>
        <div id="dashboard-status-home">
            <div id="connection-details">
                <span id="connection-status">Connected</span>
                <span id="version-current">v1.9.2</span>
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
        document.documentElement.classList.remove('settings-connection-in-panel');
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

describe('settings panel', () => {
    beforeEach(() => {
        localStorage.clear();
        panelMarkup();
        document.documentElement.classList.remove('settings-connection-in-panel');
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
        const api = loadSettingsModule();
        api.initSettingsPanel();
        document.getElementById('settings-open').click();
        document.getElementById('settings-reset').click();

        expect(document.getElementById('settings-status').textContent).toBe('Settings reset.');
        expect(document.getElementById('settings-panel').hidden).toBe(false);
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

        expect(document.querySelectorAll('[data-overview-setting]:not(:checked)')).toHaveLength(0);
        expect(document.querySelectorAll('[data-overview-metric][hidden]')).toHaveLength(0);
        expect(document.querySelector('.overview-gpu-card').classList.contains('overview-chart-hidden'))
            .toBe(false);
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
            .toEqual({ moveConnectionDetails: true });
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

        expect(metrics).toEqual(['utilization', 'temperature', 'memory', 'power', 'chart']);
        expect(new Set(metrics).size).toBe(5);
    });

    it('uses the full viewport width at phone size', () => {
        expect(componentsCss).toMatch(
            /@media \(max-width: 768px\)[\s\S]*?\.settings-panel \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100vw;/
        );
    });

    it('keeps the hidden panel out of layout', () => {
        expect(componentsCss).toMatch(
            /\.settings-panel\[hidden\] \{\s*display: none;\s*\}/
        );
    });

    it('keeps relocated connection details within the phone-width panel', () => {
        expect(componentsCss).toMatch(
            /@media \(max-width: 768px\)[\s\S]*?\.settings-connection-details \.header-row \{[\s\S]*?width: 100%;/
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
            /@media \(max-width: 768px\)[\s\S]*?\.overview-gpu-card\.overview-chart-hidden \{\s*grid-template-columns: 1fr;\s*\}/
        );
    });
});
