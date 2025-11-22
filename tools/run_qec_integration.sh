#!/usr/bin/env bash
set -euo pipefail

# Simple integration script:
#  - starts the Python QEC stub in background
#  - waits for HTTP health (/api/parts) to return 200
#  - runs the C++ qec_client against the stub
#  - captures logs and tears down the stub

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STUB_LOG="/tmp/qec_stub.log"
CLIENT_BIN="$ROOT_DIR/tools/build/qec_client"
BASE_URL="http://127.0.0.1:5001"

if [[ ! -x "$CLIENT_BIN" ]]; then
  echo "qec_client binary not found or not executable: $CLIENT_BIN"
  echo "Try: (from repo root) cd tools && mkdir -p build && cd build && cmake .. && cmake --build . --target qec_client"
  exit 2
fi

echo "Starting QEC stub... (logs -> $STUB_LOG)"
cd "$ROOT_DIR/backend"
nohup python3 qec_stub.py > "$STUB_LOG" 2>&1 &
STUB_PID=$!
echo "Stub PID=$STUB_PID"

cleanup() {
  echo "Stopping stub PID=$STUB_PID"
  if kill -0 "$STUB_PID" 2>/dev/null; then
    kill "$STUB_PID" || true
    wait "$STUB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "Waiting for stub health (timeout 30s)..."
SECS=0
while true; do
  if curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/parts" | grep -q "200"; then
    echo "Stub healthy"
    break
  fi
  sleep 1
  SECS=$((SECS+1))
  if [[ $SECS -ge 30 ]]; then
    echo "Timed out waiting for stub health. See $STUB_LOG"
    exit 3
  fi
done

echo "Running client against $BASE_URL"
set +e
"$CLIENT_BIN" "$BASE_URL" > /tmp/qec_client.out 2>&1
CLIENT_EXIT=$?
set -e

echo "=== qec_client stdout/stderr ==="
cat /tmp/qec_client.out || true

echo "=== qec_stub recent log ==="
tail -n 200 "$STUB_LOG" || true

echo "Client exit code: $CLIENT_EXIT"
if [[ $CLIENT_EXIT -ne 0 ]]; then
  echo "Integration test FAILED"
  exit $CLIENT_EXIT
fi

echo "Integration test PASSED"
exit 0
