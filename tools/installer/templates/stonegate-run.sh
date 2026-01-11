#!/usr/bin/env bash
set -euo pipefail

# Run StoneGate backend + optional static UI server.
# Works in both "portable bundle" and "installed" layouts.
#
# Env vars:
#   BACKEND_PORT (default 8080)
#   UI_PORT      (default 5173)
#   UI_HOST      (default 127.0.0.1)
#   BACKEND_ARGS (extra args appended)
#
# Args:
#   --sim        run backend in simulation mode
#   --no-ui      don't serve the frontend (alias: --backend-only)
#   --backend-only  start backend only
#   --ui-only    serve frontend only (no backend)
#   --ui python|node  force UI server implementation

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "$script_dir/.." && pwd)"

backend_port="${BACKEND_PORT:-8080}"
ui_port="${UI_PORT:-5173}"
ui_host="${UI_HOST:-127.0.0.1}"
backend_args="${BACKEND_ARGS:-}"

sim=0
serve_ui=1
ui_only=0
ui_impl=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sim) sim=1; shift;;
    --no-ui) serve_ui=0; shift;;
    --backend-only) serve_ui=0; shift;;
    --ui-only) ui_only=1; shift;;
    --ui)
      ui_impl="$2"; shift 2;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [--sim] [--backend-only|--no-ui] [--ui-only] [--ui python|node]

Env:
  BACKEND_PORT=8080 UI_PORT=5173 UI_HOST=127.0.0.1
EOF
      exit 0;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2;;
  esac
done

backend_bin="$root_dir/backend/StoneGate"
frontend_dir="$root_dir/frontend/dist"

if [[ ! -x "$backend_bin" ]]; then
  if [[ $ui_only -eq 0 ]]; then
    echo "Backend binary not found/executable: $backend_bin" >&2
    exit 1
  fi
fi

ui_pid=""
backend_pid=""

cleanup() {
  set +e
  if [[ -n "${backend_pid}" ]]; then
    kill "${backend_pid}" 2>/dev/null || true
  fi
  if [[ -n "${ui_pid}" ]]; then
    kill "${ui_pid}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

start_ui() {
  if [[ $serve_ui -eq 0 ]]; then
    return 0
  fi
  if [[ ! -d "$frontend_dir" ]]; then
    echo "Frontend dist directory not found: $frontend_dir" >&2
    echo "Run without UI (--backend-only/--no-ui) or rebuild the frontend." >&2
    exit 1
  fi

  local impl="$ui_impl"
  if [[ -z "$impl" ]]; then
    if command -v python3 >/dev/null 2>&1; then
      impl="python"
    elif command -v node >/dev/null 2>&1; then
      impl="node"
    else
      echo "Neither python3 nor node found; cannot serve UI." >&2
      echo "Run with --backend-only/--no-ui to start backend only." >&2
      exit 1
    fi
  fi

  echo "[stonegate] UI: http://${ui_host}:${ui_port} (ws default: ws://localhost:${backend_port}/status)"

  case "$impl" in
    python)
      python3 -m http.server "$ui_port" --bind "$ui_host" --directory "$frontend_dir" >/dev/null 2>&1 &
      ui_pid="$!"
      ;;
    node)
      node "$script_dir/serve-frontend.mjs" --dir "$frontend_dir" --host "$ui_host" --port "$ui_port" >/dev/null 2>&1 &
      ui_pid="$!"
      ;;
    *)
      echo "Unknown UI impl: $impl (expected python|node)" >&2
      exit 2
      ;;
  esac
}

start_backend() {
  local args=("--port" "$backend_port")
  if [[ $sim -eq 1 ]]; then
    args+=("--sim")
  fi

  # shellcheck disable=SC2206
  local extra=($backend_args)
  args+=("${extra[@]}")

  echo "[stonegate] Backend: ws://localhost:${backend_port}/status"
  "$backend_bin" "${args[@]}" &
  backend_pid="$!"
}

start_ui
if [[ $ui_only -eq 0 ]]; then
  start_backend
  wait "$backend_pid"
else
  if [[ -z "$ui_pid" ]]; then
    echo "UI-only mode requested, but UI failed to start." >&2
    exit 1
  fi
  wait "$ui_pid"
fi
