# Live Transforms — C++ QEC Health server

This example provides a small HTTP service written in C++ that talks to the StoneGate backend via the **generated C++ SDK headers** (`stonegate_api.hpp` + `stonegate_qec.hpp`).

It’s designed to be used from the **Live Transforms** page as an *External API*.

## What it does

`/analyze/qec_health` polls StoneGate (JSON-RPC over WebSocket) and returns a compact, monitoring-focused summary:

- `p_flip` (from `syn0.p_flip` or `qec0.p_flip`)
- `syndrome_bit` (from `syn0.syndrome_bit` or `qec0.syndrome`)
- `leakage_fraction` (from `leak0.leakage_fraction`)
- `health_score` in `[0,1]` plus a `recommendation`
- Optional `benchmark` results via `qec.benchmark` (repetition code)

## Build

### Option A: CMake

```bash
cd tools/live-transform-demo/cpp
cmake -S . -B build
cmake --build build -j
```

### Option B: g++ (quick)

You may need `libboost-system-dev` and `nlohmann-json3-dev` installed.

```bash
g++ -std=c++17 -O2 -pthread \
  -I../../sdk_sources \
  qec_health_server.cpp \
  -lboost_system \
  -o stonegate_qec_health_server
```

## Run

```bash
./build/stonegate_qec_health_server --port 8770 --ws ws://localhost:8080/status
# or (g++ build)
./stonegate_qec_health_server --port 8770 --ws ws://localhost:8080/status
```

Quick check:

```bash
curl -s http://127.0.0.1:8770/health | jq
```

## Live Transforms usage

- Start StoneGate backend.
- Start this server.
- In the Live Transforms page, set **External API** to `http://127.0.0.1:8770`
- Select script **QEC health (C++ + stonegate_qec)**.
