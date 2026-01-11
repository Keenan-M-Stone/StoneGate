# StoneGate Installer Guide

This guide describes the *bundle installer* workflow (CLI wizard + scripts). This is separate from the in-app frontend "Installation Wizard" UI.

## Defaults and goals

- Default mode is a simulator backend on a user-chosen port (default `8080`).
- The frontend connects over WebSocket to `ws://<host>:<port>/status`.
- You can later switch to real-hardware drivers by implementing devices/drivers in the backend and using **Build Mode** in the UI to help validate schematics.

## Quick start (portable bundle)

1) Extract the bundle tarball:

```bash
tar -xzf stonegate-<version>.tar.gz
cd stonegate
```

2) Run the CLI wizard:

```bash
./bin/stonegate-wizard
```

The wizard can:
- run UI + simulator locally
- run UI only (connect to remote backend)
- install backend on a remote machine over SSH
- install services via systemd

## Runtime UI configuration (important)

Installers configure the built UI by writing:

- `frontend/dist/stonegate-config.js`

This provides defaults like:
- `ws_url`: default backend endpoint
- `build_mode`: default Build Mode UI state
- `auto_backend_schematic`: default behavior for auto-loading backend schematics (enabled when Build Mode defaults are enabled in the CLI wizard)

Users can still override the backend endpoint from inside the UI (stored in localStorage).

## Remote backend install (common setup)

Typical architecture:
- Your laptop runs the UI (and tools/docs).
- A separate machine (lab server) runs the backend close to hardware.

Recommended flow:

1) On your laptop, extract the bundle and run:

```bash
./bin/stonegate-wizard
```

2) Choose the remote backend option and provide:
- SSH host (e.g. `user@labbox`)
- Remote install prefix (default `/opt/stonegate`)
- Backend port (default `8080`)

The wizard installs a systemd service on the remote machine:
- unit: `stonegate-backend.service`
- env: `/etc/stonegate/stonegate.env`

## "Frontend only" installs

If you only want the UI (and to connect to an existing backend), use either:
- portable: run the wizard and select "UI only"
- systemd: `sudo ./bin/install.sh --mode systemd-ui`

## Extending to real hardware

The repo ships with simulator mode (`--sim`). For real hardware:
- implement/extend devices under `backend/include/devices` and `backend/src/devices`
- add drivers and registry wiring as needed
- use the UI connection settings + Build Mode to validate that the schematic matches the backend's device graph

## SDK / API generation

StoneGate uses a shared protocol under `shared/protocol/`.
If you are developing client code (Python/TypeScript), generate or use the SDK under `sdk/` (if present in your build workflow) or the sources under `tools/sdk_sources/`.

(Exact generation commands depend on which SDK targets you want enabled.)

## Modifying the installer (developer notes)

The bundle installer is intentionally simple and easy to edit.

Source-of-truth files live in the repo under:
- `tools/installer/stonegate-bundle.sh` (creates the bundle tarball)
- `tools/installer/templates/` (scripts/units copied into each bundle)

Key templates:
- `tools/installer/templates/install.sh` (non-interactive installer; `--mode ...`)
- `tools/installer/templates/stonegate-wizard.sh` (interactive CLI wizard)
- `tools/installer/templates/stonegate-*.service` (systemd unit templates)
- `tools/installer/templates/docker/*` (Docker install mode templates)

### How the UI gets configured by the installer

Installers set default UI behavior by writing:
- `frontend/dist/stonegate-config.js`

The frontend reads this at runtime (before app bootstrap) and uses it as defaults when localStorage does not already override them.

### Generated scripts

When you choose the remote backend flow in `stonegate-wizard`, it can generate editable scripts under:
- `generated/remote-backend-install.sh` (run on the backend machine)
- `generated/push-backend-over-ssh.sh` (run locally to push+install over SSH)

These scripts are meant to be easy to locate, copy, and customize.

### Updating the bundle

After editing templates, rebuild a bundle:

```bash
./tools/installer/stonegate-bundle.sh
```

If you want Docker mode to work on the target machine, create a source-included bundle:

```bash
./tools/installer/stonegate-bundle.sh --include-source
```
