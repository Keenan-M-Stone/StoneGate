from __future__ import annotations

from typing import List, Optional

import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


def _mean_or_nan(values: List[float]) -> float:
    if not values:
        return float("nan")
    return float(np.mean(np.asarray(values, dtype=float)))


def _clamp_unit(x: float) -> float:
    if not np.isfinite(x):
        return 0.0
    return float(max(-1.0, min(1.0, x)))


class Series(BaseModel):
    deviceId: str
    metric: str
    values: List[float] = Field(default_factory=list)


class BlochRequest(BaseModel):
    # We expect three time-aligned-ish series. Exact alignment isn't required for
    # this simple example; we just take a mean over the provided window.
    x: Series
    y: Series
    z: Series


class BlochResponse(BaseModel):
    x: float
    y: float
    z: float
    r: float
    note: Optional[str] = None


app = FastAPI(title="StoneGate Live Transforms (Python)")

# Local tool usage: allow browser tabs to call this server.
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


@app.post("/analyze/bloch", response_model=BlochResponse)
def analyze_bloch(req: BlochRequest) -> BlochResponse:
    # Very lightweight example: interpret the *mean* of each series as an
    # estimated Pauli expectation value over the current window.
    x_raw = _mean_or_nan(req.x.values)
    y_raw = _mean_or_nan(req.y.values)
    z_raw = _mean_or_nan(req.z.values)

    x = _clamp_unit(x_raw)
    y = _clamp_unit(y_raw)
    z = _clamp_unit(z_raw)

    r = float(np.sqrt(x * x + y * y + z * z))

    note = None
    if r > 1.0:
        note = "vector magnitude > 1 (unexpected); check scaling"

    return BlochResponse(x=x, y=y, z=z, r=r, note=note)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765)
