# StoneGate: Quantum Architecture Monitoring & Control

**Goals:**  

- [ ] Provide a working, well-structured skeleton codebase that implements subsystems for controlling quantum architecture:
  - [ ] Backend [`c++`]: diagnostics, results, reception, demo/simulator, state cache;
  - [ ] Frontend [`vite/React`]: transmission and reception of instructions for backend
        determined from user interactions, diagnostics UI, display of apparatus components in an editable schematic.
  - [ ] Quantum Error Correction (QEC) API - utilize system state to better apply appropriate
        error corrections and interpret commands from script interface for executing quantum computations.
- [ ] Code focuses on clarity, separation of concerns, testability,
      and places to plug real drivers / hardware SDKs / error-correction libraries.
- [ ] Demonstrate to companies that _"I can 'river-dance' with the best of 'them'."_

## Prerequisites

 - C++20 compiler (GCC 10+, Clang 11+, or MSVC 2019+)
 - CMake 3.16+
 - nlohmann json development package (optional):  
   - `nlohmann-json3-dev` (lets CMake find `nlohmann_json` target)
   - [nlohmann/json](https://github.com/nlohmann/json) (header-only, included)
 - Node.js 20+ (for backend-sim and frontend)
 - pnpm (or npm/yarn) for frontend
 - `flask` and `jsonschema` python packages for testing QEC interface.
 - libcurl development headers: `libcurl4-openssl-dev` (needed to build `tools/qec_client`)

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

# or, run in background
nohup ./backend/build/StoneGate --sim > /tmp/StoneGate.log 2>&1 &
```

Notes:
- Use `./StoneGate --help` to see available options (`--sim`, `--port`, etc.).
- The backend starts a small stdin-based control thread only when stdin is a TTY. When you run the server detached (e.g. `nohup`, `systemd`, or redirecting stdin), the stdin control thread is skipped automatically to avoid the process being stopped by the shell.
- Additional documentation under `tools/simulators/README.md`.

### Test simulator (deterministic output)

```bash
./test_simulator --seed 42
# Optionally specify a custom device graph:
# ./test_simulator --graph ../../shared/protocol/DeviceGraph.json --seed 123
```

This prints the loaded device descriptors and a single measurement poll for all simulated devices. Use a fixed seed for predictable results.

---

## Frontend

```bash
cd frontend
pnpm install   # or npm install
pnpm dev       # or npm run dev
```

UI notes:
- The **Tools** menu includes **Diagnostics**, **Installation Wizard**, and **Help**.
- **Help** shows the frontend version, git commit, and build time (injected at build time).

Installation Wizard content:
- Source-of-truth: `docs/installation-wizard.md`
- Generated file: `frontend/src/generated/installWizard.ts`
- Regenerate manually: `pnpm -C frontend wizard:build` (also runs automatically during `pnpm -C frontend build`).

---

## Directory Structure

- `backend/` — C++ backend server, simulation, and device registry
- `backend-sim/` — Node.js simulator (optional, for frontend demo)
- `frontend/` — React frontend
- `shared/protocol/` — Device graph and component schemas

---

### Testing

- Run `./test_simulator --seed 42` to verify that simulated devices are loaded and produce deterministic measurements.
- Extend with more tests as needed for device logic, protocol, and QEC endpoints.

---

### Project layout

```
quantum-monitor/
├── README.md
├── backend/
│   ├── CMakeLists.txt
│   ├── include/
│   │   ├── Device.hpp
│   │   ├── DeviceRegistry.hpp
│   │   └── WebSocketServer.hpp
│   ├── src/
│   │   ├── main.cpp
│   │   ├── Backend.cpp
│   │   ├── DeviceRegistry.cpp
│   │   ├── WebSocketServer.cpp
│   │   └── core/
│   │       ├── PhysicsEngine.cpp
│   │       └── simulator/
│   └── tests/
├── backend-sim/
├── docs/
├── frontend/
│   ├── package.json
│   └── src/
│       ├── main.tsx
│       └── components/
│           └── SchematicCanvas/
├── shared/
│   ├── protocol/
│   │   ├── DeviceGraph.json
│   │   └── ComponentSchema.json
│   └── config/
├── tools/
└── LICENSE
```

---

#### Developer's Note: Quick tree generator (bash alias)

Below is a small bash function you can add to your shell aliases (e.g., in `~/.bashrc`) to print a 
compact project tree similar to the block above.  

It uses Python's `stdlib` so it doesn't require `tree` to be installed:  
```bash
treeproj() {
  python3 - <<'PY'
import os
def tree(path, prefix=''):
    try:
        entries = sorted([e for e in os.listdir(path) if not e.startswith('.')])
    except PermissionError:
        return
    for i, name in enumerate(entries):
        p = os.path.join(path, name)
        connector = '└── ' if i == len(entries)-1 else '├── '
        print(prefix + connector + name)
        if os.path.isdir(p):
            extension = '    ' if i == len(entries)-1 else '│   '
            tree(p, prefix + extension)

print('.')
tree('.')
PY
}

# Example usage:
# cd /path/to/project && treeproj
```

---

## High-level design notes

- **Backend (C++):** modular libraries separated into `diagnostic`, `results`, `reception`, `demo`.  
  Each subsystem exposes abstract interfaces (`IDevice`, `IMeasurementSource`, `IReceiver`) so hardware-specific drivers can be plugged in.
- **State cache:** thread-safe in-memory cache containing latest measurements, device metadata (tolerances, baseline), operation state, and logs.
- **Networking:** lightweight WebSocket server to communicate with browser frontend.  
  Protocol uses JSON messages (well-typed) and supports streaming telemetry and command/response semantics.
- **Frontend (React + TypeScript):**  
  The frontend determines error-correction choices by analyzing pre/post diagnostics and operation metadata (a placeholder strategy included).  
  UI components for:  
  - Transmission (send scripts / sequences),  
  - Reception (receive backend state),  
  - Diagnostics (show sensors, tolerances, zeroing),  
  - CircuitEditor (interactive quantum-circuit editor skeleton).  
- **Demo subsystem:** software-only simulator to generate:
  - Synthetic qubit outputs,
  - Semi-realistic modeling of physical hardware components,
  - Sensor noise to exercise the pipeline.

---

## Build & Run (summary)

### Backend (Linux / WSL / macOS)

Requires: C++17/C++20 compiler (GCC 10+/Clang 11+/MSVC 2019+), CMake >= 3.16, and a websocket library
(the codebase references WebSocket++ or Boost.Beast; the provided skeleton uses a lightweight ASIO-based placeholder).

Below are step-by-step instructions for common developer and operator flows.

1) Start backend in Simulator Mode (recommended for frontend/dev)

    ```bash
    cd backend
    mkdir -p build && cd build
    cmake .. -DCMAKE_BUILD_TYPE=Debug
    cmake --build . -- -j$(nproc)
    # start in simulator mode (auto-loads shared/protocol/DeviceGraph.json)
    ./StoneGate --sim
    ```

    Notes:
    - Simulator mode auto-loads `shared/protocol/DeviceGraph.json` and `shared/protocol/ComponentSchema.json`.
    - The `PhysicsEngine` computes derived properties (temperature, noise coeff) from controller states;  
        `SimulatedDevice` consults the engine when producing measurements.
    - To produce deterministic outputs for debugging, use the `test_simulator` binary with a fixed seed (see "Unit tests" below).

1) Start backend against real instruments (hardware mode).  
    Prerequisites:
    - Install required device drivers / vendor SDKs and verify hardware visibility (lsusb, ip link, etc.).
    - Edit `shared/protocol/DeviceGraph.json` so nodes map to real device identifiers and parts in `PartsLibrary.json` or `shared/protocol/user_parts.json`.
    - Ensure `backend` process can read/write `shared/protocol` (for device overrides and user parts persistence).
    Start the backend in hardware mode:

    ```bash
    cd backend/build
    ./StoneGate
    # or with explicit port: ./StoneGate 9001
    ```

    Notes:
    - In hardware mode the backend will attempt to instantiate real device driver classes (registered in `main.cpp`).  
      If a driver initialization fails, check system permissions, device paths, and driver logs.
    - Use the frontend Manual Control dialog (or the stdin control hook in `main.cpp` during development) to send control messages.

1) Unit tests and CI-less tests

    Build and run the CI-less tests (recommended; no GoogleTest dependency required):

    ```bash
    cd backend && mkdir -p build && cd build
    cmake .. -DCMAKE_BUILD_TYPE=Debug
    cmake --build . -- -j$(nproc)
    ./phys_engine_citest
    ./devices_citest
    ./simulator_citest
    ```

    Notes on GoogleTest:
    - To enable GoogleTest-based tests, configure `cmake` with `-DBUILD_TESTS=ON` and ensure a compatible GTest build is available.
    - If you see undefined references to a prebuilt `libgtest`, prefer building GTest from source for ABI compatibility.

1) Using the QEC service (Python stub) from Python or C++

    Start the QEC development stub (Python + Flask):

    ```bash
    cd backend
    python3 -m pip install --user flask jsonschema
    python3 qec_stub.py
    ```

    The stub provides these endpoints:

    - `POST /api/qec/submit` — submit a QEC job (request follows `shared/protocol/QECRequest.json`).
    - `GET /api/qec/status/<job_id>` — check job status.
    - `GET /api/qec/result/<job_id>` — fetch job result.

    Python example (submit and poll):

    ```python
    import requests
    QEC_URL = 'http://localhost:5001'
    payload = {
        'code': 'repetition',
        'measurements': [{'qubit':0,'basis':'Z','round':0,'value':1}]
    }
    resp = requests.post(f"{QEC_URL}/api/qec/submit", json=payload)
    job_id = resp.json()['job_id']
    print(requests.get(f"{QEC_URL}/api/qec/status/{job_id}").json())
    print(requests.get(f"{QEC_URL}/api/qec/result/{job_id}").json())
    ```

    C++ example (curl/libcurl):

    ```bash
    curl -X POST http://localhost:5001/api/qec/submit -H 'Content-Type: application/json' -d '{"code":"repetition","measurements":[{"qubit":0,"basis":"Z","round":0,"value":1}]}'
    ```

    C++ libcurl example (submit QEC job and print response):

    ```cpp
    #include <curl/curl.h>
    #include <string>
    #include <iostream>

    static size_t write_cb(void* ptr, size_t size, size_t nmemb, void* userdata) {
        std::string* resp = static_cast<std::string*>(userdata);
        resp->append(static_cast<char*>(ptr), size * nmemb);
        return size * nmemb;
    }

    int main() {
        CURL* curl = curl_easy_init();
        if (!curl) { std::cerr << "Failed to init curl" << std::endl; return 1; }

        std::string payload = R"({"code":"repetition","measurements":[{"qubit":0,"basis":"Z","round":0,"value":1}]})";
        std::string response;

        struct curl_slist* headers = nullptr;
        headers = curl_slist_append(headers, "Content-Type: application/json");

        curl_easy_setopt(curl, CURLOPT_URL, "http://localhost:5001/api/qec/submit");
        curl_easy_setopt(curl, CURLOPT_POST, 1L);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, payload.c_str());
        curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE, static_cast<long>(payload.size()));
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_cb);
        curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);

        CURLcode res = curl_easy_perform(curl);
        if (res != CURLE_OK) {
            std::cerr << "curl failed: " << curl_easy_strerror(res) << std::endl;
        } else {
            std::cout << "Response: " << response << std::endl;
        }

        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);
        return (res == CURLE_OK) ? 0 : 1;
    }
    ```

    Build (example):

    ```bash
    g++ -std=c++17 -O2 -o qec_client qec_client.cpp -lcurl
    # or if pkg-config is available:
    # g++ -std=c++17 -O2 -o qec_client qec_client.cpp $(pkg-config --cflags --libs libcurl)
    ```

    Management endpoints (parts & overrides):

    - `GET /api/parts` — merged builtin + user parts (user parts override builtin names).
    - `POST /api/parts/save` — save a user part (use `save_as_new`/`new_name` to avoid overwriting builtin parts).
    - `POST /api/parts/reset` — delete a user part by name.
    - `GET /api/device_overrides` — list per-device overrides.
    - `POST /api/device_overrides/save` — save per-device override.
    - `POST /api/device_overrides/reset` — reset per-device override.
    - `POST /api/device_overrides/reload` — touch/reload overrides file (useful to trigger backend re-read).

1) Supported quantum computation / QEC functions (prototype)

    This repository currently includes prototype QEC and decision utilities; supported/demo capabilities:

    - Repetition code (majority voting) — implemented as a simple decoder in the Python QEC stub.
    - Surface-code interface (stub) — the framework supports plugging in a real decoder implementation or external decoder service.
    - QEC job lifecycle APIs (submit / status / result) for integrating external decoder services.
    - Example heuristic mapping utilities (frontend): map device noise metrics (temperature, noise_coeff, photon loss) to decoder choices and parameters.

    To integrate a real decoder, implement a decoder service that consumes `QECRequest.json` and returns `QECResult.json`, and point the frontend or backend to that service (or extend `qec_stub.py`).

### Frontend (Vite/React/NodeJS)

```bash
cd frontend
pnpm install   # or npm install
pnpm dev       # or npm run dev
```

Open the URL printed by Vite (typically `http://localhost:5173`). The frontend will connect to `ws://localhost:8080/status` by default.

