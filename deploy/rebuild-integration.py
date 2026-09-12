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
BRANCH = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*$")
EXPECTED_ORIGIN = "https://github.com/greghughespdx/gpu-hot"


def run(argv: list[str]) -> str:
    result = subprocess.run(argv, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("result_commit")
    parser.add_argument("--manifest", default="integration-refs.json")
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
    manifest_path = (HERE / args.manifest).resolve()
    if manifest_path.parent != HERE or manifest_path.suffix != ".json":
        raise SystemExit("REFUSED: manifest must be a JSON file in deploy")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    result_branch = manifest.get("result_branch", "integration")
    if not isinstance(result_branch, str) or not BRANCH.fullmatch(result_branch):
        raise SystemExit("REFUSED: result branch is malformed")
    refs = [row["commit"] for row in manifest["source_refs"]]
    if not refs or any(not COMMIT.fullmatch(value) for value in refs):
        raise SystemExit("REFUSED: source ref list is malformed")
    mode = manifest.get("composition", "linear")
    if mode == "linear":
        ancestry_pairs = zip(refs, refs[1:])
    elif mode == "merged":
        upstream_base = manifest.get("upstream_base")
        if not isinstance(upstream_base, str) or not COMMIT.fullmatch(upstream_base):
            raise SystemExit("REFUSED: upstream base is malformed")
        ancestry_pairs = ((upstream_base, source_ref) for source_ref in refs)
    else:
        raise SystemExit("REFUSED: composition mode is unsupported")
    for older, newer in ancestry_pairs:
        subprocess.run(["git", "merge-base", "--is-ancestor", older, newer], check=True)
    for source_ref in refs:
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", source_ref, args.result_commit],
            check=True,
        )
    if run(["git", "rev-parse", "HEAD"]) != args.result_commit:
        raise SystemExit("REFUSED: result is not the clean checkout HEAD")
    run(["git", "branch", "-f", result_branch, args.result_commit])
    if args.push:
        subprocess.run(
            [
                "git", "push", f"--force-with-lease=refs/heads/{result_branch}",
                "origin", f"{args.result_commit}:refs/heads/{result_branch}",
            ],
            check=True,
        )
    print(f"{result_branch.upper()} READY: {args.result_commit}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
