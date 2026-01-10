# StoneGate toolbox (Python)

Minimal request/response client for the StoneGate WebSocket toolbox RPC.

## Install

```bash
cd tools/toolbox_python
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -U pip
pip install -e .
```

## Usage

```bash
# list devices
stonegate-toolbox --ws ws://localhost:8080/status devices.list

# poll measurements
stonegate-toolbox --ws ws://localhost:8080/status devices.poll

# send a device action (example)
stonegate-toolbox --ws ws://localhost:8080/status device.action sim_ln2 '{"set":{"flow_rate_Lmin":2.5}}'

# For notebooks/scripts, prefer the shared helpers in `stonegate_api.py` (and `stonegate_qec.py` for QEC utilities).
```