Notes:
- The frontend WebSocket default is `ws://localhost:8080/status` (matches backend `--sim`).
  If you run the backend in hardware/default mode (port 9001), set `VITE_BACKEND_WS_URL='ws://localhost:9001/status'` before starting the frontend.
  If you change the endpoint in the UI, it is persisted in `localStorage` under `stonegate.ws_url`; use the Connection Panel **Reset/Default** button to clear the override and return to the build default.

---

## Adding New Devices

To add a new device (real or simulated):

1. **Backend:**
    - Create a new class inheriting from `Device` (see `PhotonicDetectorDevice` for an example).
    - Implement all required methods: `id()`, `type()`, `descriptor()`, `read_measurement()`, `perform_action()`.
    - Register your device in `main.cpp` or via the `Simulator` loader.
    - For simulation, add your type and properties to `shared/protocol/ComponentSchema.json`.
    - For hardware, implement a driver class and call it from your device.

  **Action shape (UI + scripts):**
  - The UI and generated scripts use a generic action payload: `{ "set": { "metric": value, ... } }`.
  - Backend-side, map those generic `set` keys to your device's `perform_action()` keys, or accept `{set:{...}}` directly.

2. **Simulator:**
    - Add your device type and properties to `ComponentSchema.json`.
    - The simulator will auto-load and generate measurements for all properties.
    - For custom simulation logic, extend `SimulatedDevice::read_measurement()`.

