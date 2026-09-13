"""Check setup-code copying on a plain HTTP LAN origin in headless Chromium."""

from html import unescape
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import threading


ROOT = Path(__file__).resolve().parents[2]
CHECK = r"""
<script>
document.addEventListener('DOMContentLoaded', async () => {
    const result = document.createElement('output');
    result.id = 'setup-copy-test-result';
    document.body.append(result);
    const params = new URLSearchParams(location.search);
    const direct = params.has('direct');
    const blocked = params.has('blocked');
    const failures = [];
    if (window.isSecureContext || navigator.clipboard !== undefined) {
        failures.push('not a plain HTTP clipboard context');
    }
    let selectedCode = '';
    let legacyCalls = 0;
    document.execCommand = command => {
        legacyCalls++;
        const selected = document.activeElement;
        if (!document.getElementById('settings-panel').contains(selected)
            || selected.className !== 'settings-copy-buffer'
            || selected.selectionStart !== 0
            || selected.selectionEnd !== selected.value.length) {
            failures.push('copy selection lost inside panel');
        }
        selectedCode = selected.value;
        return command === 'copy' && !blocked;
    };
    if (direct) {
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: async code => { selectedCode = code; } }
        });
    }
    document.getElementById('settings-open').click();
    if (document.getElementById('settings-panel').hidden) failures.push('panel did not open');
    document.getElementById('settings-copy-setup').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    if (!window.GPUHotSettings.decodeSetupCode(selectedCode)) failures.push('no copied code');
    if (legacyCalls !== (direct ? 0 : 1)) failures.push('wrong copy path');
    const dialog = document.getElementById('settings-copy-dialog');
    const status = document.getElementById('settings-setup-status').textContent;
    if (blocked) {
        const field = document.getElementById('settings-copy-code');
        if (!dialog.open || !field.readOnly || field.value !== selectedCode
            || document.activeElement !== field || field.selectionStart !== 0
            || field.selectionEnd !== field.value.length) {
            failures.push('failed copy did not open selected code dialog');
        }
        if (status === 'Copied to clipboard') failures.push('false success status');
        document.getElementById('settings-copy-close').click();
        if (dialog.open) failures.push('copy dialog did not close');
    } else if (status !== 'Copied to clipboard' || dialog.open) {
        failures.push('missing success status');
    }
    if (document.querySelector('.settings-copy-buffer')) {
        failures.push('temporary copy field left behind');
    }
    result.textContent = failures.length ? failures.join(', ') : 'PASS';
});
</script>
"""


class CopyHandler(SimpleHTTPRequestHandler):
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


def lan_address() -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.connect(('198.51.100.1', 9))
        address = probe.getsockname()[0]
    if address.startswith('127.'):
        raise RuntimeError('A non-loopback address is needed to test insecure clipboard access')
    return address


def browser_binary() -> str:
    for cache in (Path.home() / 'Library/Caches/ms-playwright', Path.home() / '.cache/ms-playwright'):
        shells = sorted(cache.glob('chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell'))
        if shells:
            return str(shells[-1])
    browser = shutil.which('chrome-headless-shell')
    if browser is None:
        raise RuntimeError('Chromium headless shell is required for the HTTP copy test')
    return browser


def main() -> None:
    host = lan_address()
    with ThreadingHTTPServer((host, 0), CopyHandler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for name, suffix in (
                ('HTTP fallback', ''),
                ('direct API', '?direct'),
                ('blocked copy dialog', '?blocked'),
            ):
                with tempfile.TemporaryDirectory(prefix='gpu-hot-copy-') as profile:
                    url = f'http://{host}:{server.server_port}/templates/index.html{suffix}'
                    try:
                        browser = subprocess.run(
                            [browser_binary(), '--headless=new', '--disable-gpu',
                             '--no-first-run', '--disable-background-networking',
                             f'--user-data-dir={profile}', '--virtual-time-budget=3000',
                             '--dump-dom', url],
                            capture_output=True, text=True, timeout=30, check=True,
                        )
                    except subprocess.TimeoutExpired as error:
                        raise AssertionError(
                            f'{name}: headless browser timed out; stderr={error.stderr!r}'
                        ) from error
                    match = re.search(r'<output id="setup-copy-test-result">([^<]*)</output>', browser.stdout)
                    verdict = unescape(match.group(1)) if match else 'no browser verdict'
                    if verdict != 'PASS':
                        raise AssertionError(f'{name}: {verdict}')
                    print(f'{name}: PASS')
        finally:
            server.shutdown()
            thread.join()


if __name__ == '__main__':
    main()
