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

### Python client

```bash
cd tools/toolbox_python
python3 -m venv .venv
. .venv/bin/activate
pip install -e .

stonegate-toolbox --ws ws://localhost:8080/status devices.list
stonegate-toolbox --ws ws://localhost:8080/status devices.poll
stonegate-toolbox --ws ws://localhost:8080/status device.action sim_ln2 '{"set_flow_rate": 2.5}'

# Start a recording (JSON array of streams)
stonegate-toolbox --ws ws://localhost:8080/status record.start \
  '[{"device_id":"sim_ln2","metrics":["temperature_K","flow_rate_Lmin"],"rate_hz":2.0}]' \
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
./tools/build/toolbox_ws_client ws://localhost:8080/status device.action '{"device_id":"sim_ln2","action":{"set_flow_rate":2.5}}'
```
