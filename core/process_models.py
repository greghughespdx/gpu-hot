"""Identify a loaded model only from a known GPU server command line."""

from collections.abc import Sequence
from functools import lru_cache
import hashlib
import json
import math
import os
from pathlib import Path
import re
import time
from urllib import error, request

import psutil

MODEL_FLAGS = {
    "llama-server": ("-m", "--model"),
    "ollama": ("--model",),
    "vllm": ("--model",),
}
OLLAMA_MODEL_LAYER = "application/vnd.ollama.image.model"
OLLAMA_BLOB = re.compile(r"sha256-([0-9a-f]{64})\Z")
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_MANIFEST_FILES = 512
MAX_RUNNING_BYTES = 1024 * 1024
DEFAULT_OLLAMA_API = "http://127.0.0.1:11434"
MAX_VRAM_ERROR_RATIO = 0.25
MIN_RUNNER_UP_GAP_RATIO = 0.10


def _option(args: Sequence[str], *names: str) -> str | None:
    for index, arg in enumerate(args):
        if arg in names and index + 1 < len(args) and args[index + 1] and not args[index + 1].startswith("-"):
            return args[index + 1]
        for name in names:
            if arg.startswith(f"{name}=") and arg[len(name) + 1 :]:
                return arg[len(name) + 1 :]
    return None


def _manifest_name(root: Path, path: Path) -> str | None:
    parts = path.relative_to(root).parts
    if len(parts) != 4:
        return None
    registry, namespace, name, tag = parts
    if not all(parts):
        return None
    if registry == "registry.ollama.ai" and namespace == "library":
        return f"{name}:{tag}"
    return f"{registry}/{namespace}/{name}:{tag}"


@lru_cache(maxsize=128)
def _matching_manifests(root_name: str, blob_digest: str, time_slot: int) -> tuple[tuple[str, str], ...]:
    root = Path(root_name)
    if not root.is_dir():
        return ()
    matches = []
    try:
        paths = root.rglob("*")
        for index, path in enumerate(paths):
            if index >= MAX_MANIFEST_FILES:
                break
            try:
                if path.is_symlink() or not path.is_file():
                    continue
                name = _manifest_name(root, path)
                if not name or path.stat().st_size > MAX_MANIFEST_BYTES:
                    continue
                with path.open("rb") as handle:
                    raw = handle.read(MAX_MANIFEST_BYTES + 1)
                if len(raw) > MAX_MANIFEST_BYTES:
                    continue
                manifest = json.loads(raw)
                if not isinstance(manifest, dict) or not isinstance(manifest.get("layers"), list):
                    continue
                if any(isinstance(layer, dict) and layer.get("mediaType") == OLLAMA_MODEL_LAYER
                       and layer.get("digest") == blob_digest for layer in manifest["layers"]):
                    matches.append((name, hashlib.sha256(raw).hexdigest()))
            except (OSError, ValueError, TypeError, json.JSONDecodeError):
                continue
    except (OSError, ValueError):
        return tuple(sorted(matches))
    return tuple(sorted(matches))


@lru_cache(maxsize=32)
def _running_models(api_base: str, time_slot: int) -> tuple[tuple[str, str, int | None], ...]:
    endpoint = f"{api_base.rstrip('/')}/api/ps"
    try:
        call = request.Request(endpoint, headers={"Accept": "application/json"})
        with request.urlopen(call, timeout=1) as response:
            if response.status != 200:
                return ()
            raw = response.read(MAX_RUNNING_BYTES + 1)
        if len(raw) > MAX_RUNNING_BYTES:
            return ()
        payload = json.loads(raw)
        if not isinstance(payload, dict):
            return ()
        models = payload.get("models", [])
        if not isinstance(models, list):
            return ()
        running = []
        for model in models:
            if not isinstance(model, dict):
                continue
            name, digest = model.get("name"), model.get("digest")
            if not isinstance(name, str) or not name or not isinstance(digest, str):
                continue
            vram = model.get("size_vram")
            running.append((name, digest, vram if type(vram) is int and vram > 0 else None))
        return tuple(running)
    except (error.URLError, TimeoutError, OSError, ValueError, TypeError, json.JSONDecodeError):
        return ()


