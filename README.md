# StoneGate: Quantum Architecture Monitoring & Control

**Goals:**  
- [ ] Provide a working, well-structured skeleton codebase that implements subsystems for controlling quantum architecture: 
  - [ ] Backend [`c++`]: diagnostics, results, reception, demo/simulator, state cache;
  - [ ] Frontend [`vite/React`]: transmission and reception of instructions for backend determined from user interactions, diagnostics UI, display of apparatus components in an editable schematic.
  - [ ] Quantum Error Correction (QEC) API - utilize system state to better apply appropriate error corrections and interpret commands from script interface for executing quantum computations.
- [ ] Code focuses on clarity, separation of concerns, testability, and places to plug real drivers / hardware SDKs / error-correction libraries.
- [ ] Demonstrate to companies that I'm not a poser.

## Prerequisites

- C++20 compiler (GCC 10+, Clang 11+, or MSVC 2019+)
- CMake 3.16+
- [nlohmann/json](https://github.com/nlohmann/json) (header-only, included)
- Node.js 20+ (for backend-sim and frontend)
- pnpm (or npm/yarn) for frontend
- `flask` and `jsonschema` python packages for testing QEC interface.

## Backend (C++)

### Build

```bash
cd backend
mkdir -p build && cd build
cmake ..
cmake --build . -- -j$(nproc)
```

### Run backend with real devices (default)

```bash
./StoneGate
# or specify port: ./StoneGate 9001
```

### Run backend in simulation mode (auto-loads devices from shared/protocol/DeviceGraph.json)

```bash
./StoneGate --sim
```

### Test simulator (deterministic output)

```bash
./test_simulator --seed 42
# Optionally specify a custom device graph:
# ./test_simulator --graph ../../shared/protocol/DeviceGraph.json --seed 123
```
This prints the loaded device descriptors and a single measurement poll for all simulated devices. Use a fixed seed for predictable results.

---

## Backend Simulator (Node.js, legacy)

For a JS-based backend simulator (for frontend demo/testing):

```bash
cd backend-sim
npm install
npm start
```

---

## Frontend

```bash
cd frontend
pnpm install   # or npm install
pnpm dev       # or npm run dev
```

---

## Directory Structure

- `backend/` — C++ backend server, simulation, and device registry
- `backend-sim/` — Node.js simulator (optional, for frontend demo)
- `frontend/` — React frontend
- `shared/protocol/` — Device graph and component schemas

---

## Testing

- Run `./test_simulator --seed 42` to verify that simulated devices are loaded and produce deterministic measurements.
- Extend with more tests as needed for device logic, protocol, and QEC endpoints.

---

---

## Project layout

```
quantum-monitor/
├── backend/
│   ├── include/
│   │   ├── core/state_cache.h
│   │   ├── backend/diagnostic.h
│   │   ├── backend/results.h
│   │   ├── backend/reception.h
│   │   ├── backend/demo.h
│   │   └── net/websocket_server.h
│   ├── src/
│   │   ├── core/state_cache.cpp
│   │   ├── backend/diagnostic.cpp
│   │   ├── backend/results.cpp
│   │   ├── backend/reception.cpp
│   │   ├── backend/demo.cpp
│   │   └── net/websocket_server.cpp
│   └── CMakeLists.txt
├── frontend/
│   ├── package.json
│   ├── public/
│   └── src/
│       ├── App.tsx
│       ├── index.tsx
│       ├── components/
│       │   ├── FrontendTransmission.tsx
│       │   ├── FrontendReception.tsx
│       │   ├── DiagnosticsPanel.tsx
│       │   ├── CircuitEditor.tsx
│       │   └── DeviceView.tsx
│       └── api/websocket.ts
├── tools/
│   └── demo_noise_generator.py (optional helper)
├── README.md
└── LICENSE
```

---

## High-level design notes

- **Backend (C++):** modular libraries separated into `diagnostic`, `results`, `reception`, `demo`. Each subsystem exposes abstract interfaces (`IDevice`, `IMeasurementSource`, `IReceiver`) so hardware-specific drivers can be plugged in.
- **State cache:** thread-safe in-memory cache containing latest measurements, device metadata (tolerances, baseline), operation state, and logs.
- **Networking:** lightweight WebSocket server to communicate with browser frontend. Protocol uses JSON messages (well-typed) and supports streaming telemetry and command/response semantics.
- **Frontend (React + TypeScript):** UI components for Transmission (send scripts / sequences), Reception (receive backend state), Diagnostics (show sensors, tolerances, zeroing), CircuitEditor (interactive quantum-circuit editor skeleton). The frontend determines error-correction choices by analyzing pre/post diagnostics and operation metadata (a placeholder strategy included).
- **Demo subsystem:** software-only simulator to generate synthetic qubit outputs and sensor noise to exercise the pipeline.

---

## Build & Run (summary)

### Backend (Linux / WSL / macOS)

- Requires: C++17, CMake >= 3.15, a websocket library (this skeleton references [WebSocket++](https://github.com/zaphoyd/websocketpp) or Boost.Beast — you can choose). For the skeleton we provide a minimal ASIO-based server placeholder.

```bash
mkdir build && cd build
cmake ..
cmake --build . -- -j
./quantum-backend --port 9001
```

### Frontend

```bash
cd frontend
npm install
npm start
```

Navigate to http://localhost:3000 — the frontend will connect to ws://localhost:9001 by default.

---

## Adding New Devices

To add a new device (real or simulated):

1. **Backend (C++):**
	- Create a new class inheriting from `Device` (see `PhotonicDetectorDevice` for an example).
	- Implement all required methods: `id()`, `type()`, `descriptor()`, `read_measurement()`, `perform_action()`.
	- Register your device in `main.cpp` or via the `Simulator` loader.
	- For simulation, add your type and properties to `shared/protocol/ComponentSchema.json`.
	- For hardware, implement a driver class and call it from your device.

2. **Simulator:**
	- Add your device type and properties to `ComponentSchema.json`.
	- The simulator will auto-load and generate measurements for all properties.
	- For custom simulation logic, extend `SimulatedDevice::read_measurement()`.

3. **Frontend:**
	- Update UI components if you want custom display/controls for your device type.
	- The default schematic and device panels will show all properties and allow actions defined in the schema.

4. **Testing:**
	- Add a test in `test_simulator.cpp` to verify your device loads and produces expected output.

See `Device.hpp` and `SimulatedDevice.cpp` for more documentation and extension points.

## Build Mode, Swappable Parts, and Physical Coupling

We support a "build mode" concept and a parts-library driven simulation so users can swap parts and see realistic physical coupling (e.g., LN2 flow -> temperature -> noise).

How it works (high level):

- `shared/protocol/PartsLibrary.json` contains parts and their specs (thermal conductance, noise coefficients, nominal values).
- `shared/protocol/DeviceGraph.json` nodes may optionally include a `part` field which names an entry in the parts library; otherwise the simulator picks a default part matching the node `type`.
- The `Simulator` now registers devices and a `PhysicsEngine` that computes derived values (temperature, noise coefficients) from controller states (e.g., `flow_rate_Lmin`).
- `SimulatedDevice::read_measurement()` will be extended to consult the physics engine and apply controller-influenced properties when available.

Build mode UX suggestions (to implement in frontend):

- Enter build mode from the schematic to add/remove parts, drag/drop part versions onto nodes, and wire connections.
- When editing a default (built-in) part, the frontend should prompt to "Save as new part" to avoid overwriting stock parts.
- Allow mapping of readings to controls and to QEC inputs (e.g., map thermocouple temperature -> LN2 setpoint control loop, or map detector counts -> syndrome input).
- Allow specifying capture windows, tolerances, and sampling rates per device; store these as per-device overrides in the `DeviceGraph` or a separate `UserOverrides.json`.

Persistence & safety:

- Default parts (in `PartsLibrary.json`) are read-only. User-created or modified parts get saved to a user library (e.g., `parts/user_parts.json`).
- Device instances in the `DeviceGraph` may include `overrides` that are persisted separately so the canonical graph remains intact.

Next steps to complete this feature:

1. Extend `SimulatedDevice` to accept a `PhysicsEngine&` and query per-node computed properties each measurement.
2. Add a small IPC or shared-memory bridge if you want a separate physics worker process (later).
3. Build frontend build-mode UI: part browser (from `PartsLibrary` + user parts), drag/drop, wiring to signals/controls.
4. Add persistence endpoints or file-based saves for user parts and overrides.

If you'd like, I can implement steps 1 and 4 next (backend wiring and simple user parts persistence). Which do you prefer I do first?

### Parts persistence API

The repository includes a small Flask service (`backend/qec_stub.py`) which exposes parts management endpoints for frontend integration during development. These endpoints operate on two files:

- Builtin parts (read-only by convention): `shared/protocol/PartsLibrary.json`
- User parts (editable, persisted by the service): `shared/protocol/user_parts.json`

Endpoints:

- `GET /api/parts` — returns the merged parts dictionary; user parts override builtin entries when names conflict.

- `POST /api/parts/save` — save a user part. Request body JSON:

	- `{ "name": "MyPart_v1", "spec": { ... } }` — create or update a user part named `MyPart_v1`.
	- To avoid accidental overwrites of builtin parts, the service requires a save-as-new flow when the supplied `name` matches a builtin part. Use:

		`{ "name": "BuiltinName", "spec": { ... }, "save_as_new": true, "new_name": "MyPart_v1" }`

		In that case the user part will be saved under the `new_name` provided.

	- Response: `{"status":"saved","name":"<saved_name>"}` on success.

	Example (create/update user part):

	```bash
	curl -X POST http://localhost:5001/api/parts/save \
		-H 'Content-Type: application/json' \
		-d '{"name":"MyPart_v1","spec":{"setpoint_default":4.2,"noise_coeff":0.02}}'
	```

	Example (save-as-new to avoid overwriting builtin):

	```bash
	curl -X POST http://localhost:5001/api/parts/save \
		-H 'Content-Type: application/json' \
		-d '{"name":"BuiltinPart","spec":{...},"save_as_new":true,"new_name":"BuiltinPart_custom_v1"}'
	```

- `POST /api/parts/reset` — remove a user part by name (revert to builtin if present). Request body: `{ "name": "MyPart_v1" }`.

	Example:

	```bash
	curl -X POST http://localhost:5001/api/parts/reset \
		-H 'Content-Type: application/json' \
		-d '{"name":"MyPart_v1"}'
	```

Notes for frontend implementers:

- When the user edits a builtin part, present a clear "Save as new" flow that asks for a new name; call the API with `save_as_new` and `new_name` to persist the edited copy in `user_parts.json`.
- The frontend may call `GET /api/parts` to populate a part browser; merge client-side changes with local state before sending saves to the API.
- Device-level overrides (per-instance parameter edits) should be stored separately in `shared/protocol/device_overrides.json` via the device overrides endpoints (`/api/device_overrides/*`). These are applied at runtime by the simulator/PhysicsEngine when present.

## Controller Support

Controllers (such as liquid nitrogen cooling) are supported just like devices. See `LN2CoolingControllerDevice` for a C++ example. Add your controller to `ComponentSchema.json` and register it in `main.cpp` or via the simulator loader. The simulator and frontend will auto-detect new controllers and expose their properties and actions.


## Quantum Error Correction (QEC) API

### QEC Service (Python stub)

To run the QEC service stub (requires Python 3.8+ and Flask):

```bash
cd backend
pip install flask
python3 qec_stub.py
```

This starts a REST API on port 5001:

- `POST /api/qec/submit` — submit a QEC job (see `shared/protocol/QECRequest.json`)
- `GET /api/qec/status/<job_id>` — check job status
- `GET /api/qec/result/<job_id>` — get result (see `shared/protocol/QECResult.json`)

Example request (using curl):

```bash
curl -X POST http://localhost:5001/api/qec/submit \
	-H 'Content-Type: application/json' \
	-d '{"code":"surface","measurements":[{"qubit":0,"basis":"Z","round":0,"value":1}]}'
```

## Important files (selected excerpts)

### Error correction decision (frontend) — simple heuristic

In `FrontendReception` after an operation completes, the frontend will:

1. Gather pre-operation sensor baselines and post-operation diagnostics (temperature delta, magnetic fluctuations, photon background change).
2. Compute a noise vector `N` (vector of normalized deltas relative to tolerances).
3. Use a mapping table of noise patterns -> ECC choices (e.g., high thermal noise -> prefer surface code with higher syndrome sampling; photon bursts -> add majority-vote over repeated measurements). This mapping is configurable and extensible.

This is left as a decision-engine module (`frontend/src/errordecision.ts`) with pluggable rules — the codebase includes a small example function with a few heuristics.


---

## Integration points and where to plug real code

- `IDiagnosticProvider::pollOnce()` — implement drivers that read from hardware SDKs or DAQ libraries (NI-DAQmx, serial, Modbus, gRPC bridges, etc.).
- WebsocketServer — replace minimal hook with a real server (Boost.Beast, WebSocket++, uWebSockets) that accepts clients and routes JSON messages.
- `IScriptRunner::runInstruction()` — implement concrete runners that call hardware control code (moving probes, toggling relays, scheduling pulse sequences to an AWG or FPGA).
- DemoSimulator — extend to simulate quantum gates using a small statevector or density-matrix simulator (e.g., integrate with Eigen for linear algebra). For larger workloads, consider integrating C++ libraries like `qpp` or linking to Python simulators via IPC.
- Error correction logic — real ECC selection depends heavily on available codes (surface code, repetition code, Bacon-Shor). Plug in libraries or proprietary implementations behind an interface.

---

## Licensing

N/A

---
