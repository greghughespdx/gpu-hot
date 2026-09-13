"""Refuse to run tests from an image built for a different worktree."""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path


SOURCE_DIRS = ("core", "static", "templates", "tests")
SOURCE_SUFFIXES = {".py", ".js", ".css", ".html", ".json", ".yml", ".yaml", ".sh", ".txt"}
IGNORED_DIRS = {"__pycache__", "node_modules", ".pytest_cache", ".git"}


def source_files(root: Path) -> list[Path]:
    files = [
        path.relative_to(root) for path in root.iterdir()
        if path.is_file() and path.suffix in SOURCE_SUFFIXES
    ]
    if (root / "docs" / "demo.html").is_file():
        files.append(Path("docs/demo.html"))
    for folder in SOURCE_DIRS:
        directory = root / folder
        if not directory.is_dir():
            continue
        files.extend(
            path.relative_to(root) for path in directory.rglob("*")
            if path.is_file() and path.suffix in SOURCE_SUFFIXES
            and not any(part in IGNORED_DIRS for part in path.relative_to(root).parts)
        )
    return sorted(set(files))


def compare_source(source_root: Path, image_root: Path) -> tuple[int, list[str]]:
    mismatches = []
    files = source_files(source_root)
    for relative in files:
        source = source_root / relative
        image = image_root / relative
        if not image.is_file() or (
            hashlib.sha256(source.read_bytes()).digest()
            != hashlib.sha256(image.read_bytes()).digest()
        ):
            mismatches.append(str(relative))
    return len(files), mismatches


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: verify_test_image.py SOURCE_ROOT IMAGE_ROOT")
    count, mismatches = compare_source(Path(sys.argv[1]), Path(sys.argv[2]))
    if mismatches:
        raise SystemExit("Test image differs from this worktree: " + ", ".join(mismatches[:5]))
    print(f"Test image verified against {count} source files")
