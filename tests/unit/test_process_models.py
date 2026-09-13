"""Model labels come from recognized process arguments, not a model catalog."""

from unittest.mock import MagicMock, patch

import psutil

from core.process_models import model_for_pid, model_from_command_line


INF1_Q4 = [
    "/opt/llama.cpp-new/build/bin/llama-server",
    "-m", "/opt/models/Qwen3.8-27B-UD-Q4_K_XL.gguf",
    "--mmproj", "/opt/models/mmproj-F16.gguf",
    "--alias", "qwen38-q4",
]
OLLAMA_TRUENAS = [
    "/usr/lib/ollama/llama-server",
    "--model", "/root/.ollama/models/blobs/sha256-e7b273f9636059a689e3ddcab3716e4f65abe0143ac978e46673ad0e52d09efb",
    "--port", "43961",
]


def test_inf1_llama_alias_wins_over_file():
    assert model_from_command_line(INF1_Q4) == "qwen38-q4"


def test_llama_without_alias_uses_model_file():
    assert model_from_command_line(INF1_Q4[:-2]) == "Qwen3.8-27B-UD-Q4_K_XL.gguf"


def test_truenas_ollama_runner_uses_file_name():
    assert model_from_command_line(OLLAMA_TRUENAS) == OLLAMA_TRUENAS[2].rsplit("/", 1)[-1]


def test_vllm_servers_use_model_argument():
    assert model_from_command_line(["/opt/venv/bin/vllm", "serve", "Qwen/Qwen3-8B"]) == "Qwen3-8B"
    assert model_from_command_line([
        "python", "-m", "vllm.entrypoints.openai.api_server", "--model", "Qwen/Qwen3-8B"
    ]) == "Qwen3-8B"


def test_unknown_or_incomplete_process_has_no_model():
    assert model_from_command_line(["python", "train.py", "-m", "/tmp/weights.gguf"]) is None
    assert model_from_command_line(["/opt/llama-server", "--mmproj", "/tmp/projector.gguf"]) is None
    assert model_from_command_line(["/opt/llama-server", "-m", "--port", "8080"]) is None
    assert model_from_command_line(["vllm", "serve"]) is None


def test_inaccessible_process_has_no_model():
    with patch("core.process_models.psutil.Process", side_effect=psutil.AccessDenied(pid=7)):
        assert model_for_pid(7) is None


def test_model_for_pid_reads_arguments():
    process = MagicMock()
    process.cmdline.return_value = INF1_Q4
    with patch("core.process_models.psutil.Process", return_value=process):
        assert model_for_pid("696825") == "qwen38-q4"
