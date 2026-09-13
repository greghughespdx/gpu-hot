"""Model labels come from recognized process arguments, not a model catalog."""

import hashlib
from io import BytesIO
import json
from urllib.error import URLError
from unittest.mock import MagicMock, patch

import psutil
import pytest

from core.process_models import _matching_manifests, _running_models, model_for_pid, model_from_command_line


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


def add_manifest(root, name, tag, blob, config):
    path = root / "registry.ollama.ai" / "library" / name / tag
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps({"config": {"digest": config}, "layers": [{
        "mediaType": "application/vnd.ollama.image.model", "digest": blob
    }]}, separators=(",", ":")).encode()
    path.write_bytes(raw)
    return hashlib.sha256(raw).hexdigest()


class RunningResponse(BytesIO):
    status = 200


@pytest.fixture(autouse=True)
def clear_ollama_lookup_cache():
    _matching_manifests.cache_clear()
    _running_models.cache_clear()


def running_response(models):
    return RunningResponse(json.dumps({"models": models}).encode())


def test_inf1_llama_alias_wins_over_file():
    assert model_from_command_line(INF1_Q4) == "qwen38-q4"


def test_llama_without_alias_uses_model_file():
    assert model_from_command_line(INF1_Q4[:-2]) == "Qwen3.8-27B-UD-Q4_K_XL.gguf"


def test_truenas_ollama_runner_uses_file_name():
    with patch("core.process_models.request.urlopen", side_effect=URLError("offline")):
        assert model_from_command_line(OLLAMA_TRUENAS) == OLLAMA_TRUENAS[2].rsplit("/", 1)[-1]


def test_ollama_single_manifest_returns_model_tag(tmp_path, monkeypatch):
    monkeypatch.setenv("OLLAMA_MODELS", str(tmp_path))
    manifests = tmp_path / "manifests"
    blob = "sha256:" + OLLAMA_TRUENAS[2].rsplit("sha256-", 1)[-1]
    add_manifest(manifests, "gpt-oss-32k", "latest", blob, "sha256:config")
    with patch("core.process_models.request.urlopen", side_effect=URLError("offline")) as urlopen:
        assert model_from_command_line(OLLAMA_TRUENAS) == "gpt-oss-32k:latest"
        assert urlopen.call_args.args[0].full_url == "http://127.0.0.1:11434/api/ps"


def test_ollama_shared_blob_uses_running_manifest_digest(tmp_path, monkeypatch):
    monkeypatch.setenv("OLLAMA_MODELS", str(tmp_path))
    monkeypatch.setenv("GPU_HOT_OLLAMA_API", "http://127.0.0.1:11434")
    manifests = tmp_path / "manifests"
    blob = "sha256:" + OLLAMA_TRUENAS[2].rsplit("sha256-", 1)[-1]
    add_manifest(manifests, "gpt-oss", "latest", blob, "sha256:first")
    add_manifest(manifests, "gpt-oss-16k", "latest", blob, "sha256:second")
    active_digest = add_manifest(manifests, "gpt-oss-32k", "latest", blob, "sha256:third")
    payload = {"models": [{"name": "gpt-oss-32k:latest", "digest": active_digest}]}
    response = RunningResponse(json.dumps(payload).encode())
    with patch("core.process_models.request.urlopen", return_value=response) as urlopen:
        assert model_from_command_line(OLLAMA_TRUENAS) == "gpt-oss-32k:latest"
        assert urlopen.call_args.kwargs["timeout"] == 1
        assert urlopen.call_args.args[0].full_url == "http://127.0.0.1:11434/api/ps"


def test_ollama_shared_blob_keeps_digest_when_endpoint_fails(tmp_path, monkeypatch):
    monkeypatch.setenv("OLLAMA_MODELS", str(tmp_path))
    monkeypatch.setenv("GPU_HOT_OLLAMA_API", "http://127.0.0.1:11434")
    blob = "sha256:" + OLLAMA_TRUENAS[2].rsplit("sha256-", 1)[-1]
    for name in ("gpt-oss", "gpt-oss-16k", "gpt-oss-32k"):
        add_manifest(tmp_path / "manifests", name, "latest", blob, "sha256:" + name)
    with patch("core.process_models.request.urlopen", side_effect=URLError("offline")):
        assert model_from_command_line(OLLAMA_TRUENAS) == OLLAMA_TRUENAS[2].rsplit("/", 1)[-1]


def test_ollama_no_matching_manifest_keeps_blob_name(tmp_path, monkeypatch):
    monkeypatch.setenv("OLLAMA_MODELS", str(tmp_path))
    add_manifest(tmp_path / "manifests", "other", "latest", "sha256:other", "sha256:config")
    with patch("core.process_models.request.urlopen", side_effect=URLError("offline")):
        assert model_from_command_line(OLLAMA_TRUENAS) == OLLAMA_TRUENAS[2].rsplit("/", 1)[-1]