def _ollama_manifest_root() -> Path:
    model_root = os.environ.get("OLLAMA_MODELS", "").strip()
    return (Path(model_root).expanduser() if model_root else Path.home() / ".ollama" / "models") / "manifests"


def _model_from_gpu_memory(
    gpu_memory_mib: float | None, running: tuple[tuple[str, str, int | None], ...]
) -> str | None:
    if gpu_memory_mib is None or not math.isfinite(gpu_memory_mib) or gpu_memory_mib <= 0:
        return None
    if len(running) < 2 or any(vram is None for _, _, vram in running):
        return None
    used_bytes = gpu_memory_mib * 1024 * 1024
    distances = sorted((abs(vram - used_bytes), name, vram) for name, _, vram in running)
    closest, runner_up = distances[:2]
    if closest[0] > closest[2] * MAX_VRAM_ERROR_RATIO:
        return None
    if runner_up[0] - closest[0] < used_bytes * MIN_RUNNER_UP_GAP_RATIO:
        return None
    return closest[1]


def _ollama_model_name(model_path: str, gpu_memory_mib: float | None = None) -> str:
    fallback = Path(model_path).name
    blob = OLLAMA_BLOB.fullmatch(fallback)
    if not blob:
        return fallback
    api = os.environ.get("GPU_HOT_OLLAMA_API", "").strip() or DEFAULT_OLLAMA_API
    running = _running_models(api, int(time.monotonic() // 5))
    manifests = _matching_manifests(
        str(_ollama_manifest_root()), f"sha256:{blob.group(1)}", int(time.monotonic() // 30)
    )
    manifest_digests = {digest for _, digest in manifests}
    active = {name for name, digest, _ in running if digest in manifest_digests}
    if len(active) == 1:
        return active.pop()
    if len(manifests) == 1:
        return manifests[0][0]
    if len(running) == 1:
        return running[0][0]
    return _model_from_gpu_memory(gpu_memory_mib, running) or fallback


def model_from_command_line(
    argv: list[str] | tuple[str, ...], gpu_memory_mib: float | None = None
) -> str | None:
    """Return a reported model for llama.cpp, Ollama, or vLLM servers."""
    if not argv or not all(isinstance(arg, str) for arg in argv):
        return None

    executable = Path(argv[0]).name
    if executable == "llama-server":
        model = _option(argv[1:], *MODEL_FLAGS[executable])
        if not model:
            return None
        if "/ollama/" in argv[0]:
            return _ollama_model_name(model, gpu_memory_mib)
        return _option(argv[1:], "--alias") or Path(model).name

    if executable == "ollama" and len(argv) > 1 and argv[1] == "runner":
        model = _option(argv[2:], *MODEL_FLAGS[executable])
        return _ollama_model_name(model, gpu_memory_mib) if model else None

    if executable == "vllm" and len(argv) > 1 and argv[1] == "serve":
        model = _option(argv[2:], *MODEL_FLAGS[executable]) or (
            argv[2] if len(argv) > 2 and not argv[2].startswith("-") else None
        )
        return Path(model).name if model else None

    if any(arg.startswith("vllm.entrypoints.") for arg in argv):
        model = _option(argv, *MODEL_FLAGS["vllm"])
        return Path(model).name if model else None
    return None


def model_for_pid(pid: int | str, gpu_memory_mib: float | None = None) -> str | None:
    """Read process arguments when visible; unknown and inaccessible stay empty."""
    try:
        return model_from_command_line(psutil.Process(int(pid)).cmdline(), gpu_memory_mib)
    except (ValueError, TypeError, OverflowError, psutil.Error, OSError):
        return None
