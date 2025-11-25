# StoneGate Software Specifications

Version: 0.1  
Date:    2025-11-21  
Author:  StoneGate Team  

This document is a reference specification for the StoneGate monitoring and control software.
It describes UI dialog behavior, allowed inputs for controls, the physics and control calculations used,
supported error correction algorithms and their adaptation logic, relevant hardware tolerances,
and the catalogued error messages (with numbered ranges and cause/action guidance).

Plans for future revisions will likely refactor code into a base code for generic instrumentation
control and separate tool-kits for managing and interacting with various systems. At present,
specific implementations for quantum architecture are combined with the overall software.

## Prerequisites

- C++ toolchain (GCC/Clang/MSVC) and CMake for building the backend and tools
- `libcurl` development headers (e.g. `libcurl4-openssl-dev`) to build the C++ QEC client example
- `nlohmann::json` header (packaged as `nlohmann-json3-dev` on Debian/Ubuntu) for JSON parsing in C++
- Python 3 with `flask` (and optionally `jsonschema`) to run the QEC prototype stub

## Contents

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

StoneGate is a modular monitoring and control framework packaged with
code for simulating and interacting with silicon-photonic single-photon-qubit experiments.  
The software is separated into:

- Frontend (React): schematic editor, device panels, diagnostics dialogs, build-mode UI
- Backend (C++): device registry, drivers, simulator, physics engine, WebSocket server
- QEC service (prototype Flask): QEC job submission and parts/device override management
  (See `StoneGate/tools/`)

This specification documents user-facing behavior (dialogs), the allowed inputs and validation rules,
the control calculations used by backend and frontend decision logic, and detailed error messages (Cause/Action).

## Dialog behavior (UI)

Each dialog in the frontend should adhere to these guidelines.
Dialog titles, primary action, cancel action, and expected lifecycle are listed.

1) **Device Properties Dialog**
   - Purpose:  
     Inspect and edit per-device parameters (setpoints, tolerances, capture windows).
   - Open:  
     From device node context menu or device panel "Edit Properties" action.
   - Fields displayed:
     - Device ID:  
       Read-only string (unique identifier)
     - Device Type:  
       Read-only string
     - Part:  
       Dropdown of available parts (builtin + user).  
       Selecting a builtin part will show a small warning:  
       "Editing a builtin part will require Save-As-New to persist changes."  
       (Confirm to continue editing.)
     - Setpoint:  
       Numeric input (units depend on device, e.g., K or C).  
       Must meet `min <= value <= max` per the selected part's `specs.range` or the device default.
     - Tolerance (absolute or percent):  
       Numeric input; backend expects a positive value;
       UI allows choosing between `absolute` and `percent` mode.
     - Capture Window:  
       Two numeric inputs `start_ms` and `duration_ms`.  
       Start must be >= 0, duration > 0 and <= 1e6 (1e6 ms = 1000s) by default.
     - Sampling Rate:  
       Dropdown or numeric input (Hz); allowed values depend on device capabilities
       (for simulated devices, see `ComponentSchema.json` properties).  
       By default sampling rate must be in `[1e-4, 1e4]` Hz.
     - Advanced:  
       JSON editor for per-device `overrides` (validated by schema `DeviceOverrideSchema.json` on save).
   - Actions:
     - Save:  
       If editing a builtin part, prompt to Save-As-New.  
       If user agrees and supplies `new_name`, call `/api/parts/save` with `save_as_new=true`.
     - Cancel:  
       Revert changes in UI.  
       A confirmation appears if unsaved edits are present.
     - Reset to Default:  
       Only enabled if a user part exists for the part name or a device override exists;
       calls `/api/parts/reset` or `/api/device_overrides/reset`.
   - Validation rules:  
     - Fields must pass client-side validation before enabling `Save`.
     - The JSON editor must be valid JSON and match the `DeviceOverrideSchema.json` (if available);
       server-side validation will also run.

