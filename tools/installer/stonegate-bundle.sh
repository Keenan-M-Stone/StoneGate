#!/usr/bin/env bash
set -euo pipefail

# Creates a redistributable StoneGate bundle (backend binary + frontend dist + runner + installer).
# Usage:
#   tools/installer/stonegate-bundle.sh [--out release] [--version vX] [--skip-backend] [--skip-frontend] [--include-source]

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$repo_root"

out_dir="$repo_root/release"
version=""
skip_backend=0
skip_frontend=0
include_source=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) out_dir="$2"; shift 2;;
    --version) version="$2"; shift 2;;
    --skip-backend) skip_backend=1; shift;;
    --skip-frontend) skip_frontend=1; shift;;
    --include-source) include_source=1; shift;;
    -h|--help)
      echo "Usage: $0 [--out release] [--version vX] [--skip-backend] [--skip-frontend] [--include-source]";
      exit 0;;
    *)
      echo "Unknown arg: $1" >&2
      exit 2;;
  esac
done

if [[ -z "$version" ]]; then
  if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    version="$(git describe --tags --dirty --always 2>/dev/null || true)"
  fi
fi
if [[ -z "$version" ]]; then
  version="$(date -u +%Y%m%d-%H%M%S)"
fi

bundle_root="$out_dir/stonegate-$version"
bundle_dir="$bundle_root/stonegate"

mkdir -p "$bundle_dir"

if [[ $skip_backend -eq 0 ]]; then
  echo "[bundle] Building backend (CMake)"
  mkdir -p backend/build
  cmake -S backend -B backend/build
  cmake --build backend/build -j
fi

if [[ $skip_frontend -eq 0 ]]; then
  echo "[bundle] Building frontend (pnpm)"
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "pnpm not found. Install pnpm or pass --skip-frontend." >&2
    exit 1
  fi
  pnpm -C frontend -s install
  pnpm -C frontend -s build
fi

backend_bin="$repo_root/backend/build/StoneGate"
frontend_dist="$repo_root/frontend/dist"

if [[ ! -x "$backend_bin" ]]; then
  echo "Backend binary not found at $backend_bin" >&2
  echo "Build it first or re-run without --skip-backend." >&2
  exit 1
fi
if [[ ! -d "$frontend_dist" ]]; then
  echo "Frontend dist not found at $frontend_dist" >&2
  echo "Build it first or re-run without --skip-frontend." >&2
  exit 1
fi

echo "[bundle] Staging files into $bundle_dir"
rm -rf "$bundle_dir"/*
mkdir -p "$bundle_dir/bin" "$bundle_dir/backend" "$bundle_dir/frontend" "$bundle_dir/shared/protocol" "$bundle_dir/docker"

cp -a "$backend_bin" "$bundle_dir/backend/StoneGate"
cp -a "$frontend_dist" "$bundle_dir/frontend/dist"
cp -a shared/protocol/DeviceGraph.json "$bundle_dir/shared/protocol/DeviceGraph.json"
cp -a shared/protocol/ComponentSchema.json "$bundle_dir/shared/protocol/ComponentSchema.json"
cp -a shared/protocol/MessageTypes.ts "$bundle_dir/shared/protocol/MessageTypes.ts" 2>/dev/null || true

cp -a tools/installer/templates/stonegate-run.sh "$bundle_dir/bin/stonegate-run"
cp -a tools/installer/templates/serve-frontend.mjs "$bundle_dir/bin/serve-frontend.mjs"
cp -a tools/installer/templates/install.sh "$bundle_dir/bin/install.sh"
cp -a tools/installer/templates/stonegate-wizard.sh "$bundle_dir/bin/stonegate-wizard"

# Docker templates (optional install mode; works when bundle includes source)
cp -a tools/installer/templates/docker/Dockerfile.backend "$bundle_dir/docker/Dockerfile.backend"
cp -a tools/installer/templates/docker/Dockerfile.ui "$bundle_dir/docker/Dockerfile.ui"
cp -a tools/installer/templates/docker/docker-compose.full.yml "$bundle_dir/docker/docker-compose.full.yml"
cp -a tools/installer/templates/docker/docker-compose.backend.yml "$bundle_dir/docker/docker-compose.backend.yml"
cp -a tools/installer/templates/docker/.env.example "$bundle_dir/docker/.env.example"
cp -a tools/installer/templates/docker/README.md "$bundle_dir/docker/README.md"

chmod +x "$bundle_dir/bin/stonegate-run" "$bundle_dir/bin/install.sh" "$bundle_dir/bin/stonegate-wizard"

if [[ $include_source -eq 1 ]]; then
  echo "[bundle] Including source tree (for Docker installs)"
  mkdir -p "$bundle_dir/source"

  # Create a minimal source snapshot without build/node_modules artifacts.
  # This enables `./bin/install.sh --mode docker` on the target machine.
  tar -C "$repo_root" \
    --exclude='backend/build' \
    --exclude='backend/recordings' \
    --exclude='frontend/node_modules' \
    --exclude='frontend/dist' \
    --exclude='**/.git' \
    -cf - \
    backend \
    frontend \
    shared \
    tools/installer \
    README.md \
    | tar -C "$bundle_dir/source" -xf -
fi

cat > "$bundle_dir/VERSION" <<EOF
$version
EOF

cat > "$bundle_dir/README.txt" <<'EOF'
StoneGate bundle

Quick start (portable):
  ./bin/stonegate-run --sim

Serve UI on a different port:
  UI_PORT=5173 ./bin/stonegate-run --sim

Change backend port:
  BACKEND_PORT=8080 ./bin/stonegate-run --sim

Install system-wide (requires sudo):
  sudo ./bin/install.sh --mode systemd-backend
  # or:
  sudo ./bin/install.sh --mode systemd-full

Docker (requires bundle built with --include-source):
  ./bin/install.sh --mode docker --docker full
  # or backend only:
  ./bin/install.sh --mode docker --docker backend

Manual:
  See docs/installer.md
EOF

# Systemd unit templates (optional, installed by install.sh)
mkdir -p "$bundle_dir/systemd"
cp -a tools/installer/templates/stonegate-backend.service "$bundle_dir/systemd/stonegate-backend.service"
cp -a tools/installer/templates/stonegate-full.service "$bundle_dir/systemd/stonegate-full.service"
cp -a tools/installer/templates/stonegate-ui.service "$bundle_dir/systemd/stonegate-ui.service"

# Docs
mkdir -p "$bundle_dir/docs"
cp -a docs/installer.md "$bundle_dir/docs/installer.md"

mkdir -p "$bundle_root"
tarball="$out_dir/stonegate-$version.tar.gz"

echo "[bundle] Creating tarball: $tarball"
# Create tarball containing the 'stonegate' folder
( cd "$bundle_root" && tar -czf "$tarball" stonegate )

echo "[bundle] Done"
echo "  Bundle dir: $bundle_dir"
echo "  Tarball:    $tarball"
