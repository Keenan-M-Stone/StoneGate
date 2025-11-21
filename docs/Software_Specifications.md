# StoneGate Software Specifications

Version: 0.1
Date:    2025-11-21
Author:  StoneGate Team

This document is a reference specification for the StoneGate monitoring and control software. It describes UI dialog behavior, allowed inputs for controls, the physics and control calculations used, supported error correction algorithms and their adaptation logic, relevant hardware tolerances, and the catalogued error messages (with numbered ranges and cause/action guidance).

**Contents**
- Overview
- Dialog behavior (UI)
- Acceptable UI entries and validation rules
- Control-system calculations and equations (with references)
- Supported error-correction algorithms and adaptation logic (with references)
- Hardware specifications and tolerances
- Error messages catalog (numbered ranges with cause/action)
- Appendices: simulator & physics engine design notes, WebSocket control RPCs

---

## Overview

StoneGate is a modular monitoring and control framework for silicon-photonic single-photon-qubit experiments. The software is separated into:
- Frontend (React): schematic editor, device panels, diagnostics dialogs, build-mode UI
- Backend (C++): device registry, drivers, simulator, physics engine, WebSocket server
- QEC service (prototype Flask): QEC job submission and parts/device override management

This specification documents user-facing behavior (dialogs), the allowed inputs and validation rules, the control calculations used by backend and frontend decision logic, and detailed error messages.

## Dialog behavior (UI)

Each dialog in the frontend should adhere to these guidelines. Dialog titles, primary action, cancel action, and expected lifecycle are listed.

1) **Device Properties Dialog**
- Purpose: Inspect and edit per-device parameters (setpoints, tolerances, capture windows).
- Open: from device node context menu or device panel "Edit Properties" action.
- Fields displayed:
  - Device ID: read-only string (unique identifier)
  - Device Type: read-only string
  - Part: dropdown of available parts (builtin + user). Selecting a builtin part will show a small warning: "Editing a builtin part will require Save-As-New to persist changes." (Confirm to continue editing.)
  - Setpoint: numeric input (units depend on device, e.g., K or C). Must meet `min <= value <= max` per the selected part's `specs.range` or the device default.
  - Tolerance (absolute or percent): numeric input; backend expects a positive value; UI allows choosing between `absolute` and `percent` mode.
  - Capture Window: two numeric inputs `start_ms` and `duration_ms`. Start must be >= 0, duration > 0 and <= 1e6 (1e6 ms = 1000s) by default.
  - Sampling Rate: dropdown or numeric input (Hz); allowed values depend on device capabilities (for simulated devices, see `ComponentSchema.json` properties). By default sampling rate must be in `[1e-4, 1e4]` Hz.
  - Advanced: JSON editor for per-device `overrides` (validated by schema `DeviceOverrideSchema.json` on save).
- Actions:
  - Save: If editing a builtin part, prompt to Save-As-New. If user agrees and supplies `new_name`, call `/api/parts/save` with `save_as_new=true`.
  - Cancel: revert changes in UI. A confirmation appears if unsaved edits are present.
  - Reset to Default: only enabled if a user part exists for the part name or a device override exists; calls `/api/parts/reset` or `/api/device_overrides/reset`.
- Validation rules:
  - Fields must pass client-side validation before enabling `Save`.
  - The JSON editor must be valid JSON and match the `DeviceOverrideSchema.json` (if available); server-side validation will also run.

2) **Build Mode / Parts Browser Dialog**
- Purpose: Browse PartsLibrary and user parts, drag parts onto nodes in the schematic, and create new parts.
- Behavior:
  - Left pane: part categories + search filter (text contains search across name and specs values).
  - Clicking a part opens a preview right pane showing `specs`, `datasheet_url`, and recommended tolerance ranges.
  - Dragging a part onto a node sets that node's `part` field in the `DeviceGraph` (local edit, not persisted until user clicks `Persist Graph`).
  - Editing a builtin part: opening the part in an editor shows a banner: "Builtin part — to persist edits, use Save As New." The `Save` button is disabled until user toggles `Save as new` and provides a unique name.
  - Persist Graph: writes the `DeviceGraph.json` draft into a workspace copy and optionally sends device override entries via `/api/device_overrides/save`.

