import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const testDir = dirname(fileURLToPath(import.meta.url));
const replayScript = readFileSync(join(testDir, '../../docs/demo-replay.js'), 'utf8');
const shippedRoles = ['observer', 'busy-inference', 'idle-model', 'idle-empty'];

function shippedTraces() {
    return Object.fromEntries(shippedRoles.map(role => [role,
        JSON.parse(readFileSync(join(testDir, `../../docs/demo-traces/${role}.json`), 'utf8'))]));
}

function replayWindow() {
    const page = new JSDOM('', { runScripts: 'outside-only' });
    page.window.eval(replayScript);
    return page;
}

function numericTrace(role, length = 30) {
    return {
        role,
        source: { power_limit: 300, clock_graphics_max: 2000,
            temp_idle: 35, temp_load: 80, memory_baseline: 12000 },
        samples: Array.from({ length }, (_, tick) => ({
            util: tick % 100, mem_used: 12000 + tick, mem_total: 24576,
            power: 40 + tick, temp: 35 + tick % 40, clock_graphics: 500 + tick,
            fan: 20 + tick % 50
        }))
    };
}

describe('demo trace replay', () => {
    it('ships anonymous recorded samples that remain inside every assigned board limit', () => {
        const page = replayWindow();
        const traces = shippedTraces();
        const assignments = [
            ['observer', { memoryTotal: 24576, powerLimit: 150, maxGraphicsClock: 1695,
                idleTemperature: 38, loadTemperature: 77, idlePower: 28, fan: false }, 13312],
            ['busy-inference', { memoryTotal: 49152, powerLimit: 300,
                maxGraphicsClock: 2100, idleTemperature: 36, loadTemperature: 78,
                idlePower: 42, fan: true }, 17408],
            ['idle-model', { memoryTotal: 24576, powerLimit: 450,
                maxGraphicsClock: 2520, idleTemperature: 36, loadTemperature: 80,
                idlePower: 35, fan: true }, 17408],
            ['idle-empty', { memoryTotal: 8192, powerLimit: 105,
                maxGraphicsClock: 1708, idleTemperature: 36, loadTemperature: 76,
                idlePower: 22, fan: true }, 256]
        ];
        for (const role of shippedRoles) {
            const raw = readFileSync(join(testDir, `../../docs/demo-traces/${role}.json`), 'utf8');
            expect(raw).not.toMatch(/truenas|inf1|inf2|p4000|192\.168|compute-04/i);
            expect(Object.keys(traces[role]).sort()).toEqual(['role', 'samples', 'source']);
            expect(traces[role].samples).toHaveLength(500);
        }
        const replay = page.window.GPUHotDemoReplay.createReplay(traces, 77);
        for (let tick = 0; tick < 650; tick += 1) {
            for (const [role, spec, footprint] of assignments) {
                const frame = replay.sample(role, role, tick);
                const scaled = page.window.GPUHotDemoReplay.scaleFrame(spec, footprint, frame);
                expect(scaled.utilization).toBeGreaterThanOrEqual(0);
                expect(scaled.utilization).toBeLessThanOrEqual(100);
                expect(scaled.memoryUsed).toBeLessThanOrEqual(spec.memoryTotal);
                expect(scaled.powerDraw).toBeLessThanOrEqual(spec.powerLimit);
                expect(scaled.graphicsClock).toBeLessThanOrEqual(spec.maxGraphicsClock);
                expect(scaled.temperature).toBeGreaterThanOrEqual(spec.idleTemperature);
                expect(scaled.temperature).toBeLessThanOrEqual(spec.loadTemperature);
                if (!spec.fan) expect(scaled.fanSpeed).toBe(0);
            }
        }
        page.window.close();
    });

    it('starts cards sharing one trace at different phases and advances once per tick', () => {
        const page = replayWindow();
        const replay = page.window.GPUHotDemoReplay.createReplay({
            'idle-model': numericTrace('idle-model')
        }, 123);
        const first = replay.sample('idle-model', 'card-1', 0).sample;
        const second = replay.sample('idle-model', 'card-2', 0).sample;
        expect(first.util).not.toBe(second.util);
        expect(replay.sample('idle-model', 'card-1', 0).sample.util).toBe(first.util);
        expect(replay.sample('idle-model', 'card-1', 1).sample.util).toBe(first.util + 1);
        page.window.close();
    });

    it('changes the start phase with a new page seed while staying continuous in one page', () => {
        const page = replayWindow();
        const traces = { observer: numericTrace('observer', 80) };
        const first = page.window.GPUHotDemoReplay.createReplay(traces, 19);
        const second = page.window.GPUHotDemoReplay.createReplay(traces, 29);
        const a = Array.from({ length: 20 }, (_, tick) =>
            first.sample('observer', 'card-0', tick).sample.util);
        const b = Array.from({ length: 20 }, (_, tick) =>
            second.sample('observer', 'card-0', tick).sample.util);
        expect(a).not.toEqual(b);
        expect(Math.max(...a.slice(1).map((value, index) =>
            Math.abs(value - a[index])))).toBeLessThan(20);
        page.window.close();
    });

    it('blends the random re-offset when a short capture reaches its seam', () => {
        const page = replayWindow();
        const replay = page.window.GPUHotDemoReplay.createReplay({
            observer: numericTrace('observer')
        }, 3);
        const values = Array.from({ length: 70 }, (_, tick) =>
            replay.sample('observer', 'card-0', tick).sample.util);
        expect(values.some((value, index) => index > 0 && value < values[index - 1])).toBe(true);
        expect(Math.max(...values.slice(1).map((value, index) =>
            Math.abs(value - values[index])))).toBeLessThan(6);
        page.window.close();
    });

    it('primes a full chart window from the trace before the first live tick', () => {
        const page = replayWindow();
        const replay = page.window.GPUHotDemoReplay.createReplay({
            observer: numericTrace('observer', 300)
        }, 7);
        const history = replay.prime('observer', 'card-0', 240);
        const live = replay.sample('observer', 'card-0', 0).sample;
        expect(history).toHaveLength(240);
        expect(new Set(history.map(frame => frame.sample.util)).size).toBeGreaterThan(1);
        expect(live.util).not.toBe(history[0].sample.util);
        expect(() => replay.prime('observer', 'card-0', 240)).toThrow('before the first tick');
        page.window.close();
    });

    it('remixes observed busy and idle runs instead of repeating a fixed period', () => {
        const page = replayWindow();
        const trace = numericTrace('busy-inference', 60);
        trace.samples.forEach((sample, index) => {
            sample.util = index < 5 || index >= 13 && index < 25 || index >= 42 && index < 50
                ? 95 : 0;
        });
        const replay = page.window.GPUHotDemoReplay.createReplay({
            'busy-inference': trace
        }, 11);
        const values = Array.from({ length: 180 }, (_, tick) =>
            replay.sample('busy-inference', 'card-1', tick).sample.util);
        const runs = [];
        for (const value of values) {
            const busy = value >= 20;
            if (runs.length && runs[runs.length - 1].busy === busy) runs[runs.length - 1].length++;
            else runs.push({ busy, length: 1 });
        }
        expect(new Set(runs.filter(run => run.busy).map(run => run.length)).size)
            .toBeGreaterThan(1);
        expect(values.slice(0, 60)).not.toEqual(values.slice(60, 120));
        page.window.close();
    });

    it('rejects malformed numeric trace data before replay starts', () => {
        const page = replayWindow();
        const trace = numericTrace('observer');
        trace.samples[4].util = '<script>bad</script>';
        expect(() => page.window.GPUHotDemoReplay.createReplay({ observer: trace }, 1))
            .toThrow('invalid sample');
        trace.samples[4].util = 4;
        trace.samples[4].mem_used = 30000;
        expect(() => page.window.GPUHotDemoReplay.createReplay({ observer: trace }, 1))
            .toThrow('invalid sample');
        page.window.close();
    });

    it('scales recorded values to the card limits while retaining memory variation', () => {
        const page = replayWindow();
        const spec = { memoryTotal: 24576, powerLimit: 150, maxGraphicsClock: 1695,
            idleTemperature: 38, loadTemperature: 77, idlePower: 28, fan: false };
        const source = numericTrace('observer').source;
        const sample = { util: 97, mem_used: 12256, power: 330, temp: 82,
            clock_graphics: 2200, fan: 75 };
        const scaled = page.window.GPUHotDemoReplay.scaleFrame(spec, 13312,
            { source, sample });
        expect(scaled).toEqual({
            utilization: 97, temperature: 77, memoryUsed: 13568,
            powerDraw: 150, graphicsClock: 1695, fanSpeed: 0
        });
        page.window.close();
    });
});
