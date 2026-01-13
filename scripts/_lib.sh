#!/usr/bin/env bash
set -euo pipefail

repo_root() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  (cd "$script_dir/.." && pwd)
}

log() {
  echo "[stonegate] $*"
}

fatal() {
  echo "[stonegate] ERROR: $*" >&2
  exit 1
}

run() {
  log "+ $*"
  "$@"
}

have() {
  command -v "$1" >/dev/null 2>&1
}

ensure() {
  if ! have "$1"; then
    echo "Missing required command: $1" >&2
    return 1
  fi
}

is_sourced() {
  [[ "${BASH_SOURCE[0]}" != "$0" ]]
}
