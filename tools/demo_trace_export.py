"""Export numeric collector samples as one anonymous demo replay stream."""

import argparse
import json
import math
from pathlib import Path


FIELDS = ("util", "mem_used", "mem_total", "power", "temp", "clock_graphics", "fan")


def export_trace(args: argparse.Namespace) -> dict:
    capture = json.loads(args.input.read_text(encoding="utf-8"))
    columns = capture[args.gpu]
    times = columns["t"]
    if any(len(columns[field]) != len(times) for field in FIELDS):
        raise ValueError("Capture columns have different lengths")
    selected = [index for index, second in enumerate(times) if second >= args.start_second]
    if len(selected) < 18:
        raise ValueError("Too few samples remain after trimming")
    samples = []
    for index in selected:
        row = {field: round(float(columns[field][index]), 2) for field in FIELDS}
        if any(not math.isfinite(row[field]) for field in FIELDS):
            raise ValueError("Capture contains a non-numeric sample")
        samples.append(row)
    return {
        "role": args.role,
        "source": {
            "power_limit": args.power_limit,
            "clock_graphics_max": args.clock_max,
            "temp_idle": args.temp_idle,
            "temp_load": args.temp_load,
            "memory_baseline": round(float(columns["mem_used"][selected[0]]), 2),
        },
        "samples": samples,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--role", required=True)
    parser.add_argument("--gpu", required=True)
    parser.add_argument("--start-second", type=float, default=0)
    parser.add_argument("--power-limit", type=float, required=True)
    parser.add_argument("--clock-max", type=float, required=True)
    parser.add_argument("--temp-idle", type=float, required=True)
    parser.add_argument("--temp-load", type=float, required=True)
    args = parser.parse_args()
    output = export_trace(args)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, separators=(",", ":")) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