1) **Build Mode / Parts Browser Dialog**
   - Purpose: Browse PartsLibrary and user parts, drag parts onto nodes in the schematic, and create new parts.
   - Behavior:
     - Left pane: part categories + search filter (text contains search across name and specs values).
     - Clicking a part opens a preview right pane showing `specs`, `datasheet_url`, and recommended tolerance ranges.
     - Dragging a part onto a node sets that node's `part` field in the `DeviceGraph`
       (local edit, not persisted until user clicks `Persist Graph`).
     - Editing a builtin part: opening the part in an editor shows a banner:  
       "Builtin part — to persist edits, use Save As New."
       The `Save` button is disabled until user toggles `Save as new` and provides a unique name.
     - Persist Graph: writes the `DeviceGraph.json` draft into a workspace copy and optionally sends device override
       entries via `/api/device_overrides/save`.

1) **Manual Control Dialog**
   - Purpose: Provide direct manual controls for a device (e.g., set LN2 flow_rate, zero sensors, trigger pulse sequences).
   - Behavior:
     - Displays a set of controls mapped from device `actions` (as defined in `ComponentSchema.json`).
     - Actions are guarded:  
       If a control could lead to unsafe state (as defined by the device `specs.safety` flags),
       a confirmation modal is presented describing the risk.
     - Manual control requests are sent via WebSocket control messages:  
       `{"type":"control","device_id":"<id>","action":{...}}`
     - The server responds with an acknowledgement message (over WebSocket) with the same `device_id`
       and a status field `ack: accepted|rejected|error`.

1) **Diagnostics / QEC Submission Dialog**
   - Purpose: Select measurement windows and submit data to QEC service.
   - Behavior:
     - User selects devices and time-range (or capture windows) using present measurement history.
     - Client performs basic sanity checks:  
       At least one device selected, time-range non-empty, sampling rate meets QEC service limits
       (e.g., minimum sampling > 1 Hz if required by the chosen QEC algorithm).
     - On submit, a `POST /api/qec/submit` with the JSON payload matching `QECRequest.json` is performed.
       UI shows job progress using `GET /api/qec/status/<job_id>` and retrieves result via `GET /api/qec/result/<job_id>`.

