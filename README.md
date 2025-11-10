# Quantum Monitoring & Control — Starter Codebase (C++ backend + Web frontend)

**Goal:** Provide a working, well-structured skeleton codebase that implements the requested subsystems: backend diagnostics, results, reception, demo/simulator, state cache; plus a browser-based frontend (React) implementing transmission, reception, diagnostics UI, circuit editor skeleton, and display components. Code focuses on clarity, separation of concerns, testability, and places to plug real drivers / hardware SDKs / error-correction libraries.

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

```
mkdir build && cd build
cmake ..
cmake --build . -- -j
./quantum-backend --port 9001
```

### Frontend

```
cd frontend
npm install
npm start
```

Navigate to http://localhost:3000 — the frontend will connect to ws://localhost:9001 by default.

---

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

## Next steps

- Flesh out one concrete driver (e.g., a serial-based thermometer) and wire it end-to-end to the frontend display.
- Implement a small state-vector simulator in C++ for the Demo module and produce synthetic measurement histograms.
- Replace the WebSocket placeholder with a full Boost.Beast implementation and provide build-ready CMake config.
- Implement the CircuitEditor UI using `react-flow` or a canvas-based editor with drag & drop and gate operations.

---

## Licensing

N/A

---

*End of skeleton — many functions intentionally minimal to keep the prototype comprehensible.*