3) **Manual Control Dialog**
- Purpose: Provide direct manual controls for a device (e.g., set LN2 flow_rate, zero sensors, trigger pulse sequences).
- Behavior:
  - Displays a set of controls mapped from device `actions` (as defined in `ComponentSchema.json`).
  - Actions are guarded: if a control could lead to unsafe state (as defined by the device `specs.safety` flags), a confirmation modal is presented describing the risk.
  - Manual control requests are sent via WebSocket control messages: `{"type":"control","device_id":"<id>","action":{...}}`.
  - The server responds with an acknowledgement message (over WebSocket) with the same `device_id` and a status field `ack: accepted|rejected|error`.

4) **Diagnostics / QEC Submission Dialog**
- Purpose: Select measurement windows and submit data to QEC service.
- Behavior:
  - User selects devices and time-range (or capture windows) using present measurement history.
  - Client performs basic sanity checks: at least one device selected, time-range non-empty, sampling rate meets QEC service limits (e.g., minimum sampling > 1 Hz if required by the chosen QEC algorithm).
  - On submit, a `POST /api/qec/submit` with the JSON payload matching `QECRequest.json` is performed. UI shows job progress using `GET /api/qec/status/<job_id>` and retrieves result via `GET /api/qec/result/<job_id>`.

---

## Acceptable UI entries and validation rules

This section enumerates, per control type, the allowed formats and acceptable ranges.

- Text fields (identifiers): ASCII printable characters, max 128 characters, no leading/trailing whitespace. IDs must match regex `^[A-Za-z0-9_\-:.]+$`.
- Numeric fields:
  - Integers: within the device-specified `min`/`max` if present. Otherwise 64-bit signed integer bounds.
  - Floating point: double precision; enforce `min <= value <= max` where provided. Tolerance percentages must be in `[0,100]`.
  - Units: UI enforces units per device (e.g., temperature in `K` or `C`). Conversion functions must be applied consistently; display uses device-specified unit in `ComponentSchema`.
- Dropdowns: must select a value from provided options; unknown/empty selections should be rejected.
- JSON editor fields: must be valid JSON. For parts and overrides, the JSON schema used is:
  - `PartSchema.json` — describes a part entry (type, specs, datasheet_url)
  - `DeviceOverrideSchema.json` — describes per-device overrides (e.g., `specs` partial overrides)
- File uploads (datasheets): must be PDF files under 5MB unless server config overrides.

Validation is performed client-side for responsiveness, with server-side canonical validation in `qec_stub.py` (if `jsonschema` available) and in the C++ backend where applicable.

---


## Control-system calculations and equations

This section documents the formulas used in the demo `PhysicsEngine` and the control heuristics used in the frontend decision engine. These are intended as reference; production control systems should replace toy models with physical models and robust controllers.

### 1. Temperature propagation model (simple demo model implemented)

Per-node base setpoint (from `specs.setpoint_default`) is used as the uncooled base temperature, $T_0$.

Any connected LN2 controller contributes a cooling delta proportional to its flow rate:

$$
\Delta T = -\alpha \cdot F
$$

