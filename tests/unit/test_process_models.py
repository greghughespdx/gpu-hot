"""Model labels come from recognized process arguments, not a model catalog."""

import hashlib
from io import BytesIO
import json
from urllib.error import URLError
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


def test_inf1_llama_alias_wins_over_file():
    assert model_from_command_line(INF1_Q4) == "qwen38-q4"


def test_llama_without_alias_uses_model_file():
    assert model_from_command_line(INF1_Q4[:-2]) == "Qwen3.8-27B-UD-Q4_K_XL.gguf"


def test_truenas_ollama_runner_uses_reported_path():
    assert model_from_command_line(OLLAMA_TRUENAS) == OLLAMA_TRUENAS[2]


def test_ollama_single_manifest_returns_model_tag(tmp_path, monkeypatch):
    monkeypatch.setenv("GPU_HOT_OLLAMA_MANIFESTS", str(tmp_path))
    blob = "sha256:" + OLLAMA_TRUENAS[2].rsplit("sha256-", 1)[-1]
    add_manifest(tmp_path, "gpt-oss-32k", "latest", blob, "sha256:config")
    with patch("core.process_models.request.urlopen") as urlopen:
        assert model_from_command_line(OLLAMA_TRUENAS) == "gpt-oss-32k:latest"
        urlopen.assert_not_called()


def test_ollama_shared_blob_uses_running_manifest_digest(tmp_path, monkeypatch):
    monkeypatch.setenv("GPU_HOT_OLLAMA_MANIFESTS", str(tmp_path))
    monkeypatch.setenv("GPU_HOT_OLLAMA_API", "http://127.0.0.1:11434")
    blob = "sha256:" + OLLAMA_TRUENAS[2].rsplit("sha256-", 1)[-1]
    add_manifest(tmp_path, "gpt-oss", "latest", blob, "sha256:first")
    add_manifest(tmp_path, "gpt-oss-16k", "latest", blob, "sha256:second")
    active_digest = add_manifest(tmp_path, "gpt-oss-32k", "latest", blob, "sha256:third")
    payload = {"models": [{"name": "gpt-oss-32k:latest", "digest": active_digest}]}
    response = RunningResponse(json.dumps(payload).encode())
    with patch("core.process_models.request.urlopen", return_value=response) as urlopen:
        assert model_from_command_line(OLLAMA_TRUENAS) == "gpt-oss-32k:latest"
        assert urlopen.call_args.kwargs["timeout"] == 1
        assert urlopen.call_args.args[0].full_url == "http://127.0.0.1:11434/api/ps"


def test_ollama_shared_blob_uses_common_base_when_endpoint_fails(tmp_path, monkeypatch):
    monkeypatch.setenv("GPU_HOT_OLLAMA_MANIFESTS", str(tmp_path))
    monkeypatch.setenv("GPU_HOT_OLLAMA_API", "http://127.0.0.1:11434")
    blob = "sha256:" + OLLAMA_TRUENAS[2].rsplit("sha256-", 1)[-1]
    for name in ("gpt-oss", "gpt-oss-16k", "gpt-oss-32k"):
        add_manifest(tmp_path, name, "latest", blob, "sha256:" + name)
    with patch("core.process_models.request.urlopen", side_effect=URLError("offline")):
        assert model_from_command_line(OLLAMA_TRUENAS) == "gpt-oss"


def test_ollama_no_matching_manifest_keeps_blob_name(tmp_path, monkeypatch):
    monkeypatch.setenv("GPU_HOT_OLLAMA_MANIFESTS", str(tmp_path))
    add_manifest(tmp_path, "other", "latest", "sha256:other", "sha256:config")
    assert model_from_command_line(OLLAMA_TRUENAS) == OLLAMA_TRUENAS[2].rsplit("/", 1)[-1]


def test_ollama_unrelated_aliases_keep_digest_when_running_set_is_unavailable(tmp_path, monkeypatch):
    monkeypatch.setenv("GPU_HOT_OLLAMA_MANIFESTS", str(tmp_path))
    monkeypatch.setenv("GPU_HOT_OLLAMA_API", "http://127.0.0.1:11434")
    blob = "sha256:" + OLLAMA_TRUENAS[2].rsplit("sha256-", 1)[-1]
    add_manifest(tmp_path, "alpha", "latest", blob, "sha256:first")
    add_manifest(tmp_path, "beta", "latest", blob, "sha256:second")
    with patch("core.process_models.request.urlopen", side_effect=URLError("offline")):
        assert model_from_command_line(OLLAMA_TRUENAS) == OLLAMA_TRUENAS[2].rsplit("/", 1)[-1]


def test_ollama_skips_bad_manifest_without_losing_a_valid_match(tmp_path, monkeypatch):
    monkeypatch.setenv("GPU_HOT_OLLAMA_MANIFESTS", str(tmp_path))
    bad = tmp_path / "registry.ollama.ai" / "library" / "bad" / "latest"
    bad.parent.mkdir(parents=True)
    bad.write_text("not json")
    blob = "sha256:" + OLLAMA_TRUENAS[2].rsplit("sha256-", 1)[-1]
    add_manifest(tmp_path, "gpt-oss-32k", "latest", blob, "sha256:valid")
    assert model_from_command_line(OLLAMA_TRUENAS) == "gpt-oss-32k:latest"


def test_vllm_servers_use_model_argument():
    assert model_from_command_line(["/opt/venv/bin/vllm", "serve", "Qwen/Qwen3-8B"]) == "Qwen/Qwen3-8B"
    assert model_from_command_line([
        "python", "-m", "vllm.entrypoints.openai.api_server", "--model", "Qwen/Qwen3-8B"
    ]) == "Qwen/Qwen3-8B"


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
