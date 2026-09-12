import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const testDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(testDir, '../../static/js/settings.js'), 'utf8');
const template = readFileSync(join(testDir, '../../templates/index.html'), 'utf8');
const componentsCss = readFileSync(join(testDir, '../../static/css/components.css'), 'utf8');

function panelMarkup() {
    document.body.innerHTML = `
        <button id="settings-open" aria-expanded="false">Settings</button>
        <div id="settings-overlay" hidden></div>
        <aside id="settings-panel" hidden inert aria-hidden="true">
            <button id="settings-close">Close</button>
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
        expect(api.saveSettings({ unknown: 'value' })).toBe(true);
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY))).toEqual({
            version: 1,
            settings: {}
        });
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
    });
    afterEach(() => { vi.restoreAllMocks(); });

    it('is hidden until the gear opens it and restores focus when closed', () => {
        const openButton = document.getElementById('settings-open');
        const panel = document.getElementById('settings-panel');
        const overlay = document.getElementById('settings-overlay');
        const api = loadSettingsModule();
        api.initSettingsPanel();

        openButton.focus();
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

    it('shows whether reset succeeded without closing the panel', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        document.getElementById('settings-open').click();
        document.getElementById('settings-reset').click();

        expect(document.getElementById('settings-status').textContent).toBe('Settings reset.');
        expect(document.getElementById('settings-panel').hidden).toBe(false);
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

    it('uses the full viewport width at phone size', () => {
        expect(componentsCss).toMatch(
            /@media \(max-width: 768px\)[\s\S]*?\.settings-panel \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100vw;/
        );
    });
});
