# StoneGate Installation Wizard

This file is the *source of truth* for the in-app Installation Wizard.
Run `pnpm wizard:build` in `frontend/` to regenerate the UI data.

## Local Dev (Recommended)

- Install prerequisites: Node.js + pnpm, a C++ toolchain, CMake, and Boost.
- Build and run a simulator backend (safe) on a local port.
- Start the frontend dev server.
- Connect the frontend to the backend WebSocket URL (e.g. `ws://localhost:8080/status`).
- Open Diagnostics and confirm backend logs appear when you run actions.

## Common Checks

- If the schematic doesn’t match the backend, enable Build Mode and toggle “auto-load backend schematic” (build-only).
- If a backend is incompatible, check `backend.info` protocol_version and capabilities.
- Use Instance Manager (dev-only) to list/stop safe local instances.

## Deployment Notes

- Treat non-sim backends as potentially hardware-backed; don’t stop them unless you know it’s safe.
- Keep the frontend and backend protocol versions aligned.