3. **Frontend:**
    - Update UI components if you want custom display/controls for your device type.
    - The default schematic and device panels will show all properties and allow actions defined in the schema.

## Exposing New Operations to Python / C++

StoneGate exposes control operations via JSON-RPC over WebSocket.

1. **Backend (add an RPC method)**
  - Implement the RPC handler in the backend WebSocket RPC router (see `backend/src/WebSocketServer.cpp`).
  - Choose a stable method name (example: `"qec.decode"`, `"devices.list"`).
  - Return JSON results (and structured errors) consistently.

2. **Python (add a helper wrapper)**
  - Prefer adding a small wrapper in `stonegate_api.py` (transport/ops) or `stonegate_qec.py` (QEC-specific):
    - Use `await sg.rpc("your.method", params)` for raw calls.
    - Add a typed helper like `async def your_method(...): ...` for ergonomics.

3. **C++ (add a helper wrapper)**
  - Prefer adding a method on `stonegate::Client` in `stonegate_api.hpp`, or call `client.rpc("your.method", params)` directly.

4. **Device actions (no new RPC needed)**
  - If it is a per-device control, prefer using the existing `device.action` RPC and send `{ "set": {...} }`.
  - Python: `await sg.device_action("device_id", {"set": {...}})`
  - C++: `client.device_action("device_id", json{{"set", json{{...}}}})`

