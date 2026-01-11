# StoneGate Installer / Bundler

This directory contains a simple "release bundle" workflow:

- Build the C++ backend (`backend/build/StoneGate`)
- Build the frontend static assets (`frontend/dist`)
- Package both into a single tarball that can be installed in different ways

## Create a bundle (on your dev machine)

From repo root:

```bash
./tools/installer/stonegate-bundle.sh
```

To include a minimal source snapshot (required for Docker install mode):

```bash
./tools/installer/stonegate-bundle.sh --include-source
```

Outputs:
- `release/stonegate-<version>.tar.gz`
- `release/stonegate-<version>/stonegate/` (staging folder)

## Install options (on the target machine)

1) Extract the tarball:

```bash
tar -xzf stonegate-<version>.tar.gz
cd stonegate
```

2) Choose an install mode:

If you want a guided setup (recommended), run:

```bash
./bin/stonegate-wizard
```

### Portable (no root)

Runs directly from the extracted folder:

```bash
./bin/stonegate-run --sim
```

UI only (connect to an existing backend):

```bash
./bin/stonegate-run --ui-only
```

Backend only:

```bash
./bin/stonegate-run --backend-only --sim
```

### System install + systemd (backend only)

Installs to `/opt/stonegate` and registers a system service:

```bash
sudo ./bin/install.sh --mode systemd-backend
```

### System install + systemd (backend + UI)

Same as above, but also serves the UI from `frontend/dist`:

```bash
sudo ./bin/install.sh --mode systemd-full
```

### System install + systemd (UI only)

Installs to `/opt/stonegate` and registers a UI-only service (no backend):

```bash
sudo ./bin/install.sh --mode systemd-ui
```

### Docker (build+run inside containers)

This requires a source-included bundle (created with `--include-source`).

```bash
./bin/install.sh --mode docker --docker full
# or backend only:
./bin/install.sh --mode docker --docker backend
```

## Configuration

Systemd modes read optional env overrides from:

- `/etc/stonegate/stonegate.env`

Common values:

- `BACKEND_PORT=8080`
- `UI_PORT=5173`
- `UI_HOST=127.0.0.1`
- `BACKEND_ARGS=--sim`

## Notes

- The frontend defaults to `ws://localhost:8080/status`. You can change the endpoint inside the UI (connection settings) if needed.
- The UI server prefers `python3` if available, otherwise uses `node`.
