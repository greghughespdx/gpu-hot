"""The test harness must run the source from its own worktree."""

import shutil
import subprocess
from pathlib import Path

from tests.verify_test_image import compare_source


def test_project_name_is_stable_and_distinct_per_worktree(tmp_path: Path) -> None:
    script = Path(__file__).resolve().parents[2] / "run_tests.sh"
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir()
    second.mkdir()
    shutil.copy2(script, first / "run_tests.sh")
    shutil.copy2(script, second / "run_tests.sh")

    def name(root: Path) -> str:
        result = subprocess.run(
            ["bash", str(root / "run_tests.sh"), "--print-project-name"],
            capture_output=True, text=True, check=True,
        )
        return result.stdout.strip()

    assert name(first) == name(first)
    assert name(first) != name(second)
    assert name(first).startswith("gpu_hot_tests_")


def test_image_check_accepts_matching_source_and_rejects_stale_code(tmp_path: Path) -> None:
    source = tmp_path / "source"
    image = tmp_path / "image"
    for root in (source, image):
        (root / "static/js").mkdir(parents=True)
        (root / "tests/frontend").mkdir(parents=True)
        (root / "static/js/ui.js").write_text("current", encoding="utf-8")
        (root / "tests/frontend/ui.test.js").write_text("matching", encoding="utf-8")

    assert compare_source(source, image) == (2, [])
    (image / "tests/frontend/ui.test.js").write_text("another worktree", encoding="utf-8")
    assert compare_source(source, image) == (2, ["tests/frontend/ui.test.js"])
    (image / "tests/frontend/ui.test.js").unlink()
    assert compare_source(source, image) == (2, ["tests/frontend/ui.test.js"])
