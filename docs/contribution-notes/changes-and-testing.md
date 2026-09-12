# Changes and testing

Three branches, each cut from upstream main at `70b7919`. Line counts below are
measured from the diffs.

## PR A: AMD collector

New files:

- `core/amd.py` (753 lines). Device discovery, sysfs and hwmon reads, unit
  conversion, optional `amd-smi` parsing, process records.
- `core/monitor_factory.py` (121 lines). Composes the existing `GPUMonitor`
  with the AMD collector behind the same `get_gpu_data()`, `get_processes()`
  and `shutdown()` interface, and resolves index collisions on a mixed host.
- `docker-compose.amd.yml` and `docker-compose.amd-smi.yml` (33 lines).
- Tests and a recorded sysfs fixture tree under `tests/fixtures/amd/`.

Edited files, seven added and seven removed lines in total: `app.py` calls
`create_monitor()` instead of constructing `GPUMonitor`; `core/config.py`
changes `os.getenv('NODE_NAME', socket.gethostname())` to
`os.getenv('NODE_NAME') or socket.gethostname()` so an empty value falls back
to the hostname; `core/metrics/collector.py` and both parsers in
`core/nvidia_smi_fallback.py` gain one line each setting `vendor` to `nvidia`.
`README.md` gains 42 lines, and the `Dockerfile` base image is pinned by
digest.

Totals: 18 source and test files, 1465 added and 12 removed lines, plus 176
added lines across 43 fixture files.

Deliberately not changed: no file under `static/` or `templates/`, and no
change to `core/monitor.py`, `core/hub.py` or `core/hub_handlers.py`. The
NVIDIA collection path and the hub aggregation path are left as they are. On a
host with no AMD cards the AMD collector is never constructed.

Vendor field and key shape, in three sentences. AMD records are keyed by the
same bare numeric index as NVML records and carry the same field names, with
one new field, `vendor`, set to `amd` or `nvidia`. An earlier iteration keyed
AMD cards as `amd0` and `amd1`, which leaks vendor identity into the dictionary
key, shows up in the dashboard's navigation labels, and makes the payload shape
vendor-dependent. Moving the vendor into its own field keeps the key shape
identical to NVML's and leaves every display decision to you; the cost is the
collision case on a mixed host, handled by remapping AMD indices to the next
unused number and remapping the process records with them.

Missing fields are absent, not zero. A `0 RPM` fan reading on a passive card
and a `P0` state on a GPU with no P-states are both wrong in a way that is hard
to notice. The existing NVML collector already omits unsupported fields per
GPU, so absence is the codebase's own convention and the frontend tolerates it.
`memory_utilization` is omitted for AMD on the same grounds: AMD exposes
memory-controller activity, which is not the quantity NVML reports.

## PR B: hub broadcast and health

- `core/hub_handlers.py`: the broadcast loop iterates `list(connections)` and
  removes dead sockets with `difference_update`, so a client disconnecting
  mid-send no longer raises `RuntimeError: Set changed size during iteration`
  and cuts the broadcast short. The bare `except:` around the send becomes
  `except Exception:`. Node connections and the aggregation loop start from the
  application startup event rather than the first dashboard visit, and hub mode
  no longer pauses when the last client disconnects.
- `core/hub.py`: tracks `last_update_monotonic` per node and adds
  `get_health_status()`.
- `app.py`: adds `GET /health`, returning 503 in hub mode when no node is
  fresh.
- `core/config.py`: adds `HUB_HEALTH_STALE_SECONDS = 30.0`.
- `Dockerfile` and `docker-compose.yml`: the healthcheck moves from
  `/api/gpu-data` to `/health`.

Totals: 12 files, 247 added and 26 removed lines, of which 114 added lines are
tests. No file under `static/` or `templates/` changes, and no collector or
vendor-specific code is touched.

Deliberately not changed: single-node mode still pauses polling when no client
is connected. Only hub mode keeps running, which is the tradeoff for being able
to answer a health check before anyone opens a browser.

## PR C: external fans

- `core/external_fans.py` (324 lines, new). Parses `EXTERNAL_FANS`, resolves an
  hwmon device by name or path, reads `pwmN` and `fanN_input`, and fills
  `fan_speed` and `fan_rpm` on a mapped GPU's payload.
- `core/monitor_factory.py`: applies the mapping after the vendor collectors.
- `core/metrics/collector.py` and `core/nvidia_smi_fallback.py`: a fan reading
  of zero is kept as a reading, and a driver reporting no fan leaves the field
  absent, so the two stay distinguishable. The nvidia-smi parser also carries
  the PCI bus ID, normalized, which is the mapping key.
