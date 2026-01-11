# Generated file.
# Do not edit in sdk/. Edit the source-of-truth files instead:
#   - tools/sdk_sources/stonegate_api.py
#   - tools/sdk_sources/stonegate_qec.py
#   - tools/sdk_sources/stonegate_api.hpp
#   - tools/sdk_sources/stonegate_qec.hpp
# Regenerate with: python3 tools/generate_stonegate_sdk.py

"""StoneGate client helpers for generated macros.

This module is intentionally small and dependency-light.
- Requires: `pip install websockets`
- Protocol: JSON-RPC over WebSocket as implemented by StoneGate backend.

Generated scripts/notebooks can do:

    import stonegate_api as sg
    sg.WS_URL = 'ws://localhost:8080/status'

and then use `await sg.device_action(...)`, `await sg.wait_for_stable(...)`, etc.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any, Dict, Optional, Set

import websockets

WS_URL = "ws://localhost:8080/status"


async def list_devices() -> Dict[str, Any]:
    return await rpc("devices.list", {})


async def rpc(method: str, params: Optional[Dict[str, Any]] = None, timeout_s: float = 10.0) -> Any:
    rid = f"py_{uuid.uuid4().hex}"
    req = {"type": "rpc", "id": rid, "method": method, "params": params or {}}
    async with websockets.connect(WS_URL) as ws:
        await ws.send(json.dumps(req))
        loop = asyncio.get_running_loop()
        deadline = loop.time() + float(timeout_s)
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                raise TimeoutError(f"RPC timeout: {method}")
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=remaining))
            if msg.get("type") == "rpc_result" and msg.get("id") == rid:
                if not msg.get("ok", False):
                    raise RuntimeError(msg.get("error"))
                return msg.get("result")


async def poll_all_flat() -> Dict[str, Dict[str, Any]]:
    r = await rpc("devices.poll", {})
    out: Dict[str, Dict[str, Any]] = {}
    for u in r.get("updates", []):
        did = u.get("id")
        meas = u.get("measurement") or {}
        if isinstance(meas, dict) and "measurements" in meas and isinstance(meas.get("measurements"), dict):
            inner = meas.get("measurements")
            flat = {k: (v.get("value") if isinstance(v, dict) and "value" in v else v) for k, v in inner.items()}
        elif isinstance(meas, dict):
            flat = {k: (v.get("value") if isinstance(v, dict) and "value" in v else v) for k, v in meas.items()}
        else:
            flat = {}
        if isinstance(did, str):
            out[did] = flat
    return out


async def device_action(device_id: str, action: Dict[str, Any]) -> Any:
    return await rpc("device.action", {"device_id": device_id, "action": action}, timeout_s=20.0)


async def device_set(device_id: str, **params: Any) -> Any:
    """UI-aligned control shape: {"set": { metric: value }}."""

    return await device_action(device_id, {"set": params})


async def device_zero(device_id: str) -> Any:
    return await device_action(device_id, {"zero": True})


async def record_start(params: Dict[str, Any]) -> str:
    r = await rpc("record.start", params, timeout_s=20.0)
    if isinstance(r, dict):
        return str(r.get("recording_id", ""))
    return ""


async def record_stop(recording_id: str) -> Any:
    if not recording_id:
        return None
    return await rpc("record.stop", {"recording_id": recording_id}, timeout_s=20.0)


def eval_condition(latest: Optional[float], op: str, value: float) -> bool:
    if latest is None:
        return False
    if op == "<":
        return latest < value
    if op == "<=":
        return latest <= value
    if op == ">":
        return latest > value
    if op == ">=":
        return latest >= value
    if op == "==":
        return latest == value
    if op == "!=":
        return latest != value
    raise ValueError(f"Unknown op: {op}")


async def get_latest_number(device_id: str, metric: str) -> Optional[float]:
    snap = await poll_all_flat()
    v = (snap.get(device_id) or {}).get(metric)
    try:
        return float(v)  # type: ignore[arg-type]
    except Exception:
        return None


async def poll_required_number(device_id: str, metric: str) -> float:
    v = await get_latest_number(device_id, metric)
    if v is None:
        raise RuntimeError(f"No {metric} reading for {device_id}")
    return float(v)


def estimate_leak_rate_per_s(samples: list[tuple[float, float]], p_atm_kpa: float = 101.3) -> float | None:
    """Estimate k from P(t) - P_atm = (P0 - P_atm) * exp(-k t).

    Uses a simple least-squares fit in log-space.
    """

    import math

    if len(samples) < 3:
        return None

    t0 = samples[0][0]
    xs: list[float] = []
    ys: list[float] = []
    dp0 = samples[0][1] - p_atm_kpa
    if dp0 == 0:
        return None

    for t, p in samples:
        dp = p - p_atm_kpa
        # Require same sign to keep log well-defined.
        if dp == 0 or (dp > 0) != (dp0 > 0):
            continue
        xs.append(t - t0)
        ys.append(math.log(abs(dp)))

    if len(xs) < 3:
        return None

    # Fit y = a + b x; then k = -b
    xbar = sum(xs) / len(xs)
    ybar = sum(ys) / len(ys)
    num = sum((x - xbar) * (y - ybar) for x, y in zip(xs, ys))
    den = sum((x - xbar) ** 2 for x in xs)
    if den == 0:
        return None
    b = num / den
    k = -b
    if not math.isfinite(k) or k < 0:
        return None
    return k


async def wait_for_stable(
    device_id: str,
    metric: str,
    tolerance: float,
    window_s: float,
    consecutive: int,
    timeout_s: float,
) -> None:
    start = asyncio.get_running_loop().time()
    ok = 0
    samples: list[float] = []
    ts: list[float] = []
    while (asyncio.get_running_loop().time() - start) < float(timeout_s):
        v = await get_latest_number(device_id, metric)
        now = asyncio.get_running_loop().time()
        if v is not None:
            samples.append(v)
            ts.append(now)
        while ts and (now - ts[0]) > float(window_s):
            ts.pop(0)
            samples.pop(0)
        if len(samples) >= 2:
            if abs(max(samples) - min(samples)) <= float(tolerance):
                ok += 1
            else:
                ok = 0
            if ok >= int(consecutive):
                return
        await asyncio.sleep(min(0.5, max(0.05, float(window_s) / 4)))
    raise TimeoutError(f"wait_for_stable timeout: {device_id}:{metric}")


async def apply_safe_state(active_recording_ids: Set[str], safe_targets: Dict[str, Dict[str, Any]]) -> None:
    for rid in list(active_recording_ids):
        try:
            await record_stop(rid)
        except Exception:
            pass
        active_recording_ids.discard(rid)

    for device_id, params in (safe_targets or {}).items():
        if not params:
            continue
        try:
            await device_action(device_id, {"set": params})
        except Exception:
            # Best-effort safe-state.
            pass
