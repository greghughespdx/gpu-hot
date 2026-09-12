/**
 * Tests for static/js/app.js
 *
 * app.js auto-executes on DOMContentLoaded, so we test its
 * exported functions by loading them manually.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath = join(__dirname, '../../static/js/app.js');
const sourceCode = readFileSync(srcPath, 'utf-8');

function loadAppModule() {
    // Mock fetch
    globalThis.fetch = vi.fn();

    // Mock AbortController
    globalThis.AbortController = class {
        constructor() {
            this.signal = {};
        }
        abort() {}
    };

    // Mock DOM
    document.body.innerHTML = `
        <span id="version-current"></span>
        <span id="update-badge" style="display:none"></span>
        <a id="update-link" href=""></a>
        <div id="star-toast" class="is-hidden">
            <button data-action="star"></button>
            <button data-action="dismiss"></button>
            <span id="star-toast-milestone"></span>
            <div id="star-progress-wrap" class="is-hidden">
                <div id="star-progress-fill"></div>
            </div>
        </div>
    `;

    // Mock localStorage
    const store = {};
    globalThis.localStorage = {
        getItem: (key) => store[key] || null,
        setItem: (key, val) => { store[key] = String(val); },
        removeItem: (key) => { delete store[key]; }
    };

    // Load the source and export to globalThis
    const wrappedCode = `(function() { ${sourceCode}\n
        globalThis.checkVersion = checkVersion;
        globalThis.fetchStarCount = fetchStarCount;
        globalThis.formatNumber = formatNumber;
        globalThis.initStarPrompt = initStarPrompt;
        globalThis.setStarPromptEnabled = setStarPromptEnabled;
    })();`;
    vm.runInThisContext(wrappedCode, { filename: 'app.js' });
}

describe('formatNumber', () => {
    beforeEach(() => {
        loadAppModule();
    });

    it('formats thousands', () => {
        const result = formatNumber(1234);
        // Locale-dependent; at minimum it should contain digits
        expect(result).toContain('1');
        expect(result).toContain('234');
    });

    it('handles zero', () => {
        expect(formatNumber(0)).toBe('0');
    });

    it('handles small numbers', () => {
        expect(formatNumber(5)).toBe('5');
    });
});

describe('checkVersion', () => {
    beforeEach(() => {
        loadAppModule();
    });

    it('updates version text on success', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            json: () => Promise.resolve({
                current: '1.7.3',
                latest: '1.8.0',
                update_available: true,
                release_url: 'https://github.com/psalias2006/gpu-hot/releases/tag/v1.8.0'
            })
        });

        await checkVersion();
        const el = document.getElementById('version-current');
        expect(el.textContent).toBe('v1.7.3');
    });

    it('shows update badge when available', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            json: () => Promise.resolve({
                current: '1.7.3',
                latest: '1.8.0',
                update_available: true,
                release_url: 'https://example.com/release'
            })
        });

        await checkVersion();
        const badge = document.getElementById('update-badge');
        expect(badge.style.display).toBe('inline-block');
    });

    it('hides badge when no update', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            json: () => Promise.resolve({
                current: '1.7.3',
                latest: '1.7.3',
                update_available: false,
                release_url: ''
            })
        });

        await checkVersion();
        const badge = document.getElementById('update-badge');
        expect(badge.style.display).toBe('none');
    });

    it('shows Unknown on failure', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

        await checkVersion();
        const el = document.getElementById('version-current');
        expect(el.textContent).toBe('Unknown');
    });
});

describe('fetchStarCount', () => {
    beforeEach(() => {
        loadAppModule();
    });

    it('updates progress on success', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ stargazers_count: 250 })
        });

        await fetchStarCount();
        const wrap = document.getElementById('star-progress-wrap');
        expect(wrap.classList.contains('is-hidden')).toBe(false);
    });

    it('silently fails on error', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('timeout'));

        // Should not throw
        await fetchStarCount();
        const wrap = document.getElementById('star-progress-wrap');
        expect(wrap.classList.contains('is-hidden')).toBe(true);
    });

    it('does nothing for non-ok response', async () => {
        global.fetch = vi.fn().mockResolvedValue({ ok: false });

        await fetchStarCount();
        const wrap = document.getElementById('star-progress-wrap');
        expect(wrap.classList.contains('is-hidden')).toBe(true);
    });
});

describe('star prompt setting', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        delete globalThis.GPUHotSettings;
        loadAppModule();
    });

    afterEach(() => {
        vi.useRealTimers();
        delete globalThis.GPUHotSettings;
    });

    it('does not fetch, schedule, or render when the setting is off', () => {
        globalThis.GPUHotSettings = { settings: { showStarPrompt: false } };
        const schedule = vi.spyOn(globalThis, 'setTimeout');

        initStarPrompt();
        vi.advanceTimersByTime(60000);

        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(schedule).not.toHaveBeenCalled();
        expect(document.getElementById('star-toast').classList.contains('is-hidden')).toBe(true);
    });

    it('uses the existing default behavior when the setting is absent', () => {
        globalThis.fetch.mockResolvedValue({ ok: false });

        initStarPrompt();
        expect(globalThis.fetch).toHaveBeenCalledWith(
            'https://api.github.com/repos/psalias2006/gpu-hot',
            expect.any(Object)
        );
        expect(document.getElementById('star-toast').classList.contains('is-hidden')).toBe(true);

        vi.advanceTimersByTime(60000);
        expect(document.getElementById('star-toast').classList.contains('is-hidden')).toBe(false);
    });

    it('cancels a pending prompt and hides it when the setting turns off', () => {
        globalThis.fetch.mockResolvedValue({ ok: false });
        const cancel = vi.spyOn(globalThis, 'clearTimeout');
        initStarPrompt();

        setStarPromptEnabled(false);
        vi.advanceTimersByTime(60000);

        expect(cancel).toHaveBeenCalled();
        expect(document.getElementById('star-toast').classList.contains('is-hidden')).toBe(true);
    });

    it('does not fetch or schedule again when an enabled prompt is already visible', () => {
        globalThis.fetch.mockResolvedValue({ ok: false });
        initStarPrompt();
        vi.advanceTimersByTime(60000);
        globalThis.fetch.mockClear();
        const schedule = vi.spyOn(globalThis, 'setTimeout');

        setStarPromptEnabled(true);

        expect(document.getElementById('star-toast').classList.contains('is-hidden')).toBe(false);
        expect(globalThis.fetch).not.toHaveBeenCalled();
        expect(schedule).not.toHaveBeenCalled();
    });
});
