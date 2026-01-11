# Tooling (Tools README)

The `tools` directory contains small developer utilities and examples for working with the StoneGate project. 
The primary example here is `qec_client`, a minimal C++ client that demonstrates submitting a QEC job to the development Flask stub (`backend/qec_stub.py`), polling status, and fetching results.

**Prerequisites**
- `cmake` (3.16+)
- A C++17 compiler (`g++` or `clang`)
- `libcurl` development headers (Debian/Ubuntu: `libcurl4-openssl-dev`)
- `nlohmann::json` header (Debian/Ubuntu: `nlohmann-json3-dev`) — optional but recommended for CMake

**Build (CMake)**

```bash
cd tools
mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Debug
cmake --build . --target qec_client -- -j$(nproc)
```

If you don't want to use CMake, you can compile the single-file example directly (ensure `libcurl` headers are on your include path):

```bash
g++ -std=c++17 -O2 -I../backend/include -o qec_client ../tools/qec_client.cpp -lcurl
```

**Run the QEC stub (development)**

The QEC stub is a simple Flask app at `backend/qec_stub.py`.
Run it locally to accept job submissions from the example client:

```bash
cd backend
python3 -m pip install --user flask jsonschema
python3 qec_stub.py
# or run detached
nohup python3 qec_stub.py > /tmp/qec_stub.log 2>&1 &
```

Confirm the stub is responding:

```bash
curl -sS http://127.0.0.1:5001/api/parts | jq .
```

**Run the example client**

```bash
# from repo root
./tools/build/qec_client http://localhost:5001
```

**Example `systemd` unit (development use only)**

If you want the stub to run in the background and restart automatically, create a local unit file (for development only):

Create file: `~/.config/systemd/user/qec_stub.service`

```ini
[Unit]
Description=StoneGate QEC Stub (dev)

[Service]
Type=simple
WorkingDirectory=%h/dev/StoneGate/backend
ExecStart=/usr/bin/python3 qec_stub.py
Restart=on-failure

[Install]
WantedBy=default.target
```

Enable and start (user systemd):

```bash
systemctl --user daemon-reload
systemctl --user enable --now qec_stub.service
journalctl --user -u qec_stub.service -f
```

**Supervisord example**

If you prefer `supervisord`, here's a minimal `supervisord.conf` snippet:

```ini
[program:qec_stub]
command=/usr/bin/python3 /home/youruser/dev/StoneGate/backend/qec_stub.py
directory=/home/youruser/dev/StoneGate/backend
autostart=true
autorestart=true
stdout_logfile=/tmp/qec_stub.out
stderr_logfile=/tmp/qec_stub.err
```

**Troubleshooting**
- If `qec_client` fails to link: ensure `libcurl` dev package is installed and visible to the compiler and linker.
- If the client POSTs but then cannot fetch results, check that the Flask stub is running and that your `qec_client` 
  is pointed to the correct base URL (e.g., `http://127.0.0.1:5001`).
- If you see segmentation faults in `qec_client`, rebuild after cleaning: 
  `rm -rf build && mkdir build && cmake .. && cmake --build .` and ensure libraries are up-to-date.

---

## Toolbox RPC (WebSocket)

StoneGate also supports a small request/response RPC protocol over the existing WebSocket tunnel.
This is intended for toolboxes (Python and C++) to perform backend control operations and computations and receive results.

### Protocol

- **RPC request**

```json
{
  "type": "rpc",
  "id": "<client-generated id>",
  "method": "devices.list | devices.poll | device.action | qec.decode",
  "params": { }
}
```

- **RPC response**

```json
{
  "type": "rpc_result",
  "id": "<same id>",
  "ok": true,
  "result": { }
}
```

On error:

```json
{
  "type": "rpc_result",
  "id": "<same id>",
  "ok": false,
  "error": { "code": "bad_request", "message": "...", "details": {} }
}
```

The backend will also send non-RPC messages like `descriptor` (on connect) and `measurement_update` (periodic).

### Supported methods

- `devices.list` → `{ devices: [...] }` (descriptor snapshots)
- `devices.poll` → `{ updates: [...] }` (same shape as `measurement_update.updates`)
- `backend.info` → `{ port, git_commit, build_time }`
- `device.action` params: `{ device_id: string, action: object }`
- `record.start` params: `{ streams: [{ device_id, metrics: string[], rate_hz: number }...], script_name?: string, operator?: string, file_base?: string }`
- `record.stop` params: `{ recording_id: string }`
- `qec.decode` params: QECRequest-ish object; returns a deterministic, toy decode result (majority vote)
- `qec.benchmark` params: `{ code: "repetition"|"surface"|string, p_flip: number, rounds?: number, shots?: number, seed?: number, params?: object }`

### Simulator QEC tool devices

When running `./StoneGate --sim`, the simulator instantiates a canonical device graph from `shared/protocol/DeviceGraph.json`.
The following QEC-oriented tools appear as first-class devices and can be controlled via `device.action`:

- `syn0` (`SyndromeStream`): start/stop a synthetic syndrome stream
  - Actions: `start`, `stop`, `set_code_type`, `set_rate_hz`
