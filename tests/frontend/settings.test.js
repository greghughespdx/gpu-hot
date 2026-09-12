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
            <select id="settings-overview-chart-width">
                <option value="auto">Automatic</option>
                <option value="wide">Wide</option>
                <option value="full">Full row</option>
            </select>
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
            'overview-chart-width-full'
        );
        document.documentElement.style.removeProperty('--sidebar-width');
        delete window.updateSidebarLabels;
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
        document.documentElement.classList.remove(
            'settings-connection-in-panel',
            'overview-chart-width-wide',
            'overview-chart-width-full'
        );
        document.documentElement.style.removeProperty('--sidebar-width');
        delete window.updateSidebarLabels;
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
        expect(document.getElementById('settings-overview-chart-width').value).toBe('auto');
        expect(document.documentElement.classList.contains('overview-chart-width-wide')).toBe(false);
        expect(document.documentElement.classList.contains('overview-chart-width-full')).toBe(false);
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

    it.each(['auto', 'wide', 'full'])(
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
        }
    );

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

    it('offers the three mini chart widths once', () => {
        const parsed = new DOMParser().parseFromString(template, 'text/html');
        const select = parsed.getElementById('settings-overview-chart-width');

        expect(Array.from(select.options).map(option => option.value))
            .toEqual(['auto', 'wide', 'full']);
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

    it('keeps left bar width and auto-hide effects out of the phone layout', () => {
        expect(layoutCss).toMatch(/\.sidebar \{[\s\S]*?width: var\(--sidebar-width\);/);
        expect(layoutCss).toMatch(
            /@media \(max-width: 768px\)[\s\S]*?\.sidebar-btn \{\s*width: 40px;/
        );
        expect(layoutCss).toMatch(
            /@media \(max-width: 768px\)[\s\S]*?html\.sidebar-auto-hide:not\(\.sidebar-pinned\) \.main,[\s\S]*?margin-left: 0;/
        );
    });
});