def test_ollama_unrelated_aliases_keep_digest_when_running_set_is_unavailable(tmp_path, monkeypatch):
    monkeypatch.setenv("OLLAMA_MODELS", str(tmp_path))
    monkeypatch.setenv("GPU_HOT_OLLAMA_API", "http://127.0.0.1:11434")
    blob = "sha256:" + OLLAMA_TRUENAS[2].rsplit("sha256-", 1)[-1]
    add_manifest(tmp_path / "manifests", "alpha", "latest", blob, "sha256:first")
    add_manifest(tmp_path / "manifests", "beta", "latest", blob, "sha256:second")
    with patch("core.process_models.request.urlopen", side_effect=URLError("offline")):
        assert model_from_command_line(OLLAMA_TRUENAS) == OLLAMA_TRUENAS[2].rsplit("/", 1)[-1]


def test_ollama_skips_bad_manifest_without_losing_a_valid_match(tmp_path, monkeypatch):
    monkeypatch.setenv("OLLAMA_MODELS", str(tmp_path))
    bad = tmp_path / "manifests" / "registry.ollama.ai" / "library" / "bad" / "latest"
    bad.parent.mkdir(parents=True)
    bad.write_text("not json")
    blob = "sha256:" + OLLAMA_TRUENAS[2].rsplit("sha256-", 1)[-1]
    add_manifest(tmp_path / "manifests", "gpt-oss-32k", "latest", blob, "sha256:valid")
    with patch("core.process_models.request.urlopen", side_effect=URLError("offline")):
        assert model_from_command_line(OLLAMA_TRUENAS) == "gpt-oss-32k:latest"


def test_ollama_standard_home_manifest_path_is_detected(tmp_path, monkeypatch):
    monkeypatch.delenv("OLLAMA_MODELS", raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
    blob = "sha256:" + OLLAMA_TRUENAS[2].rsplit("sha256-", 1)[-1]
    add_manifest(tmp_path / ".ollama" / "models" / "manifests", "gpt-oss", "latest", blob, "sha256:config")
    with patch("core.process_models.request.urlopen", side_effect=URLError("offline")):
        assert model_from_command_line(OLLAMA_TRUENAS) == "gpt-oss:latest"


def test_truenas_observed_running_set_resolves_without_manifests(tmp_path, monkeypatch):
    monkeypatch.setenv("OLLAMA_MODELS", str(tmp_path))
    monkeypatch.setenv("GPU_HOT_OLLAMA_API", "http://192.168.15.6:30068")
    # Name and digest were observed on TrueNAS; size_vram is fixture data.
    models = [{"name": "gpt-oss-32k:latest", "model": "gpt-oss-32k:latest",
               "digest": "a021b9dabfa4e01c12a469a94b18fde1cb46d178eb2b80361f3c0ebe9339bafa",
               "size_vram": 16 * 1024 ** 3}]
    with patch("core.process_models.request.urlopen", return_value=running_response(models)) as urlopen:
        assert model_from_command_line(OLLAMA_TRUENAS) == "gpt-oss-32k:latest"
        assert urlopen.call_args.args[0].full_url == "http://192.168.15.6:30068/api/ps"


def test_multiple_running_models_use_unique_near_gpu_memory(tmp_path, monkeypatch):
    monkeypatch.setenv("OLLAMA_MODELS", str(tmp_path))
    models = [{"name": "gpt-oss-32k:latest", "digest": "a021b9dabfa4e01c12a469a94b18fde1cb46d178eb2b80361f3c0ebe9339bafa",
               "size_vram": 16 * 1024 ** 3},
              {"name": "gemma3", "digest": "a2af6cc3eb7fa8be8504abaf9b04e88f17a119ec3f04a3addf55f92841195f5a",
               "size_vram": 5333539264}]
    # Names and digests follow the observed TrueNAS and published Ollama responses;
    # the first size_vram and process memory are fixture values.
    with patch("core.process_models.request.urlopen", return_value=running_response(models)):
        assert model_from_command_line(OLLAMA_TRUENAS, 16384) == "gpt-oss-32k:latest"


@pytest.mark.parametrize("memory_mib, sizes", [
    (6000, (6 * 1024 ** 3, 6 * 1024 ** 3)),
    (6144, (6 * 1024 ** 3, 6656 * 1024 ** 2)),
    (1024, (16 * 1024 ** 3, 5 * 1024 ** 3)),
    (None, (16 * 1024 ** 3, 5 * 1024 ** 3)),
    (16384, (16 * 1024 ** 3, None)),
    (16384, (16 * 1024 ** 3, True)),
])
def test_ambiguous_or_distant_gpu_memory_keeps_digest(tmp_path, monkeypatch, memory_mib, sizes):
    monkeypatch.setenv("OLLAMA_MODELS", str(tmp_path))
    models = [{"name": "first", "digest": "first-digest", "size_vram": sizes[0]},
              {"name": "second", "digest": "second-digest", "size_vram": sizes[1]}]
    with patch("core.process_models.request.urlopen", return_value=running_response(models)):
        assert model_from_command_line(OLLAMA_TRUENAS, memory_mib) == OLLAMA_TRUENAS[2].rsplit("/", 1)[-1]


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