## Frontend Interaction Details

  This section documents concrete UX affordances and expected behaviors for interactive operations in the frontend schematic.

  1) Opening device dialogs (control / properties / manual actions)
     - How to open:  
       - Single-click a node:  
         Selects it and highlights the node frame.
         Selection exposes a small inline toolbar with quick actions (Inspect, Manual, Actions).
       - Double-click a node:  
         Opens the **Device Properties Dialog** for that device (same as Inspect).
       - Right-click a node:  
         Shows a context menu with entries.  
         `Inspect Properties`, `Manual Control`, `Open Measurement History`, `Pin/Unpin Panel`
       - From the global Devices panel (left or right side, depending on layout):  
         Click a device entry and choose `Edit` or `Control` to open the dialogs.

     - What each action opens:
       - `Inspect Properties` or double-click:  
         Opens **Device Properties Dialog** (see Dialog behavior section).
         This dialog allows editing setpoints, choosing part, and editing overrides.
       - `Manual Control`:  
         Opens the **Manual Control Dialog** which maps device actions (buttons, sliders) to WebSocket control messages
         as described in the manual control portion of the spec (if I get that far).
       - `Open Measurement History`:  
         Opens a small time-series viewer for the selected device (timeseries panel) from which the user can select capture windows.

  1) Entering Build Mode and the Build-mode controls
     - How to enter Build Mode:
       - Click the `Build` toggle button in the top-right toolbar (hammer/wrench icon),
         or press the `B` keyboard shortcut.
       - When active, the schematic UI enters an edit-oriented state;
         selection interaction changes from live-preview to drag/drop and part placement.

     - Build-mode UI elements (what each control/icon does):
       - **Parts Browser (panel icon / left rail)**: opens the Parts Browser showing builtin and user parts.
         Click a part to preview; drag a part onto a node to assign it locally.
       - **Search bar**: filters parts by name, type, and specs values.
       - **Preview Pane**: shows selected part `specs`, `datasheet_url` and recommended tolerances.
       - **Drag Handle**: when dragging a part over the schematic, valid drop targets highlight.
          Dropping assigns the `part` field in the local DeviceGraph (not persisted until `Persist Graph`).
       - **Persist Graph (disk/save icon)**: writes the edited `DeviceGraph.json` to the workspace draft
         and optionally writes any per-device overrides to `device_overrides.json` when the user checks `Persist overrides`.
       - **Undo / Redo (curved arrows)**: undo/redo local graph edits (supports at least 20 steps).
       - **Delete / Remove Part (trash icon)**: clears the `part` field from the selected node (local only).
       - **Save Part As New (floppy + asterisk while editing builtin)**: when editing a builtin part, Save is disabled;
         `Save As New` must be used to persist a copy into user parts.

     - Expected interactions on click:
       - Clicking a part preview sets the preview pane; double-clicking a part will auto-assign it to
         the currently selected node (if any) and show a success banner.
       - Clicking `Persist Graph` triggers a confirmation modal that lists what files will be written
         (DeviceGraph draft path and device_overrides.json if selected).
         The server responds with success/failure and a short log on completion.

  1) Where the port connection is displayed in the frontend
     - Primary location:  
       The application header (top bar) displays connection status and backend endpoint.
       - The header contains `Backend status: Connected`/`Disconnected` plus a small tooltip showing the WebSocket URL
         (e.g., `ws://localhost:9001/status`).
       - Clicking the status opens the **Connection Panel** which shows:  
         `Endpoint URL`, `Last Connected`, `Messages Sent`, `Messages Received`, and `Reconnect Policy` (toggle auto-reconnect).

     - Secondary location:  
       The footer (status bar) shows a compact endpoint string and the current client ID used for the WebSocket session.
       This information is useful when multiple backends are used.

     - How to change the displayed port/endpoint:
       - During development:  
         Edit `frontend/.env` or set `VITE_BACKEND_WS_URL` in the shell before launching the dev server.
       - In production:  
         The settings panel exposes an editable endpoint field that persists to localStorage for the current user.

  1) Creating a macro for complex actions (recording, triggers, stabilization criteria)
     - Macro Editor entry points:
       - Toolbar macro icon (gear + play), context menu on a node:  
         `Create Macro`, or the `Macros` panel in the left rail.

     - Macro creation workflow (UI steps):
       1. **Create New Macro**  
          Click `New Macro`, give it a `name`, optional `description`, and choose `recording mode` or `script mode`.
       2. **Record Mode** (recommended for novice users)  
          Press `Record`, then interact with the schematic controls
          (perform actions such as `set LN2 flow`, `trigger pulse`, `apply offset`).
          The UI records a time-stamped sequence of control messages and device actions.
       3. **Script Mode** (advanced)  
          Author a sequence of steps using the visual step editor. Each step contains:
          - `action`:  
            A WebSocket control message or client-side helper (e.g., wait, wait_for_measurement).
          - `target_device(s)`:  
            Device IDs or sets (by label or query).
          - `parameters`:  
            Action parameters (e.g., `flow_rate_Lmin: 2.5`).
          - `timeout`:  
            Maximum time to allow the action to complete.
          - `on_error`:  
            `abort|continue|retry` policy.
       4. **Add a Trigger / Stabilization Condition**  
          For steps that require observing a stable measurement, add a `stability` block:
          - `monitored_devices`:  
             List of device ids (or named device sets)
          - `metrics`:  
             List of measurement keys (e.g., `temperature_K`, `counts`)
          - `tolerance`:  
             Value and mode (`absolute` or `percent`)
          - `window_ms`:  
            The moving window duration over which stability is evaluated
          - `consecutive_periods`:  
            How many successive windows must satisfy the condition
          - semantics:  
            The macro engine computes the metric over the moving window and considers it `stable`
            if the metric's standard deviation <= `tolerance` (or the relative change <= percent tolerance)
            for the configured `consecutive_periods`.
       5. **Preview & Validate**  
          Run a dry-run validation (static checks) that ensures device IDs exist, actions map to known commands,
          and stability checks reference valid measurement keys.
       6. **Save / Schedule**  
          Save the macro into `macros.json` (user-level) and optionally schedule it to run immediately or at a later time.

     - Execution semantics:
       - The macro runner sends control messages in order. When a step contains a stability condition it will poll
         the measurement stream (client-side cache) and evaluate the stability predicate. If the predicate is satisfied,
         the macro proceeds; otherwise it waits up to the `timeout` and then follows the `on_error` policy.
       - Macros are executed client-side (fast response) but can authorize long-running sequences
         by delegating heavy tasks to the backend via a `macro-run` WebSocket control message which
         the backend can accept and orchestrate.

     - Example macro (pseudocode):
       - Name: `Tune LN2 until Detector Stabilizes`
       - Steps:
         1. Set `LN2Controller.flow_rate_Lmin` to `2.0`
         2. Wait for `det0.temperature` and `det0.counts` to stabilize to `±0.5 K` and `±5 counts` respectively for `3` consecutive `5s` windows
         3. If stable, record measurement snapshot and finish; else rollback `LN2Controller.flow_rate_Lmin` to `1.0` and mark macro as `failed`.

