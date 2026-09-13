"""Check the settings cards using layout from a real browser."""

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
    const panel = document.querySelector('#settings-panel');
    panel.hidden = false;
    const cards = [...panel.querySelectorAll('.settings-body > .settings-group')];
    const selects = [...panel.querySelectorAll('.settings-row select')];
    const failures = [];
    const near = (actual, expected) => Math.abs(actual - expected) < 1;
    if (innerWidth !== Number(location.hash.slice(1))) failures.push('viewport width');
    if (cards.length !== 5) failures.push('card count');
    cards.forEach((card, index) => {
        const box = card.getBoundingClientRect();
        const heading = card.querySelector('h3')?.getBoundingClientRect();
        const style = getComputedStyle(card);
        if (!heading || heading.top < box.top || heading.bottom > box.bottom
            || heading.left < box.left || heading.right > box.right) {
            failures.push(`heading outside card ${index}`);
        }
        if (!near(parseFloat(style.borderTopWidth), 1)
            || !near(parseFloat(style.borderTopLeftRadius), 8)
            || !near(parseFloat(style.paddingTop), 12)) {
            failures.push(`card geometry ${index}`);
        }
        if (index && !near(box.top - cards[index - 1].getBoundingClientRect().bottom, 12)) {
            failures.push(`card gap ${index}`);
        }
    });
    if (selects.length !== 4) failures.push('select count');
    const selectBoxes = selects.map(select => select.getBoundingClientRect());
    if (selectBoxes.some(box => !near(box.left, selectBoxes[0].left)
        || !near(box.width, selectBoxes[0].width))) {
        failures.push('select alignment');
    }
    if (innerWidth > 480 && !near(selectBoxes[0]?.width, 190)) {
        failures.push('desktop select width');
    }
    if (innerWidth <= 480 && (selectBoxes[0]?.right > panel.getBoundingClientRect().right
        || document.documentElement.scrollWidth > innerWidth)) {
        failures.push('phone overflow');
    }
    const output = document.createElement('output');
    output.id = 'geometry-test-result';
    output.textContent = failures.length ? failures.join(', ') : 'PASS';
    document.body.append(output);
});
</script>
"""


class GeometryHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: object, **kwargs: object) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        if self.path != "/templates/index.html":
            super().do_GET()
            return
        template = (ROOT / "templates/index.html").read_text(encoding="utf-8")
        # Keep the real markup, CSS, and settings script; unrelated scripts poll live services.
        template = re.sub(r'<script src="(?!/static/js/settings\.js)[^"]+"></script>', "", template)
        template = re.sub(r'<link href="https://fonts\.googleapis\.com[^>]+>', "", template)
        page = template.replace("</body>", CHECK + "</body>").encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(page)))
        self.end_headers()
        self.wfile.write(page)

    def log_message(self, *args: object) -> None:
        pass


def browser_binary() -> str:
    for cache in (Path.home() / "Library/Caches/ms-playwright", Path.home() / ".cache/ms-playwright"):
        shells = sorted(cache.glob("chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell"))
        if shells:
            return str(shells[-1])
    browser = shutil.which("chrome-headless-shell")
    if browser is None:
        raise RuntimeError("Playwright Chromium headless shell is required for rendered geometry tests")
    return browser


def main() -> None:
    with ThreadingHTTPServer(("127.0.0.1", 0), GeometryHandler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for width, height in ((1440, 900), (390, 844)):
                with tempfile.TemporaryDirectory(prefix="gpu-hot-geometry-") as profile:
                    url = f"http://127.0.0.1:{server.server_port}/templates/index.html#{width}"
                    browser = subprocess.run(
                        [browser_binary(), "--headless=new", "--disable-gpu",
                         "--no-first-run", "--disable-background-networking",
                         "--force-device-scale-factor=1", f"--window-size={width},{height}",
                         "--virtual-time-budget=3000", f"--user-data-dir={profile}",
                         "--dump-dom", url],
                        capture_output=True, text=True, timeout=30, check=True,
                    )
                    match = re.search(r'<output id="geometry-test-result">([^<]*)</output>', browser.stdout)
                    verdict = unescape(match.group(1)) if match else "no browser verdict"
                    if verdict != "PASS":
                        raise AssertionError(f"{width}x{height}: {verdict}")
                    print(f"{width}x{height}: PASS")
        finally:
            server.shutdown()
            thread.join()


if __name__ == "__main__":
    main()
