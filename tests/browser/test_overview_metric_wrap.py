"""Check balanced metric rows and card separation in a real headless browser."""

from html import unescape
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import threading


ROOT = Path(__file__).resolve().parents[2]
CHECK = r"""
<script>
document.addEventListener('DOMContentLoaded', () => {
    const width = Number(location.hash.slice(1).split('-')[0]);
    const count = Number(location.hash.slice(1).split('-')[1]);
    const names = [
        ['utilization', 'UTIL', '42%'], ['temperature', 'TEMP', '53 C'],
        ['memory', 'MEM', '57%'], ['power', 'POWER', '148 W'],
        ['fan-speed', 'FAN', '40%'], ['graphics-clock', 'GRAPHICS CLOCK', '700 MHz'],
        ['memory-clock', 'MEMORY CLOCK', '1100 MHz'],
        ['memory-used', 'MEMORY USED', '4.1 GB'],
        ['power-limit', 'POWER LIMIT', '300 W'],
        ['memory-temperature', 'MEMORY TEMP', '52 C'],
        ['throttle-status', 'THROTTLE', 'UNTHROTTLED'],
        ['process-count', 'PROCESSES', '2'],
        ['pcie-generation', 'PCIE GEN', '4'],
        ['pcie-width', 'PCIE WIDTH', '16'],
        ['encoder-load', 'ENCODER', '20%'],
        ['decoder-load', 'DECODER', '10%'],
        ['performance-state', 'PERFORMANCE', 'P0']
    ];
    const settings = window.GPUHotSettings;
    names.slice(4, count).forEach(([key]) => { settings.settings[`overview.${key}`] = true; });
    const group = document.createElement('section');
    group.className = 'node-group';
    const label = document.createElement('div');
    label.className = 'node-label';
    label.textContent = 'inf1';
    const grid = document.createElement('div');
    grid.className = 'node-grid';
    for (let index = 0; index < 2; index += 1) {
        const card = document.createElement('div');
        card.className = 'overview-gpu-card';
        const name = document.createElement('div');
        name.className = 'overview-gpu-name';
        name.textContent = `GPU ${index}`;
        const metrics = document.createElement('div');
        metrics.className = 'overview-metrics';
        names.slice(0, count).forEach(([key, caption, reading]) => {
            const cell = document.createElement('div');
            cell.className = 'overview-metric';
            cell.dataset.overviewMetric = key;
            const value = document.createElement('div');
            value.className = 'overview-metric-value';
            value.textContent = reading;
            const text = document.createElement('div');
            text.className = 'overview-metric-label';
            text.textContent = caption;
            cell.append(value, text);
            metrics.append(cell);
        });
        const chart = document.createElement('div');
        chart.className = 'overview-mini-chart';
        card.append(name, metrics, chart);
        grid.append(card);
    }
    group.append(label, grid);
    document.getElementById('overview-container').append(group);
    settings.applyOverviewMetricVisibility();
    const cards = [...grid.querySelectorAll('.overview-gpu-card')];
    const boxes = cards.map(card => [...card.querySelectorAll('.overview-metric:not([hidden])')]
        .map(cell => cell.getBoundingClientRect()));
    const rows = boxes.map(cardBoxes => {
        const grouped = [];
        cardBoxes.forEach(box => {
            if (!grouped.length || Math.abs(grouped[grouped.length - 1][0].top - box.top) > 1) {
                grouped.push([]);
            }
            grouped[grouped.length - 1].push(box);
        });
        return grouped;
    });
    const failures = [];
    if (innerWidth !== width) failures.push('viewport width');
    if (cards.length !== 2 || boxes.some(cardBoxes => cardBoxes.length !== count)) {
        failures.push('card metrics');
    }
    if (width === 1100 && count === 6 && rows.some(cardRows =>
        cardRows.length !== 2 || cardRows[0].length !== 3 || cardRows[1].length !== 3)) {
        failures.push('six metric balance');
    }
    if (width === 1100 && count === 10 && rows.some(cardRows =>
        cardRows.length !== 2 || cardRows[0].length !== 5 || cardRows[1].length !== 5)) {
        failures.push('ten metric balance');
    }
    if (width === 390 && rows.some(cardRows => cardRows.some((cardRow, index) =>
        cardRow.length !== 2 && !(count % 2 === 1 && index === cardRows.length - 1
            && cardRow.length === 1)))) failures.push('phone columns');
    if (rows.some(cardRows => {
        const lengths = cardRows.map(row => row.length);
        return Math.max(...lengths) - Math.min(...lengths) > 1;
    })) {
        failures.push('unbalanced rows');
    }
    const withinGaps = rows[0].slice(1).map((row, index) =>
        row[0].top - rows[0][index][0].bottom);
    const within = withinGaps[0] || 0;
    const between = rows[1][0][0].top - rows[0].at(-1)[0].bottom;
    if (count > 4) {
        if (withinGaps.some(gap => Math.abs(gap - (width === 1100 ? 8 : 16)) > 1)) {
            failures.push('within gap');
        }
        if ((width === 1100 && Math.abs(between - 24) > 1) || between <= within) {
            failures.push('between gap');
        }
    } else if (cards.some(card => card.classList.contains('overview-has-extra-metrics')
        || card.querySelector('.overview-metric-row-break'))
        || (width === 1100 && Math.abs(cards[1].getBoundingClientRect().top
            - cards[0].getBoundingClientRect().bottom) > 1)) {
        failures.push('default layout changed');
    }
    if (document.documentElement.scrollWidth > width) failures.push('horizontal overflow');
    const markers = cards.map(card => [...card.querySelectorAll('.overview-metric-row-break')]);
    settings.applyOverviewMetricVisibility();
    if (cards.some((card, index) => {
        const current = [...card.querySelectorAll('.overview-metric-row-break')];
        return current.length !== markers[index].length
            || current.some((marker, position) => marker !== markers[index][position]);
    })) failures.push('row markers rewritten on unchanged settings');
    settings.applyOverviewMiniChartBehindDim(45);
    settings.applyOverviewMiniChartWidth('behind');
    cards.forEach((card, index) => {
        const chart = card.querySelector('.overview-mini-chart');
        const mask = getComputedStyle(chart).maskImage;
        if (width === 390) {
            if (mask !== 'none') failures.push(`phone chart mask ${index}: ${mask}`);
            return;
        }
        const cells = [...card.querySelectorAll('.overview-metric:not([hidden])')];
        const textRight = cell => Math.max(...[...cell.querySelectorAll(
            '.overview-metric-value, .overview-metric-label')].map(text => {
            const range = document.createRange();
            range.selectNodeContents(text);
            return range.getBoundingClientRect().right;
        }));
        const wrapped = card.classList.contains('overview-metrics-wrapped');
        const expectedRight = wrapped ? Math.max(...cells.map(textRight)) : textRight(cells.at(-1));
        const start = card.style.getPropertyValue('--overview-chart-behind-fade-start');
        const measuredRight = Number(start.match(/calc\(([-\d.]+)px/)?.[1]);
        if (Math.abs(measuredRight - (expectedRight - chart.getBoundingClientRect().left)) > 1) {
            failures.push(`fade anchor ${index}`);
        }
        if (!mask.includes('0.45') || !mask.includes('100%') || !mask.includes('rgb(')) {
            failures.push(`fade mask ${index}: ${mask}`);
        }
    });
    const output = document.createElement('output');
    output.id = 'wrap-test-result';
    output.textContent = failures.length ? failures.join(', ') : 'PASS';
    document.body.append(output);
});
</script>
"""


class WrapHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        if not self.path.startswith('/templates/index.html'):
            super().do_GET()
            return
        template = (ROOT / 'templates/index.html').read_text(encoding='utf-8')
        template = re.sub(r'<script src="(?!/static/js/settings\.js)[^"]+"></script>', '', template)
        template = re.sub(r'<link href="https://fonts\.googleapis\.com[^>]+>', '', template)
        page = template.replace('</body>', CHECK + '</body>').encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(page)))
        self.end_headers()
        self.wfile.write(page)

    def log_message(self, *args: object) -> None:
        pass


def browser_binary() -> str:
    for cache in (Path.home() / 'Library/Caches/ms-playwright', Path.home() / '.cache/ms-playwright'):
        shells = sorted(cache.glob('chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell'))
        if shells:
            return str(shells[-1])
    browser = shutil.which('chrome-headless-shell')
    if browser is None:
        raise RuntimeError('Chromium headless shell is required for metric wrap tests')
    return browser


def main() -> None:
    with ThreadingHTTPServer(('127.0.0.1', 0), WrapHandler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for width, height, count in ((1100, 900, 4), (1100, 900, 6),
                                         (1100, 900, 10), (1100, 900, 17),
                                         (390, 844, 6), (390, 844, 10), (390, 844, 17)):
                with tempfile.TemporaryDirectory(prefix='gpu-hot-wrap-') as profile:
                    url = f'http://127.0.0.1:{server.server_port}/templates/index.html#{width}-{count}'
                    browser = subprocess.run(
                        [browser_binary(), '--headless=new', '--disable-gpu', '--no-first-run',
                         '--disable-background-networking', '--force-device-scale-factor=1',
                         f'--window-size={width},{height}', '--virtual-time-budget=3000',
                         f'--user-data-dir={profile}', '--dump-dom', url],
                        capture_output=True, text=True, timeout=30, check=True,
                    )
                    match = re.search(r'<output id="wrap-test-result">([^<]*)</output>', browser.stdout)
                    verdict = unescape(match.group(1)) if match else 'no browser verdict'
                    if verdict != 'PASS':
                        raise AssertionError(f'{width}x{height}, {count} metrics: {verdict}')
                    print(f'{width}x{height}, {count} metrics: PASS')
        finally:
            server.shutdown()
            thread.join()


if __name__ == '__main__':
    main()
