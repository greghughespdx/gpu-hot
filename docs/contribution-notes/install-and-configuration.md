# Install and configuration

This covers what the pull requests add: AMD nodes, an optional fan mapping for
passive cards, and a health endpoint for hub mode. The NVIDIA installation
method is unchanged.

## NVIDIA nodes

The installation method does not change: `docker-compose.yml` and
`docker run --gpus all` still use the NVIDIA Container Toolkit. Three small
things change in what a NVIDIA node reports. Every record carries a `vendor`
field set to `nvidia`. A fan reading of zero is kept as a reading while a driver
reporting no fan leaves the field absent, and the nvidia-smi fallback records a
normalized PCI bus id. `/health` exists, and the container healthcheck points
at it.

## AMD node, sysfs only

The same application image runs on an AMD host. Metrics come from the amdgpu
driver's sysfs and hwmon files, so ROCm, `amd-smi`, `/dev/dri` and `/dev/kfd`
are not needed:

```bash
NODE_NAME=$(hostname) docker compose -f docker-compose.amd.yml up --build -d
```

In the AMD compose file `NODE_NAME` defaults to `gpu-hot-node` if unset; the
application itself falls back to the hostname. A card is treated as AMD only
when its bound driver is exactly `amdgpu`.

Reported from sysfs and hwmon: utilization, VRAM used, total and free,
edge and memory temperature, power draw and limit, graphics and memory clocks
with their maximums, PCIe generation and lane width, device name, UUID and PCI
bus ID. Fields with no honest AMD source are left absent rather than set to
zero: fan speed on a passive card, P-state, compute mode, MIG, NVLink, ECC
detail, BAR1 memory, energy, encoder and decoder figures, PCIe throughput,
SM and video clocks, driver and VBIOS version.

## AMD process and throttle enrichment, optional

If an `amd-smi` binary is on `PATH`, the collector also polls `amd-smi list`,
`process`, `metric` and `static` every 10 seconds, with a 5 second timeout per
call, to add per-process VRAM and throttle status. If the binary is missing or
a call fails, the sysfs metrics continue unaffected.

Enrichment is a separate compose override so nobody takes its permissions just
to get temperature and power:

```bash
NODE_NAME=$(hostname) \
ROCM_HOST_PATH=/opt/rocm/core-7.14 \
docker compose -f docker-compose.amd.yml -f docker-compose.amd-smi.yml up --build -d
```

Set `ROCM_HOST_PATH` to the host directory holding `bin/amd-smi` and `lib`. It
is mounted read-only at `/opt/rocm/core-7.14` in the container, and `PATH` and
`LD_LIBRARY_PATH` are pointed at it.

What the override adds, and why:

| Setting | Why |
|---|---|
| read-only mount of the host ROCm tree | supplies the `amd-smi` binary and its libraries |
| `/dev/dri` and `/dev/kfd` | `amd-smi` opens the render and compute devices |
| `cap_add: SYS_PTRACE` | reading host process names and their GPU memory |
| `security_opt: apparmor=unconfined` | the same process inspection under AppArmor |

Host PID mode is already set in the base AMD compose file. Use the override
only on a trusted host.

### When a busy AMD GPU shows no processes

`amd-smi process --json` can exit successfully with
`No running processes detected` when the container sees KFD clients but cannot
inspect a host process. In that state `rocm-smi --showpids --json` may still
list the client, so an empty `amd-smi` result is not proof the GPU is idle.
Compare the two inside the node container:

```bash
docker compose -f docker-compose.amd.yml -f docker-compose.amd-smi.yml \
  exec gpu-hot amd-smi process --json
docker compose -f docker-compose.amd.yml -f docker-compose.amd-smi.yml \
  exec gpu-hot rocm-smi --showpids --json
```

If only `rocm-smi` sees the client, recreate the node with both compose files.
An equivalent manual `docker run` must keep `--pid=host`,
`--cap-add=SYS_PTRACE` and `--security-opt apparmor=unconfined`. The collector
does not substitute guessed process data for a successful empty `amd-smi`
response, because `rocm-smi --showpids` does not give the same per-GPU payload.

## External fans for passive cards

A passive server card has no fan of its own. The fan cooling it sits on a
chassis or duct controller that Linux exposes through hwmon. `EXTERNAL_FANS`
maps a GPU's PCI address to one of those channels. It is off unless set, and it
applies to any vendor, because the mapping is keyed by PCI address and applied
after the vendor collector runs.

```bash
EXTERNAL_FANS='{
  "0000:19:00.0": {"source": "hwmon", "name": "chassis_fan", "channel": 1},
  "0000:67:00.0": {"source": "hwmon", "name": "chassis_fan", "channel": 2}
}'
```

| Field | Meaning |
|---|---|
| `source` | `hwmon`, the only kind today |
| `name` | hwmon device name, matched in `/sys/class/hwmon/*/name`. Preferred; numbers move |
| `path` | an hwmon directory, named directly. An entry gives `name` or `path`, never both |
| `channel` | the channel number `N` in that device's `fanN_input` and `pwmN` |
| `override` | `true` to use the mapping even when the card reports its own fan. Default `false` |

`pwmN` becomes `fan_speed`, as a percentage of the kernel's 0 to 255 range, and
`fanN_input` becomes `fan_rpm`, shown under the fan reading on the GPU card.
Either is omitted if its file is missing, so a controller with no tachometer
still reports a speed. A malformed entry is skipped with a log line and the rest
of the mapping still loads. If two hwmon devices answer to the same `name`, that
entry reports nothing rather than guess, and says so once in the log: give it an
explicit `path` instead.

Find the names, channels and PCI addresses with:

```bash
grep . /sys/class/hwmon/*/name
grep . /sys/class/hwmon/hwmonN/fan*_input /sys/class/hwmon/hwmonN/pwm*
ls -l /sys/class/drm/card*/device
```

Docker already mounts the host's `/sys` read-only, so `/sys/class/hwmon` is
visible inside the container. The variable itself has to reach the container:
the compose files pass `EXTERNAL_FANS` through when it is set in the
environment, and `docker run` takes it as `-e EXTERNAL_FANS='...'`.

For example, the controller this was developed against is the ARCTIC ACFAN00351A,
a USB fan controller with ten channels that Linux exposes as the `arctic_fan`
hwmon device. The control loop that drives it from GPU temperature is a separate
project: https://github.com/greghughespdx/arctic-gpu-fan-control. gpu-hot only
reads what that device reports.

## Health endpoint

`GET /health` is new, and the container healthcheck now points at it.

In node mode it returns `{"status": "healthy", "mode": "node"}`.

In hub mode it returns `status`, `mode`, `reason`, `configured_nodes`,
`fresh_nodes` and `newest_update_age_seconds`, with HTTP 503 when no node has
data newer than `HUB_HEALTH_STALE_SECONDS` (30 seconds). `reason` is one of
`fresh_node_data`, `node_data_stale` or `no_node_data`. Freshness is measured
with a monotonic clock, so a system clock change cannot make stale data look
fresh. Hub mode is otherwise configured as it is today, with `GPU_HOT_MODE=hub`
and `NODE_URLS`.
