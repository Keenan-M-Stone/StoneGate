from __future__ import annotations

"""StoneGate Live Transforms (Python) — example using stonegate_api.

This variant demonstrates using the StoneGate Python SDK helpers to fetch
measurements directly from the backend (JSON-RPC over WebSocket), instead of
having the browser send sample windows.

Prereqs:
- Generate + install the SDK (from repo root):
    python3 tools/generate_stonegate_sdk.py
    python3 -m pip install -e sdk/python/stonegate_sdk
- Install server deps:
    python3 -m pip install -r tools/live-transform-demo/python/requirements.txt

Run:
    python3 tools/live-transform-demo/python/bloch_server_stonegate_sdk.py

Then set External API to http://127.0.0.1:8766 and choose the matching script.
"""

import time
from typing import Optional

import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

try:
    import stonegate_api as sg  # type: ignore
except Exception as e:  # pragma: no cover
    raise SystemExit(
        "stonegate_api is not installed.\n"
        "From repo root, run:\n"
        "  python3 tools/generate_stonegate_sdk.py\n"
        "  python3 -m pip install -e sdk/python/stonegate_sdk\n\n"
        f"Original import error: {e}"
    )


def _clamp_unit(x: float) -> float:
    if not np.isfinite(x):
        return 0.0
    return float(max(-1.0, min(1.0, x)))


class AxisSpec(BaseModel):
    deviceId: str
    metric: str


class BlochFromSdkRequest(BaseModel):
    wsUrl: str = Field(default="ws://localhost:8080/status")
    x: AxisSpec
    y: AxisSpec
    z: AxisSpec


class BlochResponse(BaseModel):
    x: float
    y: float
    z: float
    r: float
    ts_ms: int
    note: Optional[str] = None


app = FastAPI(title="StoneGate Live Transforms (Python, stonegate_api)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/analyze/bloch_from_sdk", response_model=BlochResponse)
async def analyze_bloch_from_sdk(req: BlochFromSdkRequest) -> BlochResponse:
    sg.WS_URL = str(req.wsUrl)

    snap = await sg.poll_all_flat()

    def read(axis: AxisSpec) -> float:
        v = (snap.get(axis.deviceId) or {}).get(axis.metric)
        try:
            return float(v)  # type: ignore[arg-type]
        except Exception:
            return float("nan")

    x_raw = read(req.x)
    y_raw = read(req.y)
    z_raw = read(req.z)

    x = _clamp_unit(x_raw)
    y = _clamp_unit(y_raw)
    z = _clamp_unit(z_raw)
    r = float(np.sqrt(x * x + y * y + z * z))

    note = None
    if not np.isfinite(x_raw) or not np.isfinite(y_raw) or not np.isfinite(z_raw):
        note = "missing/non-numeric axis values (check deviceId/metric)"

    return BlochResponse(x=x, y=y, z=z, r=r, ts_ms=int(time.time() * 1000), note=note)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8766)
