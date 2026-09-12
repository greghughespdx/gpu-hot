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
            <div id="settings-label-list"></div>
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
        const labels = [
            { kind: 'node', node: 'node-a', label: 'Render box' },
            { kind: 'gpu', node: 'node-a', gpu: '0', label: 'Primary GPU' }
        ];
        expect(api.saveSettings({ labelOverrides: labels, unknown: 'value' })).toBe(true);
        expect(JSON.parse(localStorage.getItem(api.STORAGE_KEY))).toEqual({
            version: 1,
            settings: { labelOverrides: labels }
        });
    });

    it.each([
        ['duplicate identities', [
            { kind: 'node', node: 'node-a', label: 'One' },
            { kind: 'node', node: 'node-a', label: 'Two' }
        ]],
        ['an empty identity', [{ kind: 'gpu', node: 'node-a', gpu: '', label: 'GPU' }]],
        ['an overlong identity', [{ kind: 'node', node: 'n'.repeat(257), label: 'Node' }]],
        ['an overlong label', [{ kind: 'node', node: 'node-a', label: 'x'.repeat(81) }]],
        ['an invalid kind', [{ kind: 'system', node: 'node-a', label: 'System' }]]
    ])('drops label overrides with %s', (_label, labelOverrides) => {
        localStorage.setItem('gpu-hot.settings.v1', JSON.stringify({
            version: 1,
            settings: { labelOverrides }
        }));
        expect(loadSettingsModule().settings).toEqual({});
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
        expect(loadSettingsModule().settings).toEqual({});
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

    it('shows whether reset succeeded without closing the panel', () => {
        const api = loadSettingsModule();
        api.initSettingsPanel();
        document.getElementById('settings-open').click();
        document.getElementById('settings-reset').click();

        expect(document.getElementById('settings-status').textContent).toBe('Settings reset.');
        expect(document.getElementById('settings-panel').hidden).toBe(false);
    });

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
        expect(api.settings).toEqual({});
        expect(document.querySelector('#settings-label-list input').value).toBe('');
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

    it('keeps the hidden panel out of layout', () => {
        expect(componentsCss).toMatch(
            /\.settings-panel\[hidden\] \{\s*display: none;\s*\}/
        );
    });
});