- `static/js/gpu-cards.js` (22 lines): two helpers and their wiring, to show a
  tachometer sub-value under the fan reading when one is present.
- `core/config.py` and `README.md`: the `EXTERNAL_FANS` variable and its
  documentation.

Totals against PR A: 14 files, 1219 added and 13 removed lines. Against
upstream main, which includes PR A's commit: 92 files, 2910 added and 22
removed lines.

Deliberately not changed: the mapping is off unless `EXTERNAL_FANS` is set, a
card that reports its own fan keeps it unless the entry sets `override`, and no
unrelated UI is touched.

## Unit tests

Run through the repository's own Docker test runner, `./run_tests.sh`, per
`tests/README.md`. Baseline is bare upstream main with no branch applied:
**136 backend passed; 158 frontend passed, 4 failed.**

| Branch | Backend | Frontend |
|---|---|---|
| upstream main (baseline) | 136 passed, 0 failed | 158 passed, 4 failed |
| PR A | 164 passed, 0 failed | 158 passed, 4 failed |
| PR B | 144 passed, 0 failed | 158 passed, 4 failed |
| PR C (stacked on A) | 246 passed, 0 failed | 165 passed, 4 failed |

No branch introduces a test failure.

The four frontend failures are pre-existing. They are the same assertions in
`tests/frontend/chart-manager.test.js` on every row, including the baseline row
with no branch code applied:

- `initGPUData > creates 120 data points per chart`
- `initGPUData > clocks has separate data arrays`
- `updateChart > pushes single-line value`
- `updateChart > maintains rolling window of 120 points`

They expect 120 data points where the implementation produces 240. PR A and
PR B touch no frontend file at all, so neither causes nor fixes them. PR C adds
7 frontend tests for the fan display and leaves those four as they were.

New backend test functions, counted from the diffs: PR A adds 19 in
`test_amd.py`, 3 in `test_monitor_factory.py`, 3 in `test_compose_config.py`
and 1 in `test_config.py`. PR B adds 4 for `Hub.get_health_status`, 2 endpoint
tests for `/health`, 1 for a client disconnecting mid-broadcast, and 1 compose
assertion that the healthcheck points at `/health`. PR C adds 38 in
`test_external_fans.py`, 13 in `test_nvidia_smi_fallback.py`, 3 in
`test_monitor_factory.py`, 2 in `test_collector.py` and 2 in `test_config.py`.
Several are parameterized, so the executed counts in the table are higher.

## Fixtures

The AMD tests run against a recorded sysfs tree at `tests/fixtures/amd/sys/`,
43 small files, and a recorded `amd-smi` JSON document. The fan tests use their
own recorded hwmon tree. No AMD hardware, no ROCm and no GPU of any kind is
needed to run the suite.

A Python 3.9 import check is included as `tests/Dockerfile.python39` and
`tests/docker-compose.python39.yml`: `core.amd` and `core.monitor_factory`
import cleanly under Python 3.9.19, so the `from __future__ import annotations`
style used here does not raise the project's floor.

## Mutation checks

Two deliberate regressions were introduced to confirm the tests catch them:
changing the GPU key shape back to a vendor-prefixed ID fails 16 tests, and
removing the mixed-vendor collision remap fails 1.

Live, the mapping was tested against an ARCTIC ACFAN00351A USB fan controller
(hwmon device `arctic_fan`) driving the blowers on two passive AMD cards per
host, with the fan control loop at https://github.com/greghughespdx/arctic-gpu-
fan-control setting the speeds gpu-hot reads back.

## Live test matrix

The fleet runs an integration build composed from exactly these three branches,
so one deployment of that build exercises all three at once. Dates are the
deployment dates.

| Branch | AMD node | NVIDIA node | Hub |
|---|---|---|---|
| PR A, AMD collector | done, two hosts with two Radeon Pro V620 each, 2026-09-11: all four GPUs reported, processes and per-process VRAM visible through amd-smi | done, one host with an NVIDIA A10M, 2026-09-11: same build, vendor field nvidia, its inference process visible | done, 2026-09-11: hub aggregates two AMD nodes, one NVIDIA container node, and one NVIDIA node outside Docker |
| PR B, hub health | node-mode /health answered on both AMD hosts | node-mode /health answered | done: /health reports fresh_node_data with four fresh nodes; it reported unhealthy no_node_data during a stack restart and recovered on its own |
| PR C, external fans | done, two hosts: fan_speed and fan_rpm from the chassis controller on all four cards | not exercised: no NVIDIA card here has an external fan; unit tests cover the NVIDIA path | done: hub shows the AMD fan readings |