4. **Testing:**
    - Add a test in `test_simulator.cpp` to verify your device loads and produces expected output.

See `Device.hpp` and `SimulatedDevice.cpp` for more documentation and extension points.

## Build Mode, Swappable Parts, and Physical Coupling

_More precisely described in `docs/Software_Specifications.md`. This is just to serve as a quick reference._

We support a "build mode" concept and a parts-library driven simulation so users can swap parts
and see realistic physical coupling (e.g., LN2 flow -> temperature -> noise).

How it works (high level):

- `shared/protocol/PartsLibrary.json` contains parts and their specs (thermal conductance, noise coefficients, nominal values).
- `shared/protocol/DeviceGraph.json` nodes may optionally include a `part` field which names an entry in the parts library;
  otherwise the simulator picks a default part matching the node `type`.
- The `Simulator` now registers devices and a `PhysicsEngine` that computes derived values
  (temperature, noise coefficients) from controller states (e.g., `flow_rate_Lmin`).
- `SimulatedDevice::read_measurement()` will be extended to consult the physics engine
  and apply controller-influenced properties when available.

Build mode UX suggestions (to implement in frontend):

- Enter build mode from the schematic to add/remove parts, drag/drop part versions onto nodes, and wire connections.
- When editing a default (built-in) part, the frontend should prompt to "Save as new part" to avoid overwriting stock parts.
- Allow mapping of readings to controls and to QEC inputs  
  (e.g., map thermocouple temperature -> LN2 setpoint control loop, or map detector counts -> syndrome input).
- Allow specifying capture windows, tolerances, and sampling rates per device;
  store these as per-device overrides in the `DeviceGraph` or a separate `UserOverrides.json`.

Persistence & safety:

