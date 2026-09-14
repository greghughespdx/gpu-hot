(function () {
    const FIELDS = ['util', 'mem_used', 'mem_total', 'power', 'temp', 'clock_graphics', 'fan'];
    const BLEND_LENGTH = 6;
    const BUSY_BLEND_LENGTH = 3;

    function randomFromSeed(seed) {
        let state = seed >>> 0;
        return () => {
            state += 0x6D2B79F5;
            let mixed = state;
            mixed = Math.imul(mixed ^ mixed >>> 15, mixed | 1);
            mixed ^= mixed + Math.imul(mixed ^ mixed >>> 7, mixed | 61);
            return ((mixed ^ mixed >>> 14) >>> 0) / 0x100000000;
        };
    }

    function validNumber(number) {
        return typeof number === 'number' && Number.isFinite(number);
    }

    function validateTrace(role, trace) {
        const source = trace?.source;
        const samples = trace?.samples;
        if (trace?.role !== role || !Array.isArray(samples) || samples.length < BLEND_LENGTH * 3 ||
            !source || !validNumber(source.power_limit) || source.power_limit <= 0 ||
            !validNumber(source.clock_graphics_max) || source.clock_graphics_max <= 0 ||
            !validNumber(source.temp_idle) || !validNumber(source.temp_load) ||
            source.temp_load <= source.temp_idle || !validNumber(source.memory_baseline) ||
            source.memory_baseline < 0) {
            throw new Error(`Demo ${role} trace is incomplete`);
        }
        for (const sample of samples) {
            if (!FIELDS.every(field => validNumber(sample[field])) || sample.util < 0 ||
                sample.util > 100 || sample.mem_total <= 0 || sample.mem_used < 0 ||
                sample.mem_used > sample.mem_total || sample.power < 0 ||
                sample.clock_graphics < 0 || sample.fan < 0 || sample.fan > 100) {
                throw new Error(`Demo ${role} trace has an invalid sample`);
            }
        }
        return trace;
    }

    function blendSamples(previous, current, share) {
        const blended = {};
        for (const field of FIELDS) {
            blended[field] = previous[field] + (current[field] - previous[field]) * share;
        }
        return blended;
    }

    function busySegments(samples) {
        const active = samples.map(sample => sample.util >= 20);
        for (let index = 1; index < active.length - 1; index += 1) {
            if (!active[index] && active[index - 1] && active[index + 1]) active[index] = true;
        }
        for (let index = 1; index < active.length - 1; index += 1) {
            if (active[index] && !active[index - 1] && !active[index + 1]) active[index] = false;
        }
        const segments = [];
        for (let index = 0; index < active.length; index += 1) {
            if (segments.length && segments[segments.length - 1].active === active[index]) {
                segments[segments.length - 1].end = index + 1;
            } else {
                segments.push({ start: index, end: index + 1, active: active[index] });
            }
        }
        return segments;
    }

    function within(number, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, number));
    }

    function scaleFrame(spec, footprint, frame) {
        const { sample, source } = frame;
        const utilization = Math.round(within(sample.util, 0, 100));
        const temperatureShare = within((sample.temp - source.temp_idle) /
            (source.temp_load - source.temp_idle), 0, 1);
        const temperature = Math.round(spec.idleTemperature + temperatureShare *
            (spec.loadTemperature - spec.idleTemperature));
        const memoryUsed = footprint <= 0 ? 0 : Math.round(within(footprint +
            sample.mem_used - source.memory_baseline, 0, spec.memoryTotal));
        const fanSpeed = spec.fan ? Math.round(within(sample.fan ||
            18 + (temperature - spec.idleTemperature) * 1.7, 0, 100)) : 0;
        return {
            utilization, temperature, memoryUsed,
            powerDraw: Math.round(within(sample.power / source.power_limit *
                spec.powerLimit, spec.idlePower, spec.powerLimit)),
            graphicsClock: Math.round(within(sample.clock_graphics /
                source.clock_graphics_max * spec.maxGraphicsClock, 0, spec.maxGraphicsClock)),
            fanSpeed
        };
    }

    function createReplay(traces, seed = Math.floor(Math.random() * 0x100000000)) {
        const roles = Object.fromEntries(Object.entries(traces).map(([role, trace]) =>
            [role, validateTrace(role, trace)]));
        const random = randomFromSeed(seed);
        const states = new Map();
        const usedStarts = new Map();
        const busy = roles['busy-inference'] ? busySegments(roles['busy-inference'].samples) : [];
        const remixBusy = busy.some(segment => segment.active) &&
            busy.some(segment => !segment.active);

        function chooseStart(role, previous = -1) {
            const length = roles[role].samples.length - BLEND_LENGTH;
            const used = usedStarts.get(role) || new Set();
            used.delete(previous);
            let start = Math.floor(random() * length);
            while (start === previous || used.has(start)) {
                start = (start + 1) % length;
            }
            used.add(start);
            usedStarts.set(role, used);
            return start;
        }

        function advanceBusy(state) {
            const segment = busy[state.segmentIndex];
            if (state.position >= segment.end) {
                const choices = busy.filter(candidate => candidate.active !== segment.active);
                const nextSegment = choices[Math.floor(random() * choices.length)];
                state.segmentIndex = busy.indexOf(nextSegment);
                state.position = nextSegment.start;
                state.blendFrom = state.current;
                state.blendStep = 0;
            }
            const next = roles['busy-inference'].samples[state.position++];
            if (state.blendStep >= BUSY_BLEND_LENGTH) {
                state.current = next;
                return;
            }
            const blended = blendSamples(state.blendFrom, next,
                ++state.blendStep / BUSY_BLEND_LENGTH);
            // Utilization edges stay sharp; power and temperature catch up.
            blended.util = next.util;
            blended.clock_graphics = next.clock_graphics;
            blended.mem_used = next.mem_used;
            state.current = blended;
        }

        function advanceSequential(role, state) {
            const samples = roles[role].samples;
            if (state.position >= samples.length) {
                state.position = chooseStart(role, state.start);
                state.start = state.position;
                state.blendFrom = state.current;
                state.blendStep = 0;
            }
            const next = samples[state.position++];
            state.current = state.blendStep < BLEND_LENGTH
                ? blendSamples(state.blendFrom, next, ++state.blendStep / BLEND_LENGTH)
                : next;
        }

        function advance(role, state) {
            if (role === 'busy-inference' && remixBusy) advanceBusy(state);
            else advanceSequential(role, state);
        }

        function stateFor(role, cardId) {
            if (!roles[role]) throw new Error(`Demo ${role} trace is missing`);
            const key = `${role}:${cardId}`;
            let state = states.get(key);
            if (!state) {
                const start = chooseStart(role);
                state = { start, position: start, tick: -1, primed: false, current: null,
                    blendFrom: null, blendStep: BLEND_LENGTH,
                    segmentIndex: role === 'busy-inference' && remixBusy
                        ? busy.findIndex(segment => start >= segment.start && start < segment.end)
                        : -1 };
                states.set(key, state);
            }
            return state;
        }

        function prime(role, cardId, count) {
            const state = stateFor(role, cardId);
            if (state.tick !== -1 || state.primed || !Number.isInteger(count) || count < 0) {
                throw new Error('Demo history must be primed before the first tick');
            }
            state.primed = true;
            const history = [];
            for (let index = 0; index < count; index += 1) {
                advance(role, state);
                history.push({ sample: state.current, source: roles[role].source });
            }
            return history;
        }

        function sample(role, cardId, tick) {
            const state = stateFor(role, cardId);
            if (!Number.isInteger(tick) || tick < state.tick) {
                throw new Error('Demo replay ticks must advance');
            }
            while (state.tick < tick) {
                advance(role, state);
                state.tick += 1;
            }
            return { sample: state.current, source: roles[role].source };
        }

        return Object.freeze({ sample, prime });
    }

    async function loadTraces(fetcher) {
        const roles = ['observer', 'idle-model', 'idle-empty', 'busy-inference'];
        const entries = await Promise.all(roles.map(async role => {
            const response = await fetcher(`./demo-traces/${role}.json`);
            if (!response.ok) throw new Error(`Demo ${role} trace could not load`);
            return [role, validateTrace(role, await response.json())];
        }));
        return Object.fromEntries(entries);
    }

    window.GPUHotDemoReplay = Object.freeze({ createReplay, loadTraces, scaleFrame });
})();
