# StoneGate Developer Quickstart

This file is a compact checklist and wiring guide for frontend ↔ backend integration,
and for local installation of the backend (C++) and frontend (React + Vite).

Developer notes can also be found in the main `README.md` doc for the repository.

## Wiring the UI to the backend

- WebSocket endpoint (frontend): `VITE_BACKEND_WS_URL` (default: `ws://localhost:8080/status`).
  - Simulator mode (backend: `./StoneGate --sim`): `ws://localhost:8080/status`.
  - Hardware/default mode (backend: `./StoneGate`): `ws://localhost:9001/status`.
  The frontend `Backend` client connects to this URL and expects two main message shapes:

  - Batch measurement update:

    ```json
    { "type": "measurement_update", "updates": [ { "id": "device_id", "measurement": { "measurements": { "metric": { "value": 1.0, "uncertainty": 0.01 } }, "state": "nominal", "ts": 123456789 } }, ... ] }
    ```

  - Single device status (legacy):

    ```json
    { "device_id": "id", "state": "nominal", "measurements": { "metric": { "value": 1.0, "uncertainty": 0.01 } } }
    ```

- Control messages (sent from frontend to backend over WebSocket):
  
  - Manual device action:
  
    ```json
    { "type": "control", "cmd": "action", "device_id": "id", "action": { "set": { "flow_rate_Lmin": 2.5 } } }
    ```

  - Macro run request (client delegates macro execution to backend):
  
    ```json
    { "type": "control", "cmd": "macro_run", "macro_id": "my_macro", "parameters": {} }
    ```

- Backend `WebSocketServer` exposes `handle_control(json)` — implement application logic there to interpret `cmd`
  and route to device driver APIs or the simulator hooks.

## Frontend components & hooks (how to wire)

- `frontend/src/api/backend.ts`: central WS client. Use `Backend.send(obj)` to send control messages,
  and use `Backend.stats()` for connection info.
- `SchematicCanvas` should call `onSelectNode(id)` when a node is single-clicked and `onOpenDialog(id)` when double-clicked.
- `ComponentDialog` displays measurements from `useDeviceStore` state. 
   Use `useDeviceStore.getState().upsertDevice(...)` to apply updates programmatically.
- A `MacroEditor` can persist macros to `localStorage` and optionally submit a `macro_run` control message to 
  backend to delegate execution.  
  Current Macro Wizard behavior (implemented in `frontend/src/components/MacroEditor.tsx`):
  - Step-based macro authoring with nested blocks (`record`, `while`, `if/else`).
  - Step-scoped Preview/Errors panes; full scripts are produced via explicit export actions.
  - Notebook import/export via notebook metadata (`metadata.stonegate.macros`).

## Messages summary (quick)

- measurement_update: server -> client, batch of updates
- control: client -> server, actions & macro orchestration
- descriptor: server -> client, device descriptors (sent at connect)

## Instance tracking & safe shutdown (CLI)

For quick cleanup during development (especially when you have multiple simulator backends or Vite dev servers running), the frontend includes a small command-line helper that:

- Lists StoneGate backend/frontend instances currently listening on ports
- Labels them as **safe to shutdown** (simulators + frontend dev/preview) vs **potentially unsafe** (non-sim backends)
- Can terminate safe instances in bulk, while requiring an explicit `--force` for anything that might be hardware-backed

From `frontend/`:

```bash
pnpm stonegate:ps
pnpm stonegate:ps:json

# Watch backend activity (polls devices.poll periodically)
pnpm stonegate:watch
pnpm stonegate:watch -- --interval 0.5
pnpm stonegate:watch:once

# Stop only safe instances (frontend dev servers + backends launched with --sim)
pnpm stonegate:kill-safe

# Stop a specific PID (unsafe instances require --force)
pnpm stonegate:kill --pid 12345
node scripts/stonegate-admin.mjs kill --pid 12345 --force
```

Safety notes:

- Any StoneGate backend not launched with `--sim` is treated as **real/unknown** and will not be killed unless you pass `--force`.
- The tool uses the system process table + listening sockets to discover instances. When available, it also queries backend RPCs via `tools/build/toolbox_ws_client` to enrich listing details.
- `watch` surfaces any `job_id` / `recording_id` fields it finds inside polled measurements (many devices won’t include these).

## Local installation (Backend)

- Requirements:
  - Linux/macOS/Windows
  - C++ compiler supporting C++20 (GCC 10+/Clang 12+/MSVC recent)
  - CMake >= 3.16
  - pthreads (POSIX), Boost (system), libstdc++
  - nlohmann::json (header-only; available via package `nlohmann-json3-dev` on Debian/Ubuntu)
  - Optional: libcurl dev headers (for tools)

- Build steps:
  ```bash
  cd backend
  mkdir -p build && cd build
  cmake .. -DCMAKE_BUILD_TYPE=Release
  cmake --build . -- -j$(nproc)
  # run in simulator mode
  ./StoneGate --sim
  ```

## Local installation (Frontend)

- Requirements:
  - Node.js (LTS recommended)
  - pnpm (recommended) or npm

- Run:
  ```bash
  cd frontend
  pnpm install    # or `npm install`
  # set backend URL (optional)
  # simulator mode (backend: ./StoneGate --sim)
  export VITE_BACKEND_WS_URL='ws://localhost:8080/status'
  # hardware/default mode (backend: ./StoneGate)
  # export VITE_BACKEND_WS_URL='ws://localhost:9001/status'
  pnpm run dev
  ```

## Data & config locations
- Shared protocol files live in `shared/protocol` (DeviceGraph.json, ComponentSchema.json, PartsLibrary.json)
- User parts and device overrides (runtime): `shared/protocol/user_parts.json`, `shared/protocol/device_overrides.json`
- Example macros file (repo): `frontend/macros.json` (frontend also persists to localStorage)

## Containerization vs installers (short analysis)

- Containerization (Docker):
  - Pros: reproducible environment, easier to manage dependencies (C++ toolchain in image), portable CI/test runs,
    one command to start FE+BE with docker-compose.
  - Cons: increased complexity for developers unfamiliar with Docker, GPU/hardware passthrough for devices is non-trivial,
    larger image sizes.

- Native installers / packages:
  - Pros: users can run optimized native binaries, easier hardware access to devices (USB/Ethernet), smaller runtime overhead.
  - Cons: packaging for multiple OSes is work (deb/rpm/msi), dependency management can be tricky for C++ libraries.

- Recommendation (short): provide both for best coverage — a Docker-compose setup for quick demos and CI,
  and native build instructions for production hardware deployments that require direct device access.

## Developer checklist

- [ ] Build backend (`cmake`, `make`) and run simulator mode
- [ ] Start frontend (`pnpm run dev`) and ensure `VITE_BACKEND_WS_URL` points to backend
- [ ] Confirm `descriptor` message is received (initial device descriptors)
- [ ] Confirm `measurement_update` messages are received and applied to `useDeviceStore`
- [ ] Implement `handle_control` server-side to accept `control` messages and route to drivers
- [ ] Optional: implement macro execution server-side via `macro_run` control messages