### Side Menu & Macro UI

- A collapsible side menu (left rail) exposes developer controls: `Build Mode` toggle and `Show Macros` checkbox.
 When the menu is collapsed only the rail icon remains; expanding shows the toggles.
- The Macro UI now supports two workflows:
  event recording (click-based quick macros persisted to localStorage) and script macros (loaded from `/macros.json` in the frontend).
  Script macros can be run from the UI and perform control actions (e.g., set LN2 flow) and wait-for-stability checks using the
  client-side device cache.
- The `run` action for script macros sends control messages over WebSocket
  (shape: `{"type":"control","cmd":"action","device_id":"<id>","action":{...}}`) and evaluates stability conditions
  by sampling the `useDeviceStore` values.

### Component Dialog — Detailed Controls

This section documents the full set of controls and subdialogs available in the device Component Dialog
(the dialog opened by double-clicking a schematic node in normal operation mode).
It expands the earlier description with exact behaviors and persistence points.

- Plot tab
  - Realtime trend plot of the selected metric for the device (default metric chosen from available measurements).
    The plot shows a continuous history over the configured time window and updates at the configured refresh rate.
  - Plot options:
    `Grid` (on/off), `Color` (hex picker), `Log X` and `Log Y` toggles.
    These are stored in the browser `localStorage` and persist across dialog instances.
  - Time range:
    Numeric input (seconds) to choose how many seconds to display in the plot.
    Changing the time range immediately updates the visible data and is persisted when the dialog is closed with `OK` in the Settings tab.
  - Refresh rate:
    Numeric input (Hz) controlling both the plot redraw frequency and the sampling/update cadence for the
    dialog's derived displays (statistics, back/forward stepping).
    This value is validated to be in a reasonable range (0.1 Hz — 100 Hz) in the UI.
  - Pause / Play:
    When paused, the plot stops redrawing but the history buffer continues to accumulate samples in the background.
    The pause action captures the current wall-clock timestamp as the 'pause frame'.
  - Back / Forward:
    When paused, Back moves the displayed window backwards by approximately one refresh step (i.e., `1/refresh_rate` seconds)
    up to one full time window backwards; Forward advances toward the last captured frame.
    When resumed (Play), the display jumps back to live view.
  - Zero button:
    Sends a `zero` control action to the device (`{"type":"control","cmd":"action","device_id":"<id>","action":{"zero":true}}`).
    The server acknowledges via control/ack semantics when implemented.
  - Set button:
    Opens a small JSON editor prompt (or configurable form if schema-driven UI is available) to enter parameter values;
    on OK, sends `set` control as `{"type":"control","cmd":"action","device_id":"<id>","action":{"set":{...}}}`.
    Input is validated client-side for syntactic correctness before sending.
  - Record CSV:
    Opens a small subdialog to enter `duration_seconds` and optional `filename` and `path`
    (path works as a suggestion for server-side saving; in the browser environment the CSV is downloaded to the client downloads folder).
    By default the filename is `<device_id>_<ISO timestamp>.csv` and the CSV contains one row per refresh-step with columns for timestamp
    and each numeric metric.

- Settings tab
  - OK / Cancel: applies persistent settings (time range, refresh rate, plot color, grid) on OK and discards on Cancel.
  - Per-device persistence:
    When OK is selected settings are saved under a localStorage key that includes the device id so different devices
    can have different default plot parameters.

- Stats tab
  - Shows computed statistics for the selected window:
    Mean, Median, Mode, Standard Deviation, and approximate first-derivative (finite-difference mean).
    These values are recomputed at the refresh rate and are displayed as numeric readouts and small sparklines where space permits.
  - The tab also exposes an `Export Statistics` button which saves current window statistics as a small JSON blob
    or CSV line for offline analysis.

- JSON tab
  - Shows a read-only, scrollable JSON view of the device's current status/measurements and descriptor.
    This is for advanced inspection — common operations are in the other tabs.

