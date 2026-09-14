"""The public demo trace exporter keeps only numeric samples and role labels."""

import argparse
import importlib.util
import json
from pathlib import Path

import pytest


SCRIPT = Path(__file__).resolve().parents[2] / "tools" / "demo_trace_export.py"
SPEC = importlib.util.spec_from_file_location("demo_trace_export", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def test_export_trims_source_and_omits_node_identity(tmp_path):
    columns = {
        "t": list(range(24)),
        **{field: [float(index) for index in range(24)] for field in MODULE.FIELDS},
    }
    columns["mem_total"] = [24576.0] * 24
    source = tmp_path / "private-capture.json"
    source.write_text(json.dumps({"0": columns, "node_name": "private-node"}))
    args = argparse.Namespace(input=source, gpu="0", start_second=5, role="observer",
                              power_limit=150, clock_max=1695, temp_idle=30, temp_load=80)

    exported = MODULE.export_trace(args)

    assert exported["role"] == "observer"
    assert len(exported["samples"]) == 19
    assert exported["samples"][0]["util"] == 5.0
    assert "private-node" not in json.dumps(exported)
    assert "node_name" not in json.dumps(exported)
    assert "t" not in exported["samples"][0]


def test_export_rejects_too_short_trim(tmp_path):
    columns = {"t": list(range(24)), **{field: [1.0] * 24 for field in MODULE.FIELDS}}
    source = tmp_path / "capture.json"
    source.write_text(json.dumps({"0": columns}))
    args = argparse.Namespace(input=source, gpu="0", start_second=10, role="observer",
                              power_limit=150, clock_max=1695, temp_idle=30, temp_load=80)
    with pytest.raises(ValueError, match="Too few samples"):
        MODULE.export_trace(args)
