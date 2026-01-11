#!/usr/bin/env bash
set -euo pipefail

# Installer for a prebuilt StoneGate bundle.
# Expected layout (relative to this script):
#   ../backend/StoneGate
#   ../frontend/dist
#   ../bin/stonegate-run
#   ../systemd/*.service

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle_root="$(cd "$script_dir/.." && pwd)"

mode="portable"
prefix="/opt/stonegate"
enable=1
start=1
docker_target="full"
docker_run=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) mode="$2"; shift 2;;
    --prefix) prefix="$2"; shift 2;;
    --docker) docker_target="$2"; shift 2;;
    --no-run) docker_run=0; shift;;
    --no-enable) enable=0; shift;;
    --no-start) start=0; shift;;
    -h|--help)
      cat <<EOF
Usage: $(basename "$0") [--mode portable|systemd-backend|systemd-ui|systemd-full|docker] [--prefix /opt/stonegate]

Modes:
  portable        No install; run from extracted folder.
  systemd-backend Install to prefix and install backend service.
  systemd-ui      Install to prefix and install UI-only service.
  systemd-full    Install to prefix and install combined backend+UI service.
  docker          Build+run via docker compose (requires a source-included bundle).

Docker options (mode=docker):
  --docker full|backend   Which compose file to run (default: full)
  --no-run                Only print the docker compose command

Flags:
  --no-enable   Don't enable systemd unit.
  --no-start    Don't start systemd unit.
EOF
      exit 0;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2;;
  esac
done

if [[ "$mode" == "portable" ]]; then
  echo "Portable mode: no files copied."
  echo "Run: $bundle_root/bin/stonegate-run --sim"
  exit 0
fi

if [[ "$mode" == "docker" ]]; then
  # Docker compose install mode (no root required, but docker daemon access is).
  if ! command -v docker >/dev/null 2>&1; then
    echo "docker not found. Install Docker Desktop / docker engine first." >&2
    exit 1
  fi

  compose_cmd=("docker" "compose")
  if ! docker compose version >/dev/null 2>&1; then
    if command -v docker-compose >/dev/null 2>&1; then
      compose_cmd=("docker-compose")
    else
      echo "Neither 'docker compose' nor 'docker-compose' found." >&2
      exit 1
    fi
  fi

  if [[ ! -d "$bundle_root/source/backend" || ! -f "$bundle_root/source/backend/CMakeLists.txt" ]]; then
    echo "Docker mode requires a source-included bundle." >&2
    echo "Recreate the tarball with: tools/installer/stonegate-bundle.sh --include-source" >&2
    exit 1
  fi

  if [[ ! -d "$bundle_root/docker" ]]; then
    echo "Missing docker templates in bundle: $bundle_root/docker" >&2
    exit 1
  fi

  local_compose=""
  case "$docker_target" in
    full) local_compose="$bundle_root/docker/docker-compose.full.yml";;
    backend) local_compose="$bundle_root/docker/docker-compose.backend.yml";;
    *)
      echo "Unknown --docker target: $docker_target (expected full|backend)" >&2
      exit 2;;
  esac

  if [[ ! -f "$bundle_root/docker/.env" ]]; then
    cp -a "$bundle_root/docker/.env.example" "$bundle_root/docker/.env"
  fi

  echo "Docker compose file: $local_compose"
  echo "Env file: $bundle_root/docker/.env"
  echo "Working dir: $bundle_root/docker"

  run_line="(cd \"$bundle_root/docker\" && ${compose_cmd[*]} -f $(basename "$local_compose") up -d --build)"
  if [[ $docker_run -eq 0 ]]; then
    echo "Run this:" 
    echo "  $run_line"
    exit 0
  fi

  (cd "$bundle_root/docker" && "${compose_cmd[@]}" -f "$(basename "$local_compose")" up -d --build)

  echo "Done. UI: http://localhost:${UI_PORT:-5173} (backend ws: ws://localhost:${BACKEND_PORT:-8080}/status)"
  exit 0
fi

if [[ $EUID -ne 0 ]]; then
  echo "This mode requires root. Re-run with sudo." >&2
  exit 1
fi

if [[ ! -x "$bundle_root/backend/StoneGate" ]]; then
  echo "Missing backend binary in bundle: $bundle_root/backend/StoneGate" >&2
  exit 1
fi

mkdir -p "$prefix"

# Copy bundle to prefix
# (Copy the whole folder contents, preserving structure)
rm -rf "$prefix"/*
cp -a "$bundle_root"/* "$prefix"/

# Provide a default env file
mkdir -p /etc/stonegate
if [[ ! -f /etc/stonegate/stonegate.env ]]; then
  cat > /etc/stonegate/stonegate.env <<'EOF'
# StoneGate service configuration
# BACKEND_PORT=8080
# UI_PORT=5173
# UI_HOST=127.0.0.1
# BACKEND_ARGS=
EOF
fi

unit_src=""
unit_name=""
case "$mode" in
  systemd-backend)
    unit_src="$prefix/systemd/stonegate-backend.service"
    unit_name="stonegate-backend.service"
    ;;
  systemd-ui)
    unit_src="$prefix/systemd/stonegate-ui.service"
    unit_name="stonegate-ui.service"
    ;;
  systemd-full)
    unit_src="$prefix/systemd/stonegate-full.service"
    unit_name="stonegate.service"
    ;;
  *)
    echo "Unknown mode: $mode" >&2
    exit 2
    ;;
esac

if [[ ! -f "$unit_src" ]]; then
  echo "Systemd unit not found in bundle: $unit_src" >&2
  exit 1
fi

install -m 0644 "$unit_src" "/etc/systemd/system/$unit_name"

systemctl daemon-reload

if [[ $enable -eq 1 ]]; then
  systemctl enable "$unit_name"
fi
if [[ $start -eq 1 ]]; then
  systemctl restart "$unit_name"
fi

echo "Installed to: $prefix"
echo "Unit: /etc/systemd/system/$unit_name"
if [[ $start -eq 1 ]]; then
  echo "Status: systemctl status $unit_name"
fi