- Default parts (in `PartsLibrary.json`) are read-only. 
  User-created or modified parts get saved to a user library (e.g., `parts/user_parts.json`).
- Device instances in the `DeviceGraph` may include `overrides` that are persisted separately so the canonical graph remains intact.

<!-->
Next steps to complete this feature:

1. Extend `SimulatedDevice` to accept a `PhysicsEngine&` and query per-node computed properties each measurement.
2. Add a small IPC or shared-memory bridge if you want a separate physics worker process (later).
3. Build frontend build-mode UI: part browser (from `PartsLibrary` + user parts), drag/drop, wiring to signals/controls.
4. Add persistence endpoints or file-based saves for user parts and overrides.

<!-->

### Parts persistence API

The repository includes a small Flask service (`backend/qec_stub.py`) which exposes parts management endpoints for frontend integration during development. These endpoints operate on two files:

- Builtin parts (read-only by convention): `shared/protocol/PartsLibrary.json`
- User parts (editable, persisted by the service): `shared/protocol/user_parts.json`

Endpoints:

- `GET /api/parts` — returns the merged parts dictionary; user parts override builtin entries when names conflict.
- `POST /api/parts/save` — save a user part.  
  Request body JSON:
  - `{ "name": "MyPart_v1", "spec": { ... } }` — create or update a user part named `MyPart_v1`.
  - To avoid accidental overwrites of builtin parts, the service requires a save-as-new flow when the supplied `name` matches a builtin part.  
    Use:  
    `{ "name": "BuiltinName", "spec": { ... }, "save_as_new": true, "new_name": "MyPart_v1" }`  
    In that case the user part will be saved under the `new_name` provided.  
    Response: `{"status":"saved","name":"<saved_name>"}` on success.  
    
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

- When the user edits a builtin part, present a clear "Save as new" flow that asks for a new name;  
  call the API with `save_as_new` and `new_name` to persist the edited copy in `user_parts.json`.
- The frontend may call `GET /api/parts` to populate a part browser; merge client-side changes with local state before sending saves to the API.
- Device-level overrides (per-instance parameter edits) should be stored separately in `shared/protocol/device_overrides.json`
  via the device overrides endpoints (`/api/device_overrides/*`).  
  These are applied at runtime by the simulator/PhysicsEngine when present.

## Controller Support

Controllers (such as liquid nitrogen cooling) are supported just like devices.
See `LN2CoolingControllerDevice` for a C++ example.
Add your controller to `ComponentSchema.json` and register it in `main.cpp` or via the simulator loader.
The simulator and frontend will auto-detect new controllers and expose their properties and actions.

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

1. Gather pre-operation sensor baselines and post-operation diagnostics
   (temperature delta, magnetic fluctuations, photon background change).
2. Compute a noise vector `N` (vector of normalized deltas relative to tolerances).
3. Use a mapping table of noise patterns -> ECC choices
   (e.g., high thermal noise -> prefer surface code with higher syndrome sampling;
   photon bursts -> add majority-vote over repeated measurements).
   This mapping is configurable and extensible.

## Developer resources

There is a concise developer quickstart in `docs/DEVELOPER.md` that shows the expected WebSocket message shapes,
how the frontend hooks (`onSelectNode`, `onOpenDialog`) connect to the `SchematicCanvas`,
and quick steps to run the backend in simulator mode.
It also contains guidance on running the Python QEC stub, the C++ example QEC client,
and a short discussion about Docker vs native deployment for demos.

This is left as a decision-engine module (`frontend/src/errordecision.ts`) with pluggable rules —
the codebase includes a small example function with a few heuristics.

---

## Integration points and where to plug real code

- `IDiagnosticProvider::pollOnce()` — implement drivers that read from hardware SDKs or DAQ libraries
  (NI-DAQmx, serial, Modbus, gRPC bridges, etc.).
- WebsocketServer — replace minimal hook with a real server
  (Boost.Beast, WebSocket++, uWebSockets) that accepts clients and routes JSON messages.
- `IScriptRunner::runInstruction()` — implement concrete runners that call hardware control code
   (moving probes, toggling relays, scheduling pulse sequences to an AWG or FPGA).
- DemoSimulator — extend to simulate quantum gates using a small statevector or density-matrix simulator
  (e.g., integrate with Eigen for linear algebra).
  For larger workloads, consider integrating C++ libraries like `qpp` or linking to Python simulators via IPC.
- Error correction logic — real ECC selection depends heavily on available codes (surface code, repetition code, Bacon-Shor).
  Plug in libraries or proprietary implementations behind an interface.

---

## Licensing

N/A

---
