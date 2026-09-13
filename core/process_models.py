"""Identify a loaded model only from a known GPU server command line."""

from collections.abc import Sequence
from functools import lru_cache
import hashlib
import json
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
def _running_models(api_base: str, time_slot: int) -> tuple[tuple[str, str], ...]:
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
        return tuple((model["name"], model["digest"])
                     for model in models if isinstance(model, dict)
                     and isinstance(model.get("name"), str)
                     and isinstance(model.get("digest"), str))
    except (error.URLError, TimeoutError, OSError, ValueError, TypeError, json.JSONDecodeError):
        return ()


def _common_model_base(names: Sequence[str]) -> str | None:
    bases = [name.rsplit(":", 1)[0] for name in names]
    prefix = os.path.commonprefix(bases).rstrip("-_.")
    if prefix and all(base == prefix or base.startswith((prefix + "-", prefix + "_", prefix + "."))
                      for base in bases):
        return prefix
    return None


def _ollama_model_name(model_path: str) -> str:
    fallback = Path(model_path).name
    blob = OLLAMA_BLOB.fullmatch(fallback)
    root = os.environ.get("GPU_HOT_OLLAMA_MANIFESTS", "").strip()
    if not blob or not root:
        return fallback
    matches = _matching_manifests(root, f"sha256:{blob.group(1)}", int(time.monotonic() // 30))
    if len(matches) == 1:
        return matches[0][0]
    if len(matches) > 1:
        api = os.environ.get("GPU_HOT_OLLAMA_API", "").strip()
        if api:
            running = _running_models(api, int(time.monotonic() // 5))
            active = {name for name, digest in running
                      if any(digest == manifest_digest and name == alias
                             for alias, manifest_digest in matches)}
            if len(active) == 1:
                return active.pop()
        return _common_model_base([name for name, _ in matches]) or fallback
    return fallback


def model_from_command_line(argv: list[str] | tuple[str, ...]) -> str | None:
    """Return a reported model for llama.cpp, Ollama, or vLLM servers."""
    if not argv or not all(isinstance(arg, str) for arg in argv):
        return None

    executable = Path(argv[0]).name
    if executable == "llama-server":
        model = _option(argv[1:], *MODEL_FLAGS[executable])
        if not model:
            return None
        if "/ollama/" in argv[0]:
            return _ollama_model_name(model)
        return _option(argv[1:], "--alias") or Path(model).name

    if executable == "ollama" and len(argv) > 1 and argv[1] == "runner":
        model = _option(argv[2:], *MODEL_FLAGS[executable])
        return _ollama_model_name(model) if model else None

    if executable == "vllm" and len(argv) > 1 and argv[1] == "serve":
        return _option(argv[2:], *MODEL_FLAGS[executable]) or (
            argv[2] if len(argv) > 2 and not argv[2].startswith("-") else None
        )

    if any(arg.startswith("vllm.entrypoints.") for arg in argv):
        return _option(argv, *MODEL_FLAGS["vllm"])
    return None


def model_for_pid(pid: int | str) -> str | None:
    """Read process arguments when visible; unknown and inaccessible stay empty."""
    try:
        return model_from_command_line(psutil.Process(int(pid)).cmdline())
    except (ValueError, TypeError, OverflowError, psutil.Error, OSError):
        return None