- Record subdialog details
  - The Record subdialog allows specifying `duration_seconds` and a storage method:
    `Download` (browser download), or `Server` (POST to backend `/api/recordings` endpoint — only available when backend supports it).
    When `Server` is chosen the dialog requests a `path` on the server where to save and returns an upload acknowledgement from the server;
    the server is responsible for writing the CSV and returning a URL or path.
  - The CSV file includes a timestamp column (ISO8601) and numeric columns for every metric produced by the device at each sample.
    Non-numeric measurements are left empty.

- Control safety and confirmations
  - For controls that could create unsafe states (e.g., setting flow rates above `specs.max_flow_rate`),
    the dialog displays a confirmation modal explaining the risk and requiring the user to type a confirm string
    (e.g., the device id) before sending the command.

#### Implementation notes

- The dialog uses the client-side `History` store (in-memory circular buffer) for plotting and statistics;  
  the backend continues to collect live samples regardless of whether the dialog is open
  (the graph only displays what is available in the history buffer).  
  The default buffer length supports multiple minutes of samples at modest refresh rates; this can be increased if desired.
- The `zero` and `set` controls emit WebSocket control messages.
  The backend should implement `handle_control` to apply these to either simulated devices or actual drivers.
  For the LN2 controller, the device implementation echoes setpoints and updates the PhysicsEngine controller
  state immediately so downstream simulated devices (e.g., thermocouples) will reflect the change.

## Acceptable UI entries and validation rules

This section enumerates, per control type, the allowed formats and acceptable ranges.

- Text fields (identifiers): ASCII printable characters, max 128 characters, no leading/trailing whitespace.  
  IDs must match regex `^[A-Za-z0-9_\-:.]+$`.
- Numeric fields:
  - Integers: within the device-specified `min`/`max` if present. Otherwise 64-bit signed integer bounds.
  - Floating point: double precision; enforce `min <= value <= max` where provided. Tolerance percentages must be in `[0,100]`.
  - Units: UI enforces units per device (e.g., temperature in `K` or `C`).
    Conversion functions must be applied consistently; display uses device-specified unit in `ComponentSchema`.
- Dropdowns: must select a value from provided options; unknown/empty selections should be rejected.
- JSON editor fields: must be valid JSON. For parts and overrides, the JSON schema used is:
  - `PartSchema.json` — describes a part entry (type, specs, datasheet_url)
  - `DeviceOverrideSchema.json` — describes per-device overrides (e.g., `specs` partial overrides)
- File uploads (datasheets): must be PDF files under 5MB unless server config overrides.

Validation is performed client-side for responsiveness, with server-side canonical validation in `qec_stub.py`
(if `jsonschema` available) and in the C++ backend where applicable.

## Control-system calculations and equations

This section documents the formulas used in the demo `PhysicsEngine` and the control heuristics used in the frontend decision engine.
These are intended as reference; production control systems should replace toy models with physical models and robust controllers.

### 1. Temperature propagation model (simple demo model implemented)

Per-node base setpoint (from `specs.setpoint_default`) is used as the un-cooled base temperature, $T_0$.

Any connected LN2 controller contributes a cooling delta proportional to its flow rate:
$$
\Delta T = -\alpha \cdot F
$$

