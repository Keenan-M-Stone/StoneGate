# Tools README

This folder contains small developer utilities and examples for working with the StoneGate project. 
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

The QEC stub is a simple Flask app at `backend/qec_stub.py`. Run it locally to accept job submissions from the example client:

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
- If the client POSTs but then cannot fetch results, check that the Flask stub is running and that your `qec_client` is pointed to the correct base URL (e.g., `http://127.0.0.1:5001`).
- If you see segmentation faults in `qec_client`, rebuild after cleaning: `rm -rf build && mkdir build && cmake .. && cmake --build .` and ensure libraries are up-to-date.

**Next steps / enhancements**
- Add a small integration test that starts the Flask stub and runs the client automatically (can be a simple Bash script using background processes).
- Add TLS support and a configurable timeout/retry strategy to `qec_client` for more realistic usage.

---

If you want, I can add the `supervisord` file to `tools/` or create a tiny integration script that runs the stub, waits for health, then runs the client and prints the result. Which would you prefer?
