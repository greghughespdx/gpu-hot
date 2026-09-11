"""Tests for vendor monitor composition."""

import asyncio
import json

from pathlib import Path
from unittest.mock import Mock, patch

import pytest

from core.amd import AMDCollector, discover_amd_devices
from core import monitor_factory
from core.external_fans import create_external_fan_reader
from core.monitor_factory import MonitorComposition


class StubNvidiaMonitor:
    def __init__(self, initialized, gpu_data, processes):
        self.initialized = initialized
        self.use_smi = {}
        self.gpu_data = gpu_data
        self.processes = processes

    async def get_gpu_data(self):
        return self.gpu_data

    async def get_processes(self):
        return self.processes


class StubAMDCollector:
    def collect(self):
        return (
            {
                "0": {"index": "0", "vendor": "amd"},
                "1": {"index": "1", "vendor": "amd"},
            },
            [{"gpu_id": "0", "gpu_uuid": "AMD-one"}],
        )


@pytest.mark.asyncio
async def test_amd_only_monitor_works_without_nvml():
    nvidia = StubNvidiaMonitor(False, {}, [])
    fixture_root = Path(__file__).parents[1] / "fixtures" / "amd" / "sys" / "class" / "drm"
    amd = AMDCollector(discover_amd_devices(fixture_root), amd_smi_path="")
    monitor = MonitorComposition(nvidia, amd)

    data = await monitor.get_gpu_data()
    processes = await monitor.get_processes()

    assert list(data) == ["0", "1"]
    assert data["0"]["index"] == "0"
    assert data["0"]["vendor"] == "amd"
    assert processes == []


@pytest.mark.asyncio
async def test_mixed_monitor_remaps_overlapping_ordinals_to_bare_indices():
    nvidia = StubNvidiaMonitor(
        True,
        {"0": {"vendor": "nvidia", "uuid": "GPU-one"}},
        [{"gpu_id": "0", "gpu_uuid": "GPU-one"}],
    )
    monitor = MonitorComposition(nvidia, StubAMDCollector())

    data, processes = await asyncio.gather(
        monitor.get_gpu_data(), monitor.get_processes()
    )

    assert set(data) == {"0", "1", "2"}
    assert data["0"]["vendor"] == "nvidia"
    assert data["1"]["vendor"] == "amd"
    assert data["1"]["index"] == "1"
    assert data["2"]["vendor"] == "amd"
    assert data["2"]["index"] == "2"
    assert [process["gpu_id"] for process in processes] == ["0", "1"]


@pytest.mark.asyncio
@pytest.mark.parametrize("non_amdgpu", [False, True], ids=["empty-tree", "non-amdgpu-tree"])
async def test_create_monitor_skips_amd_for_empty_or_non_amdgpu_tree(tmp_path, non_amdgpu):
    if non_amdgpu:
        device = tmp_path / "card0" / "device"
        device.mkdir(parents=True)
        (device / "driver").write_text("simple-framebuffer\n")

    nvidia = StubNvidiaMonitor(
        True,
        {"0": {"vendor": "nvidia"}},
        [],
    )
    amd_constructor = Mock(side_effect=AssertionError("AMDCollector must not be constructed"))
    with (
        patch.object(monitor_factory, "GPUMonitor", return_value=nvidia),
        patch.object(monitor_factory, "AMDCollector", amd_constructor),
        patch("core.amd.subprocess.run") as subprocess_run,
    ):
        monitor = monitor_factory.create_monitor(tmp_path)
        data = await monitor.get_gpu_data()

    assert monitor.nvidia is nvidia
    assert monitor.amd is None
    assert data == {"0": {"vendor": "nvidia"}}
    amd_constructor.assert_not_called()
    subprocess_run.assert_not_called()


@pytest.mark.asyncio
async def test_external_fans_are_applied_after_both_collectors():
    hwmon_root = (
        Path(__file__).parents[1] / "fixtures" / "external_fans" / "sys" / "class" / "hwmon"
    )
    nvidia = StubNvidiaMonitor(
        True,
        {"0": {"vendor": "nvidia", "pci_bus_id": "00000000:19:00.0"}},
        [],
    )

    class StubAMDWithAddress:
        def collect(self):
            return ({"0": {"index": "0", "vendor": "amd", "pci_bus_id": "0000:67:00.0"}}, [])

    reader = create_external_fan_reader(
        json.dumps(
            {
                "0000:19:00.0": {"name": "arctic_fan", "channel": 1},
                "0000:67:00.0": {"name": "arctic_fan", "channel": 2},
            }
        ),
        hwmon_root,
    )
    monitor = MonitorComposition(nvidia, StubAMDWithAddress(), reader)

    data = await monitor.get_gpu_data()

    assert data["0"]["fan_rpm"] == 3705
    assert data["1"]["fan_rpm"] == 3441


@pytest.mark.asyncio
async def test_monitor_without_external_fans_adds_no_fan_fields():
    nvidia = StubNvidiaMonitor(True, {"0": {"vendor": "nvidia", "pci_bus_id": "0000:19:00.0"}}, [])
    monitor = MonitorComposition(nvidia, None)

    data = await monitor.get_gpu_data()

    assert data == {"0": {"vendor": "nvidia", "pci_bus_id": "0000:19:00.0"}}


@pytest.mark.asyncio
async def test_a_deeply_nested_external_fans_value_still_starts_the_monitor(tmp_path):
    """A bad EXTERNAL_FANS value disables the mapping; it never stops startup.

    Deep nesting reaches the interpreter's recursion limit inside the JSON
    parser, which is not the ValueError a malformed document raises, so it has
    to be contained here or node construction never returns.
    """
    nested = "[" * 2000 + "]" * 2000
    nvidia = StubNvidiaMonitor(True, {"0": {"vendor": "nvidia"}}, [])

    with (
        patch.object(monitor_factory, "GPUMonitor", return_value=nvidia),
        patch.object(monitor_factory, "EXTERNAL_FANS", nested),
    ):
        monitor = monitor_factory.create_monitor(tmp_path)
        data = await monitor.get_gpu_data()

    assert monitor.external_fans.mapping == {}
    assert not monitor.external_fans
    assert data == {"0": {"vendor": "nvidia"}}
