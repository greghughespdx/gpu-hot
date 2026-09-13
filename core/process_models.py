"""Identify a loaded model only from a known GPU server command line."""

from collections.abc import Sequence
from pathlib import Path

import psutil

MODEL_FLAGS = {
    "llama-server": ("-m", "--model"),
    "ollama": ("--model",),
    "vllm": ("--model",),
}


def _option(args: Sequence[str], *names: str) -> str | None:
    for index, arg in enumerate(args):
        if arg in names and index + 1 < len(args) and args[index + 1] and not args[index + 1].startswith("-"):
            return args[index + 1]
        for name in names:
            if arg.startswith(f"{name}=") and arg[len(name) + 1 :]:
                return arg[len(name) + 1 :]
    return None


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
            return model
        return _option(argv[1:], "--alias") or Path(model).name

    if executable == "ollama" and len(argv) > 1 and argv[1] == "runner":
        return _option(argv[2:], *MODEL_FLAGS[executable])

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