where $\alpha$ is a coupling coefficient (demo uses $\alpha = 0.5 \, \frac{K}{L/min}$ for directly-connected links)
and $F$ is the flow in $L/min$. [[1]](#citations)

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

Map to operational choices (higher redundancy if SNR $<$ threshold). [[2]](#citations)

---

### 3. QEC decision mapping (heuristic)

Map measurement noise metrics to QEC choices. Example mapping:

- If thermal noise estimated (via $\text{noise\_coeff}$ adjusted by temperature delta) $> 0.1$ $\implies$
  choose more frequent syndrome rounds and stronger decoding (e.g., higher-distance surface code variant).
- If photon loss rate $> 5\%$ $\implies$ prefer repetition code or increase measurement redundancy.

See: [[3]](#citations), [[4]](#citations) in [Citations](#citations)

---

## Supported error-correction algorithms and adaptation logic

The software's QEC module is a pluggable stub. The framework supports integrating external decoders. Presently the prototype supports:

- Repetition code (simple majority voting over repeated measurements)
- Surface code (stub interface; real decoder integration expected via plugin)

### Adaptation rules (how to choose or parameterize a decoder)

- Based on device-measured metrics
  (per-device noise_coeff, temperatures, photon loss rates, detector dark counts, etc.),
  map to decoder parameters (code distance, syndrome sampling rate, decoder time budget, etc.).
- Example rule (illustrative):
  - If average detector 
    `noise_coeff * temperature_ratio` > 0.2 -> increase syndrome sampling by factor 2 and select decoder
    with `max_edge_weight` lowered to increase sensitivity.

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

### General rules

- The frontend should not allow user-configured sampling rates exceeding the device's `specs.max_sampling_rate` when present.
- Tolerances used in the UI are per-part; if unspecified, the UI uses conservative defaults:  
  Precision 0.05 relative, absolute tolerance based on typical device class.

---

## Citations

<span id="citations"></span>

**[1]** C. Kittel and H. Kroemer, "Thermal Physics"; Y. Ozisik, "Heat Conduction"; [Wikipedia: Heat Equation](https://en.wikipedia.org/wiki/Heat_equation)

**[2]** S. M. Kay, "Fundamentals of Statistical Signal Processing" (Estimation Theory); R. G. Gallager, "Principles of Digital Communication"

**[3]** A. G. Fowler et al., "Surface codes: Towards practical large-scale quantum computation", arXiv:1208.0928 ([arXiv link](https://arxiv.org/abs/1208.0928))

**[4]** M. Nielsen & I. Chuang, "Quantum Computation and Quantum Information"; D. A. Lidar and T. A. Brun (eds.), "Quantum Error Correction" (Cambridge University Press)

---

## Error messages catalog

### Numbering scheme (high level)

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

### Each entry: Error code, message form, cause(s), action(s)

#### 1000-1099 — UI validation errors

- Error 1000: "Error 1000: Invalid identifier for %s — must match ^[A-Za-z0-9_\-:.]+$ and be <=128 chars."
  - Cause: User entered an ID with disallowed characters or too long.
  - Action: Edit the identifier to conform; UI highlights the offending characters.

- Error 1010: "Error 1010: Numeric field '%s' out of range [%s, %s]."
  - Cause: Entered value outside the acceptable range for the control.
  - Action: Enter a value within the displayed min/max; consult device specs.

#### 1100-1199 — Build-mode / parts browser errors

- Error 1100: "Error 1100: Cannot overwrite builtin part '%s' without Save-As-New."
  - Cause: Attempt to save a modified part with an existing builtin name without `save_as_new`.
  - Action: Use Save-As-New and supply a new unique name.

#### 2000-2199 — Device read & status errors

- Error 2000: "Error 2000: Failed to read device '%s' — I/O error: %s".
  - Cause: Driver failed to communicate (USB/ETH timeouts, disconnected device).
  - Action: Check connections, restart device, check OS-level device drivers.

- Error 2010: "Error 2010: Device '%s' measurement out of expected range: %s +/- %s".
  - Cause: Sensor reporting values outside configured ranges.
  - Action: Verify sensor calibration, check ambient conditions, consider setting a wider tolerance or zeroing device.

- Error 2020: "Error 2020: Device '%s' not responding for %d seconds".
  - Cause: Driver busy, process stuck, or hardware fault.
  - Action: Attempt device reset (`Perform Action -> reset`), power-cycle hardware if safe.

#### 2200-2299 — Parts library / overrides errors

- Error 2200: "Error 2200: Parts library load failed: %s".
  - Cause: Missing or invalid `PartsLibrary.json`.
  - Action: Restore the file from repository, or use the API to re-upload/repair.

- Error 2210: "Error 2210: Failed to save user part '%s': %s".
  - Cause: File write permissions, malformed part spec.
  - Action: Ensure server has write permissions to `shared/protocol/user_parts.json`; validate JSON schema.

- Error 2220: "Error 2220: Device override '%s' invalid: %s".
  - Cause: Override JSON fails schema validation.
  - Action: Review the override JSON; use the UI JSON editor which validates before save.

#### 2300-2399 — PhysicsEngine & simulation errors

- Error 2300: "Error 2300: PhysicsEngine compute failure: %s".
  - Cause: Unexpected exception during compute (bad numeric values, malformed specs).
  - Action: Inspect logs, check parts/overrides for NaN/invalid numbers.

- Error 2310: "Error 2310: Override reload failed for file '%s'".
  - Cause: File read error, malformed JSON.
  - Action: Use `/api/device_overrides/reload` to re-touch and check server logs; fix JSON syntax.

- Error 2320: "Error 2320: Incompatible unit conversion for device '%s' property '%s'".
  - Cause: Mismatch between parts library unit and device property unit.
  - Action: Ensure `ComponentSchema.json` and parts specify consistent units; apply conversions.

#### 2400-2499 — WebSocket / control channel errors

- Error 2400: "Error 2400: Control message rejected: %s".
  - Cause: Malformed control message or unsupported action.
  - Action: Verify control message format matches DescriptorProtocol (see protocol docs).

- Error 2410: "Error 2410: WebSocket session dropped unexpectedly".
  - Cause: Network interruption, client closed socket.
  - Action: Reconnect client; check server socket limits.

#### 3000-3199 — QEC service errors

- Error 3000: "Error 3000: QEC submit failed — bad request: %s".
  - Cause: Submitted measurement payload missing required fields.
  - Action: Validate request against `QECRequest.json` schema and re-submit.

- Error 3100: "Error 3100: QEC job %s failed during decoding: %s".
  - Cause: Decoder exception or out-of-resources.
  - Action: Retry with smaller batch or check QEC backend logs.

---

### Appendices

#### Simulator & Physics Engine design notes

- The `Simulator` loads `DeviceGraph.json` and `ComponentSchema.json`.
  For each node it selects a part spec (builtin or user part) and registers nodes/edges with `PhysicsEngine`.
- `PhysicsEngine` maintains controller states and recomputes derived properties on a timed background loop (configurable interval).
  A cached snapshot is provided to simulated devices via `get_cached_step()`.
- Device overrides are read from `shared/protocol/device_overrides.json` and deep-merged into part specs for computation.

#### WebSocket control RPCs

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

#### Server-side handling

- The `WebSocketServer` exposes a `handle_control(json)` method which should be invoked when a control message arrives.
  In the demo implementation a small stdin control thread calls this method for development.

---

## Final notes

This document is intended to be a living specification. As the project evolves, please update this file to reflect current behavior, any additional dialog variants, and newly integrated decoders or hardware models.

For questions or clarifications, open an issue in the repository or ask the development lead.

## Running the Unit Tests

This project includes several CI-less (framework-free) test binaries and optional GoogleTest cases.
The CI-less tests are intended to run without relying on external test frameworks and are suitable for quick local validation.

### Files and purposes

- `phys_engine_citest`: exercises `PhysicsEngine` loading, override merging, background loop, and cached snapshot behavior.
  - Expected run time: ~0.2 - 0.5s
  - Common issues: missing CMake/compilers (install `cmake`, `build-essential`);
    failure to load parts/overrides files — ensure `shared/protocol` contains `PartsLibrary.json` or that temporary files can be written.
- `devices_citest`: exercises basic device descriptors and `read_measurement()` for core devices
  (`Thermocouple`, `PhotonicDetector`, `LN2CoolingController`).
  - Expected run time: ~0.05 - 0.2s
  - Common issues: missing device source in CMake (re-run CMake), RNG seeding differences (non-deterministic values are OK), missing includes.
- `simulator_citest`: loads a small `DeviceGraph` into `Simulator` and checks registry descriptors and a sample poll.
  - Expected run time: ~0.1 - 0.5s
  - Common issues: `ComponentSchema.json` or `PartsLibrary.json` absent in the same folder as the provided graph;
    permission issues writing temp files.

### How to run all tests

Build first:

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

#### Notes on GoogleTest integration

- The project contains an optional `phys_engine_tests.cpp` (GoogleTest) which requires a matching GTest build;
  enable this in a clean build by adding `-DBUILD_TESTS=ON` to `cmake`.
- If you encounter undefined reference errors linking against a prebuilt `libgtest` (ABI mismatch),
  prefer using the CI-less tests or build GTest from source against your compiler.

#### Troubleshooting common failures

- "undefined reference" during link: ensure all device .cpp files are listed in
  `backend/include/CMakeLists.cmake` and `core` target links `pthread`.
- Tests that rely on files under `shared/protocol`: ensure the repository has
  `PartsLibrary.json` and the `shared/protocol` folder is readable/writable by the test process.