where $\alpha$ is a coupling coefficient (demo uses $\alpha = 0.5 \, \frac{K}{L/min}$ for directly-connected links) and $F$ is the flow in $L/min$. [See: [C1]](#citations)

The computed temperature is:

$$
T = \max(T_{\text{floor}}, T_0 + \sum \Delta T)
$$

where $T_{\text{floor}}$ is a safety floor (1 K in demo) to avoid non-physical results.

Noise coefficient (used to compute uncertainty): if a part specifies `specs.noise_coeff`, the uncertainty for a measured quantity $x$ is:


  $$
  	ext{uncertainty} = |x| \cdot \text{noise\_coeff}
  $$

If not specified, the engine uses a default (0.01).

---

### 2. Control heuristic examples (frontend decision engine)

Thermal drift normalization: compute baseline $B$ as median of previous $N$ samples; compute normalized delta

$$
D = \frac{\text{value} - B}{\text{tolerance}}
$$

Flags are raised if $|D| > 1$ for a `persist_seconds` window.

SNR mapping for photonic detectors:

$$
\mathrm{SNR} = \frac{\text{signal\_mean} - \text{background\_mean}}{\text{background\_std}}
$$

Map to operational choices (higher redundancy if SNR $<$ threshold). [See: [C2]](#citations)

---

### 3. QEC decision mapping (heuristic)

Map measurement noise metrics to QEC choices. Example mapping:

- If thermal noise estimated (via $\text{noise\_coeff}$ adjusted by temperature delta) $> 0.1$ $\implies$ choose more frequent syndrome rounds and stronger decoding (e.g., higher-distance surface code variant).
- If photon loss rate $> 5\%$ $\implies$ prefer repetition code or increase measurement redundancy.

See: [C3], [C4] in [Citations](#citations)

---

## Supported error-correction algorithms and adaptation logic

The software's QEC module is a pluggable stub. The framework supports integrating external decoders. Presently the prototype supports:

- Repetition code (simple majority voting over repeated measurements)
- Surface code (stub interface; real decoder integration expected via plugin)

Adaptation rules (how to choose or parameterize a decoder):
- Based on device-measured metrics (per-device noise_coeff, temperatures, photon loss rates, detector dark counts), map to decoder parameters such as code distance, syndrome sampling rate, and decoder time budget.
- Example rule (illustrative):
  - If average detector `noise_coeff * temperature_ratio` > 0.2 -> increase syndrome sampling by factor 2 and select decoder with `max_edge_weight` lowered to increase sensitivity.


---

---

## Hardware specifications and tolerances

This section lists the hardware-relevant specs the software uses or expects to query/observe from the parts library.

- Thermocouples / thermometers:
  - Precision: typical 0.01 °C (example value in `ComponentSchema.json`)
  - Range: [-200, 500] °C
  - Response time: device-dependent; sampling intervals below device response time are ignored or downsampled in the backend.

- LN2 cooling controllers:
  - Flow rate range: [0.0, 100.0] L/min in parts library example
  - Setpoint control resolution: 0.1 L/min

- Photonic detectors:
  - Dark count rate: specified as counts per second (cps)
  - Maximum counts/s depending on detector model (see part `specs.max_counts`)

General rules:
- The frontend should not allow user-configured sampling rates exceeding the device's `specs.max_sampling_rate` when present.
- Tolerances used in the UI are per-part; if unspecified, the UI uses conservative defaults: precision 0.05 relative, absolute tolerance based on typical device class.


---


## Citations

<span id="citations"></span>

**[C1]** C. Kittel and H. Kroemer, "Thermal Physics"; Y. Ozisik, "Heat Conduction"; [Wikipedia: Heat Equation](https://en.wikipedia.org/wiki/Heat_equation)

**[C2]** S. M. Kay, "Fundamentals of Statistical Signal Processing" (Estimation Theory); R. G. Gallager, "Principles of Digital Communication"

**[C3]** A. G. Fowler et al., "Surface codes: Towards practical large-scale quantum computation", arXiv:1208.0928 ([arXiv link](https://arxiv.org/abs/1208.0928))

**[C4]** M. Nielsen & I. Chuang, "Quantum Computation and Quantum Information"; D. A. Lidar and T. A. Brun (eds.), "Quantum Error Correction" (Cambridge University Press)

---

## Error messages catalog

Numbering scheme (high level):
- 1000-1999: Frontend/UI errors
  - 1000-1099: UI validation and input errors
  - 1100-1199: Build-mode / parts browser errors
- 2000-2999: Backend errors
  - 2000-2199: Device read & status errors
  - 2200-2299: Parts library / overrides errors
  - 2300-2399: PhysicsEngine & simulation errors
  - 2400-2499: WebSocket / control channel errors
- 3000-3999: QEC service and protocol errors
  - 3000-3099: QEC submission/format errors
  - 3100-3199: QEC run-time errors

Each entry: Error code, message form, cause(s), action(s).


### 1000-1099 — UI validation errors

- Error 1000: "Error 1000: Invalid identifier for %s — must match ^[A-Za-z0-9_\-:.]+$ and be <=128 chars."
  - Cause: User entered an ID with disallowed characters or too long.
  - Action: Edit the identifier to conform; UI highlights the offending characters.

- Error 1010: "Error 1010: Numeric field '%s' out of range [%s, %s]."
  - Cause: Entered value outside the acceptable range for the control.
  - Action: Enter a value within the displayed min/max; consult device specs.


### 1100-1199 — Build-mode / parts browser errors

- Error 1100: "Error 1100: Cannot overwrite builtin part '%s' without Save-As-New."
  - Cause: Attempt to save a modified part with an existing builtin name without `save_as_new`.
  - Action: Use Save-As-New and supply a new unique name.


### 2000-2199 — Device read & status errors

- Error 2000: "Error 2000: Failed to read device '%s' — I/O error: %s".
  - Cause: Driver failed to communicate (USB/ETH timeouts, disconnected device).
  - Action: Check connections, restart device, check OS-level device drivers.

- Error 2010: "Error 2010: Device '%s' measurement out of expected range: %s +/- %s".
  - Cause: Sensor reporting values outside configured ranges.
  - Action: Verify sensor calibration, check ambient conditions, consider setting a wider tolerance or zeroing device.

- Error 2020: "Error 2020: Device '%s' not responding for %d seconds".
  - Cause: Driver busy, process stuck, or hardware fault.
  - Action: Attempt device reset (`Perform Action -> reset`), power-cycle hardware if safe.


### 2200-2299 — Parts library / overrides errors

- Error 2200: "Error 2200: Parts library load failed: %s".
  - Cause: Missing or invalid `PartsLibrary.json`.
  - Action: Restore the file from repository, or use the API to re-upload/repair.

- Error 2210: "Error 2210: Failed to save user part '%s': %s".
  - Cause: File write permissions, malformed part spec.
  - Action: Ensure server has write permissions to `shared/protocol/user_parts.json`; validate JSON schema.

- Error 2220: "Error 2220: Device override '%s' invalid: %s".
  - Cause: Override JSON fails schema validation.
  - Action: Review the override JSON; use the UI JSON editor which validates before save.


### 2300-2399 — PhysicsEngine & simulation errors

- Error 2300: "Error 2300: PhysicsEngine compute failure: %s".
  - Cause: Unexpected exception during compute (bad numeric values, malformed specs).
  - Action: Inspect logs, check parts/overrides for NaN/invalid numbers.

- Error 2310: "Error 2310: Override reload failed for file '%s'".
  - Cause: File read error, malformed JSON.
  - Action: Use `/api/device_overrides/reload` to re-touch and check server logs; fix JSON syntax.

- Error 2320: "Error 2320: Incompatible unit conversion for device '%s' property '%s'".
  - Cause: Mismatch between parts library unit and device property unit.
  - Action: Ensure `ComponentSchema.json` and parts specify consistent units; apply conversions.


### 2400-2499 — WebSocket / control channel errors

- Error 2400: "Error 2400: Control message rejected: %s".
  - Cause: Malformed control message or unsupported action.
  - Action: Verify control message format matches DescriptorProtocol (see protocol docs).

- Error 2410: "Error 2410: WebSocket session dropped unexpectedly".
  - Cause: Network interruption, client closed socket.
  - Action: Reconnect client; check server socket limits.


### 3000-3199 — QEC service errors

- Error 3000: "Error 3000: QEC submit failed — bad request: %s".
  - Cause: Submitted measurement payload missing required fields.
  - Action: Validate request against `QECRequest.json` schema and re-submit.

- Error 3100: "Error 3100: QEC job %s failed during decoding: %s".
  - Cause: Decoder exception or out-of-resources.
  - Action: Retry with smaller batch or check QEC backend logs.

---

## Appendices

### Simulator & Physics Engine design notes
- The `Simulator` loads `DeviceGraph.json` and `ComponentSchema.json`. For each node it selects a part spec (builtin or user part) and registers nodes/edges with `PhysicsEngine`.
- `PhysicsEngine` maintains controller states and recomputes derived properties on a timed background loop (configurable interval). A cached snapshot is provided to simulated devices via `get_cached_step()`.
- Device overrides are read from `shared/protocol/device_overrides.json` and deep-merged into part specs for computation.

### WebSocket control RPCs
- Control messages are JSON objects sent over the WebSocket control channel (future integration). Example:
  - Reload device overrides:
    ```json
    {
        "type": "control",
        "cmd": "reload_overrides" 
    }
    ```
  - Manual device action:
    ```json
    {
        "type": "control",
        "cmd": "action",
        "device_id": "sim_ln2",
        "action": { 
            "set", { "flow_rate_Lmin": 2.5 } 
        } 
    }
    ```

Server-side handling:
- The `WebSocketServer` exposes a `handle_control(json)` method which should be invoked when a control message arrives. In the demo implementation a small stdin control thread calls this method for development.

---

## Final notes
This document is intended to be a living specification. As the project evolves, please update this file to reflect current behavior, any additional dialog variants, and newly integrated decoders or hardware models.

For questions or clarifications, open an issue in the repository or ask the development lead.

## Running the Unit Tests

This project includes several CI-less (framework-free) test binaries and optional GoogleTest cases. The CI-less tests are intended to run without relying on external test frameworks and are suitable for quick local validation.

Files and purposes:
- `phys_engine_citest`: exercises `PhysicsEngine` loading, override merging, background loop, and cached snapshot behavior.
  - Expected run time: ~0.2 - 0.5s
  - Common issues: missing CMake/compilers (install `cmake`, `build-essential`); failure to load parts/overrides files — ensure `shared/protocol` contains `PartsLibrary.json` or that temporary files can be written.
- `devices_citest`: exercises basic device descriptors and `read_measurement()` for core devices (`Thermocouple`, `PhotonicDetector`, `LN2CoolingController`).
  - Expected run time: ~0.05 - 0.2s
  - Common issues: missing device source in CMake (re-run CMake), RNG seeding differences (non-deterministic values are OK), missing includes.
- `simulator_citest`: loads a small `DeviceGraph` into `Simulator` and checks registry descriptors and a sample poll.
  - Expected run time: ~0.1 - 0.5s
  - Common issues: `ComponentSchema.json` or `PartsLibrary.json` absent in the same folder as the provided graph; permission issues writing temp files.

How to run all tests (build first):

```bash
cd backend
mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Debug
cmake --build . -- -j$(nproc)
# run the CI-less test binaries directly:
./phys_engine_citest
./devices_citest
./simulator_citest
```

Or via `ctest` (after building):

```bash
ctest --verbose
```

Notes on GoogleTest integration:
- The project contains an optional `phys_engine_tests.cpp` (GoogleTest) which requires a matching GTest build; enable this in a clean build by adding `-DBUILD_TESTS=ON` to `cmake`.
- If you encounter undefined reference errors linking against a prebuilt `libgtest` (ABI mismatch), prefer using the CI-less tests or build GTest from source against your compiler.

Troubleshooting common failures:
- "undefined reference" during link: ensure all device .cpp files are listed in `backend/include/CMakeLists.cmake` and `core` target links `pthread`.
- Tests that rely on files under `shared/protocol`: ensure the repository has `PartsLibrary.json` and the `shared/protocol` folder is readable/writable by the test process.
