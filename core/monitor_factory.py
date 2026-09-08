"""Compose NVIDIA and AMD monitors behind the existing monitor interface."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from .amd import AMDCollector, discover_amd_devices
from .monitor import GPUMonitor

logger = logging.getLogger(__name__)


class MonitorComposition:
    """Expose one monitor interface for any detected GPU vendors."""

    def __init__(self, nvidia_monitor: GPUMonitor | None, amd_collector: AMDCollector | None):
        self.nvidia = nvidia_monitor
        self.amd = amd_collector
        self.running = False
        self.use_smi = getattr(nvidia_monitor, "use_smi", {}) or {}
        self._amd_data: dict[str, dict] = {}
        self._amd_processes: list[dict] = []
        self._amd_collection_lock = asyncio.Lock()
        self._amd_task: asyncio.Task | None = None

    async def get_gpu_data(self) -> dict[str, dict]:
        gpu_payloads: dict[str, dict] = {}
        if self.nvidia is not None and getattr(self.nvidia, "initialized", False):
            try:
                gpu_payloads.update(await self.nvidia.get_gpu_data())
            except Exception as error:
                logger.error("NVIDIA collection failed: %s", error)
        if self.amd is not None:
            await self._refresh_amd()
            gpu_payloads.update(self._amd_data)
        return gpu_payloads

    async def get_processes(self) -> list[dict]:
        process_records: list[dict] = []
        if self.nvidia is not None and getattr(self.nvidia, "initialized", False):
            try:
                process_records.extend(await self.nvidia.get_processes())
            except Exception as error:
                logger.error("NVIDIA process collection failed: %s", error)
        if self.amd is not None:
            await self._await_amd()
            process_records.extend(self._amd_processes)
        return process_records

    async def _refresh_amd(self) -> None:
        async with self._amd_collection_lock:
            self._amd_task = asyncio.create_task(self._collect_amd_once())
            await self._amd_task

    async def _await_amd(self) -> None:
        if self._amd_task is None:
            await self._refresh_amd()
            return
        await self._amd_task

    async def _collect_amd_once(self) -> None:
        try:
            self._amd_data, self._amd_processes = await asyncio.get_event_loop().run_in_executor(
                None, self.amd.collect
            )
        except Exception as error:
            logger.error("AMD collection failed: %s", error)

    async def shutdown(self) -> None:
        if self.nvidia is not None and hasattr(self.nvidia, "shutdown"):
            await self.nvidia.shutdown()


def create_monitor(sysfs_root: str | Path = "/sys/class/drm") -> MonitorComposition:
    """Construct only the collectors needed by the local hardware."""
    nvidia = GPUMonitor()
    devices = discover_amd_devices(sysfs_root)
    amd = AMDCollector(devices) if devices else None
    if not devices:
        logger.info("No AMD GPUs detected")
    return MonitorComposition(nvidia, amd)
