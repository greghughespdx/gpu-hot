#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_name="$(python3 -c 'import hashlib, sys; print("gpu_hot_tests_" + hashlib.sha256(sys.argv[1].encode()).hexdigest()[:16])' "$repo_root")"

if [[ "${1:-}" == "--print-project-name" ]]; then
    printf '%s\n' "$project_name"
    exit 0
fi
if [[ "$#" -ne 0 ]]; then
    printf 'Usage: %s [--print-project-name]\n' "$0" >&2
    exit 2
fi

echo "=== gpu-hot Unit Tests ==="
echo "Building test container..."

docker compose -p "$project_name" -f "$repo_root/tests/docker-compose.unittest.yml" build
image_id="$(docker image inspect --format '{{.Id}}' "$project_name-unittest:latest")"

echo "Checking test image against this worktree..."
docker run --rm --network none \
    --mount "type=bind,src=$repo_root,dst=/source,readonly" \
    "$image_id" python3 /app/tests/verify_test_image.py /source /app

echo "Running tests..."
docker run --rm --network none "$image_id"

echo "=== Tests Complete ==="
