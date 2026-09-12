#!/usr/bin/env python3
"""Move integration to a clean commit containing the exact recorded inputs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess


HERE = Path(__file__).resolve().parent
COMMIT = re.compile(r"^[0-9a-f]{40}$")
EXPECTED_ORIGIN = "https://github.com/greghughespdx/gpu-hot"


def run(argv: list[str]) -> str:
    result = subprocess.run(argv, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("result_commit")
    parser.add_argument("--push", action="store_true")
    args = parser.parse_args()
    if not COMMIT.fullmatch(args.result_commit):
        raise SystemExit("REFUSED: result must be a full lowercase commit")
    root = Path(run(["git", "rev-parse", "--show-toplevel"])).resolve()
    if root != HERE.parent.resolve():
        raise SystemExit("REFUSED: run from the gpu-hot repository")
    if run(["git", "status", "--porcelain"]):
        raise SystemExit("REFUSED: checkout is not clean")
    origin = run(["git", "remote", "get-url", "origin"]).rstrip("/").removesuffix(".git")
    if origin != EXPECTED_ORIGIN:
        raise SystemExit("REFUSED: origin is not the expected fork")
    manifest = json.loads((HERE / "integration-refs.json").read_text(encoding="utf-8"))
    refs = [row["commit"] for row in manifest["source_refs"]]
    if not refs or any(not COMMIT.fullmatch(value) for value in refs):
        raise SystemExit("REFUSED: source ref list is malformed")
    for older, newer in zip(refs, refs[1:]):
        subprocess.run(["git", "merge-base", "--is-ancestor", older, newer], check=True)
    subprocess.run(["git", "merge-base", "--is-ancestor", refs[-1], args.result_commit], check=True)
    if run(["git", "rev-parse", "HEAD"]) != args.result_commit:
        raise SystemExit("REFUSED: result is not the clean checkout HEAD")
    run(["git", "branch", "-f", "integration", args.result_commit])
    if args.push:
        subprocess.run(
            [
                "git", "push", "--force-with-lease=refs/heads/integration",
                "origin", f"{args.result_commit}:refs/heads/integration",
            ],
            check=True,
        )
    print(f"INTEGRATION READY: {args.result_commit}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
