/* Read-only, local GPU activity view. This file intentionally has no dashboard dependencies. */
(function () {
    'use strict';

    const POLL_INTERVAL_MS = 3000;
    const HISTORY_LENGTH = 20;
    const MAX_LOCAL_GPUS = 2;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const histories = new Map();

    function numberInRange(value, minimum, maximum) {
        const number = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(number)) return minimum;
        return Math.min(maximum, Math.max(minimum, number));
    }

    function formatMemory(value) {
        const mib = numberInRange(value, 0, Number.MAX_SAFE_INTEGER);
        if (mib >= 1024) return `${(mib / 1024).toFixed(1)} GB`;
        return `${Math.round(mib)} MB`;
    }

    function localGpus(payload) {
        if (!payload || typeof payload !== 'object' || !payload.gpus || typeof payload.gpus !== 'object' || Array.isArray(payload.gpus)) {
            return [];
        }
        return Object.keys(payload.gpus)
            .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
            .slice(0, MAX_LOCAL_GPUS)
            .map((id) => payload.gpus[id])
            .filter((gpu) => gpu && typeof gpu === 'object' && !Array.isArray(gpu));
    }

    function appendText(parent, className, value) {
        const element = document.createElement('span');
        element.className = className;
        element.textContent = value;
        parent.appendChild(element);
        return element;
    }

    function appendMetric(parent, label, value) {
        const metric = document.createElement('div');
        appendText(metric, 'metric-label', label);
        appendText(metric, 'metric-value', value);
        parent.appendChild(metric);
    }

    function createHistory(values) {
        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.classList.add('history');
        svg.setAttribute('viewBox', '0 0 100 36');
        svg.setAttribute('preserveAspectRatio', 'none');
        svg.setAttribute('role', 'img');
        svg.setAttribute('aria-label', 'Recent GPU utilization history');

        const baseline = document.createElementNS(SVG_NS, 'line');
        baseline.classList.add('history-baseline');
        baseline.setAttribute('x1', '0');
        baseline.setAttribute('x2', '100');
        baseline.setAttribute('y1', '35');
        baseline.setAttribute('y2', '35');
        svg.appendChild(baseline);

        const points = values.map((value, index) => {
            const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100;
            const y = 35 - (numberInRange(value, 0, 100) / 100) * 34;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        }).join(' ');
        const line = document.createElementNS(SVG_NS, 'polyline');
        line.classList.add('history-line');
        line.setAttribute('points', points || '0,35');
        svg.appendChild(line);
        return svg;
    }

    function rememberUtilization(index, utilization) {
        const history = histories.get(index) || [];
        history.push(utilization);
        if (history.length > HISTORY_LENGTH) history.shift();
        histories.set(index, history);
        return history;
    }

    function render(gpus) {
        const list = document.getElementById('gpu-list');
        const state = document.getElementById('connection-state');
        list.replaceChildren();
        list.setAttribute('aria-busy', 'false');

        if (gpus.length === 0) {
            const message = document.createElement('p');
            message.className = 'empty-state';
            message.textContent = 'GPU activity is unavailable right now.';
            list.appendChild(message);
            state.textContent = 'GPU activity unavailable';
            state.className = 'connection-state is-unavailable';
            return;
        }

        gpus.forEach((gpu, index) => {
            const utilization = numberInRange(gpu.utilization, 0, 100);
            const used = numberInRange(gpu.memory_used, 0, Number.MAX_SAFE_INTEGER);
            const total = numberInRange(gpu.memory_total, 0, Number.MAX_SAFE_INTEGER);
            const card = document.createElement('article');
            card.className = 'gpu-card';
            const title = document.createElement('h2');
            title.textContent = `GPU ${index + 1}`;
            card.appendChild(title);
            const metrics = document.createElement('div');
            metrics.className = 'metrics';
            appendMetric(metrics, 'Utilization', `${Math.round(utilization)}%`);
            appendMetric(metrics, 'Memory', `${formatMemory(used)} of ${formatMemory(total)}`);
            card.appendChild(metrics);
            appendText(card, 'history-label', 'Recent utilization');
            card.appendChild(createHistory(rememberUtilization(index, utilization)));
            list.appendChild(card);
        });
        state.textContent = 'Live GPU activity';
        state.className = 'connection-state is-ready';
    }

    async function refresh() {
        const list = document.getElementById('gpu-list');
        try {
            const response = await fetch('/api/gpu-data', { headers: { Accept: 'application/json' } });
            if (!response.ok) throw new Error('GPU data request failed');
            render(localGpus(await response.json()));
        } catch (_error) {
            render([]);
        } finally {
            list.setAttribute('aria-busy', 'false');
        }
    }

    function start() {
        refresh();
        window.setInterval(refresh, POLL_INTERVAL_MS);
    }

    window.GpuHotCompactView = { formatMemory, localGpus, numberInRange, refresh, render };
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
        start();
    }
})();