- `noise0` (`NoiseSpectrometer`): synthesize a small spectral estimate
  - Actions: `set_band_hz`, `set_duration_s`, `run_scan`
- `rocal0` (`ReadoutCalibrator`): synthesize a readout histogram/threshold/SNR
  - Actions: `set_target_device`, `set_samples`, `calibrate`
- `fault0` (`FaultInjector`): runtime environment patching and device overrides (in-memory)
  - Actions: `set_env`, `override_device`, `clear_overrides`, `disable`, `set_notes`
- `leak0` (`LeakageResetController`): leakage fraction + reset attempt modeling
  - Actions: `set_target_device`, `set_leakage_fraction`, `attempt_reset`
- `surf0` (`SurfaceCodeController`): toy cycle counter + logical-error estimate
  - Actions: `configure` (e.g. `{distance}`), `run_cycles` (e.g. `{cycles}`), `stop`
- `surg0` (`LatticeSurgeryController`): operation selection + demo run
  - Actions: `set_operation`, `run_demo`

Example commands (C++ toolbox client):

```bash
# If 8080 is in use, run the simulator on an alternate port.
cd backend/build
./StoneGate --sim --port 8082

cd ../../
./tools/build/toolbox_ws_client ws://localhost:8082/status devices.list

# Start a syndrome stream.
./tools/build/toolbox_ws_client ws://localhost:8082/status device.action \
  '{"device_id":"syn0","action":{"set_code_type":"repetition","set_rate_hz":5,"start":true}}'

# Run a noise scan.
./tools/build/toolbox_ws_client ws://localhost:8082/status device.action \
  '{"device_id":"noise0","action":{"set_band_hz":2000,"set_duration_s":0.5,"run_scan":true}}'

# Apply a fault: raise temperature to increase p_flip.
./tools/build/toolbox_ws_client ws://localhost:8082/status device.action \
  '{"device_id":"fault0","action":{"set_env":{"temperature_K":150}}}'

# Benchmark repetition-code majority vote.
./tools/build/toolbox_ws_client ws://localhost:8082/status qec.benchmark \
  '{"code":"repetition","p_flip":0.15,"rounds":5,"shots":2000,"seed":123}'
```

### SDK generation (Python + C++)

The repo includes lightweight SDK helpers (used by Macro Wizard exports and tools):

- Python: `stonegate_api` and `stonegate_qec`
- C++: `stonegate_api.hpp` and `stonegate_qec.hpp`

These are kept as *source of truth* at repo root, and can be generated into installable/distributable artifacts under `sdk/`:

```bash
cd /path/to/StoneGate
python3 tools/generate_stonegate_sdk.py

# Python: editable install
python3 -m pip install -e sdk/python/stonegate_sdk
```

After that, notebooks/scripts should simply do:

```python
import stonegate_api as sg
import stonegate_qec as qec
```

For C++ consumers, the generator also writes `sdk/cpp/include/stonegate_api.hpp` and `sdk/cpp/include/stonegate_qec.hpp` with a minimal `CMakeLists.txt`.

### Leak check (simulator)

The simulator includes a pressure controller + sensor that can be used to run a simple leak-check procedure.

Run the backend simulator:

```bash
cd backend/build
./StoneGate --sim
```

Then run either:

```bash
# From repo root:
python3 tools/leak_check.py --ws ws://localhost:8080/status --target-kpa 40 --observe-s 60
```

Or open and run the notebook:

If you run notebooks from `tools/`, install the generated SDK first:

```bash
python3 tools/generate_stonegate_sdk.py
python3 -m pip install -e sdk/python/stonegate_sdk
```

- [tools/leak_check.ipynb](../tools/leak_check.ipynb)

### Python client

```bash
cd tools/toolbox_python
python3 -m venv .venv
. .venv/bin/activate
pip install -e .

stonegate-toolbox --ws ws://localhost:8080/status devices.list
stonegate-toolbox --ws ws://localhost:8080/status devices.poll
stonegate-toolbox --ws ws://localhost:8080/status device.action ln2 '{"set":{"flow_rate_Lmin":2.5}}'

# Start a recording (JSON array of streams)
stonegate-toolbox --ws ws://localhost:8080/status record.start \
  '[{"device_id":"ln2","metrics":["temperature_K","flow_rate_Lmin"],"rate_hz":2.0}]' \
  --script-name "My Macro" --operator "keenan" --file-base "my_macro"

# Stop a recording
stonegate-toolbox --ws ws://localhost:8080/status record.stop <recording_id>

# Load a recording JSONL from disk
stonegate-toolbox record.load shared/recordings/YYYY-MM-DD/<file>.jsonl
```

### C++ client

Build:

```bash
cd tools
mkdir -p build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . -- -j$(nproc)
```

Run:

```bash
./tools/build/toolbox_ws_client ws://localhost:8080/status devices.list
./tools/build/toolbox_ws_client ws://localhost:8080/status device.action '{"device_id":"ln2","action":{"set":{"flow_rate_Lmin":2.5}}}'
```
