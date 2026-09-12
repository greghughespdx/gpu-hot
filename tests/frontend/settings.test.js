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

function panelMarkup() {
    document.body.innerHTML = `
        <button id="settings-open" aria-expanded="false">Settings</button>
        <div id="settings-overlay" hidden></div>
        <aside id="settings-panel" hidden inert aria-hidden="true">
            <button id="settings-close">Close</button>
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
        document.documentElement.className = '';
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
        expect(loadSettingsModule().settings).toEqual({});
    });

    it('does not overwrite settings written by a newer version', () => {
        const future = JSON.stringify({ version: 2, settings: { future: true } });
        localStorage.setItem('gpu-hot.settings.v1', future);
        const setItem = vi.spyOn(Storage.prototype, 'setItem');

        expect(loadSettingsModule().settings).toEqual({});
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
        expect(api.settings).toEqual({});
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY))).toEqual({
            version: 1,
            settings: {}
        });
    });

    it('stores only allowlisted settings in a versioned envelope', () => {
        const api = loadSettingsModule();
        expect(api.saveSettings({ sidebarWidth: 'wide', unknown: 'value' })).toBe(true);
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY))).toEqual({
            version: 1,
            settings: { sidebarWidth: 'wide' }
        });
    });

    it('drops invalid left bar settings', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: {
                sidebarWidth: 'giant',
                sidebarLabel: 'serial',
                sidebarAutoHide: 'yes',
                sidebarPinned: 1
            }
        }));
        expect(loadSettingsModule().settings).toEqual({});
    });

    it('applies stored width and visibility before the page is ready', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { sidebarWidth: 'comfortable', sidebarAutoHide: true, sidebarPinned: true }
        }));

        loadSettingsModule();

        expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('72px');
        expect(document.documentElement.classList.contains('sidebar-auto-hide')).toBe(true);
        expect(document.documentElement.classList.contains('sidebar-pinned')).toBe(true);
    });

    it('returns defaults when storage reads fail and reports write failures', () => {
        const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('read failed');
        });
        const api = loadSettingsModule();
        expect(api.settings).toEqual({});
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
        document.documentElement.className = '';
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

    it('shows whether reset succeeded without closing the panel', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        document.getElementById('settings-open').click();
        document.getElementById('settings-reset').click();

        expect(document.getElementById('settings-status').textContent).toBe('Settings reset.');
        expect(document.getElementById('settings-panel').hidden).toBe(false);
    });

    it('persists width and label choices and applies the width token', () => {
        const api = loadSettingsModule();
        window.updateSidebarLabels = vi.fn();
        api.initSettingsPanel();
        window.updateSidebarLabels.mockClear();
        const width = document.getElementById('settings-sidebar-width');
        const label = document.getElementById('settings-sidebar-label');

        width.value = 'wide';
        width.dispatchEvent(new Event('change'));
        window.updateSidebarLabels.mockClear();
        label.value = 'node-index';
        label.dispatchEvent(new Event('change'));

        expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('96px');
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY)).settings).toEqual({
            sidebarWidth: 'wide',
            sidebarLabel: 'node-index'
        });
        expect(window.updateSidebarLabels).toHaveBeenCalledOnce();
    });

    it('clears the pin when auto-hide is turned off and starts fresh when re-enabled', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        const autoHide = document.getElementById('settings-sidebar-auto-hide');
        const pinned = document.getElementById('settings-sidebar-pinned');

        expect(pinned.disabled).toBe(true);
        autoHide.checked = true;
        autoHide.dispatchEvent(new Event('change'));
        expect(document.documentElement.classList.contains('sidebar-auto-hide')).toBe(true);
        expect(pinned.disabled).toBe(false);

        pinned.checked = true;
        pinned.dispatchEvent(new Event('change'));
        expect(document.documentElement.classList.contains('sidebar-pinned')).toBe(true);

        autoHide.checked = false;
        autoHide.dispatchEvent(new Event('change'));
        expect(pinned.checked).toBe(false);
        expect(pinned.disabled).toBe(true);
        expect(document.documentElement.classList.contains('sidebar-pinned')).toBe(false);
        expect(api.settings.sidebarPinned).toBe(false);

        autoHide.checked = true;
        autoHide.dispatchEvent(new Event('change'));
        expect(pinned.checked).toBe(false);
        expect(pinned.disabled).toBe(false);
        expect(document.documentElement.classList.contains('sidebar-auto-hide')).toBe(true);
        expect(document.documentElement.classList.contains('sidebar-pinned')).toBe(false);
    });

    it('does not apply a stored pin when auto-hide is off', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { sidebarAutoHide: false, sidebarPinned: true }
        }));
        const api = loadSettingsModule();

        api.initSettingsPanel();

        expect(document.documentElement.classList.contains('sidebar-pinned')).toBe(false);
        expect(document.getElementById('settings-sidebar-pinned').checked).toBe(false);
        expect(document.getElementById('settings-sidebar-pinned').disabled).toBe(true);
    });

    it('restores the default bar after reset', () => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: {
                sidebarWidth: 'wide',
                sidebarLabel: 'short-name',
                sidebarAutoHide: true,
                sidebarPinned: true
            }
        }));
        const api = loadSettingsModule();
        api.initSettingsPanel();

        document.getElementById('settings-reset').click();

        expect(document.getElementById('settings-sidebar-width').value).toBe('standard');
        expect(document.getElementById('settings-sidebar-label').value).toBe('index');
        expect(document.getElementById('settings-sidebar-auto-hide').checked).toBe(false);
        expect(document.getElementById('settings-sidebar-pinned').disabled).toBe(true);
        expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('');
        expect(document.documentElement.classList.contains('sidebar-auto-hide')).toBe(false);
        expect(document.documentElement.classList.contains('sidebar-pinned')).toBe(false);
    });

    it('keeps the current width when storage rejects the change', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota exceeded');
        });
        const width = document.getElementById('settings-sidebar-width');

        width.value = 'wide';
        width.dispatchEvent(new Event('change'));

        expect(width.value).toBe('standard');
        expect(document.documentElement.style.getPropertyValue('--sidebar-width')).toBe('');
        expect(document.getElementById('settings-status').textContent)
            .toBe('This display change could not be saved. Try again.');
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

    it('offers every left bar option inside settings', () => {
        const parsed = new DOMParser().parseFromString(template, 'text/html');
        expect(Array.from(parsed.getElementById('settings-sidebar-width').options)
            .map(option => option.value)).toEqual(['standard', 'comfortable', 'wide']);
        expect(Array.from(parsed.getElementById('settings-sidebar-label').options)
            .map(option => option.value)).toEqual(['index', 'node-index', 'short-name']);
        expect(parsed.getElementById('settings-sidebar-auto-hide')).not.toBeNull();
        expect(parsed.getElementById('settings-sidebar-pinned')).not.toBeNull();
        expect(parsed.querySelector('.sidebar #settings-sidebar-pinned')).toBeNull();
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

    it('uses the shared width token and keeps auto-hide off on phones', () => {
        expect(layoutCss).toMatch(/\.sidebar \{[\s\S]*?width: var\(--sidebar-width\);/);
        expect(layoutCss).toMatch(
            /html\.sidebar-auto-hide:not\(\.sidebar-pinned\) \.sidebar \{[\s\S]*?translateX\(calc\(-100% \+ 8px\)\)/
        );
        expect(layoutCss).toMatch(
            /@media \(max-width: 768px\)[\s\S]*?\.sidebar \{[\s\S]*?transform: none !important;/
        );
        expect(layoutCss).toMatch(
            /@media \(max-width: 768px\)[\s\S]*?\.sidebar-btn \{\s*width: 40px;/
        );
        expect(layoutCss).toMatch(
            /@media \(max-width: 768px\)[\s\S]*?html\.sidebar-auto-hide:not\(\.sidebar-pinned\) \.main,[\s\S]*?margin-left: 0;/
        );
    });
});
