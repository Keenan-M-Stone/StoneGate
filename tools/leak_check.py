#!/usr/bin/env python3

"""Leak-check utility for the StoneGate simulator.

Runs a simple procedure:
1) Seal chamber + enable pump
2) Pump to a target pressure
3) Disable pump and observe pressure drift toward atmosphere
4) Estimate leak rate assuming dP/dt = -k*(P - P_atm)

Intended to be schematic-visible: it drives `press_ctrl0` and reads `press0`.

Requires: `pip install websockets`
"""

from __future__ import annotations

import argparse
import asyncio
import time
from pathlib import Path
from typing import List, Tuple


def _import_stonegate_api():
    try:
        import stonegate_api as sg  # type: ignore

        return sg
    except ImportError:
        # Allow running from a repo checkout without installing the SDK.
        import sys

        repo_root = Path(__file__).resolve().parent.parent
        candidates = [
            repo_root / "sdk" / "python" / "stonegate_sdk",
            repo_root / "tools" / "sdk_sources",
        ]
        for c in candidates:
            if c.exists():
                sys.path.insert(0, str(c))
                break
        import stonegate_api as sg  # type: ignore

        return sg


sg = _import_stonegate_api()


async def _poll_pressure(device_id: str) -> float:
    return await sg.poll_required_number(device_id, "pressure_kPa")


async def run_leak_check(
    *,
    ws_url: str,
    pressure_sensor_id: str,
    pressure_controller_id: str,
    target_kpa: float,
    stabilize_tolerance_kpa: float,
    stabilize_window_s: float,
    stabilize_consecutive: int,
    observe_s: float,
    sample_period_s: float,
    p_atm_kpa: float,
) -> None:
    sg.WS_URL = ws_url

    # Sanity: ensure devices exist
    devs = await sg.rpc("devices.list", {})
    ids = {d.get("id") for d in devs.get("devices", []) if isinstance(d, dict)}
    for required in (pressure_controller_id, pressure_sensor_id):
        if required not in ids:
            raise RuntimeError(f"Missing device id {required!r}. Available: {sorted(i for i in ids if isinstance(i, str))}")

    # Drive to target.
    await sg.device_action(pressure_controller_id, {"set": {"sealed": True, "pump_enabled": True}})
    await sg.device_action(pressure_controller_id, {"set": {"pressure_setpoint_kPa": float(target_kpa)}})

    await sg.wait_for_stable(
        pressure_sensor_id,
        "pressure_kPa",
        tolerance=float(stabilize_tolerance_kpa),
        window_s=float(stabilize_window_s),
        consecutive=int(stabilize_consecutive),
        timeout_s=max(20.0, float(stabilize_window_s) * float(stabilize_consecutive) * 3.0),
    )

    p0 = await _poll_pressure(pressure_sensor_id)
    print(f"Stabilized at ~{p0:.3f} kPa; disabling pump to measure leak…")

    # Observe drift with pump disabled.
    await sg.device_action(pressure_controller_id, {"set": {"pump_enabled": False}})

    samples: List[Tuple[float, float]] = []
    t_start = time.time()
    while True:
        t = time.time()
        p = await _poll_pressure(pressure_sensor_id)
        samples.append((t, p))
        if (t - t_start) >= float(observe_s):
            break
        await asyncio.sleep(float(sample_period_s))

    k = sg.estimate_leak_rate_per_s(samples, p_atm_kpa=float(p_atm_kpa))
    p_end = samples[-1][1]

    print(f"End pressure: {p_end:.3f} kPa after {observe_s:.1f}s")
    if k is None:
        print("Leak estimate: insufficient/unstable data (try longer observe time).")
        return

    tau = 1.0 / k if k > 0 else float("inf")
    print(f"Estimated leak_rate_per_s: {k:.6f}  (time constant tau ≈ {tau:.1f} s)")


def main() -> None:
    ap = argparse.ArgumentParser(description="Leak-check macro for StoneGate simulator")
    ap.add_argument("--ws", default="ws://localhost:8080/status", help="WebSocket URL")
    ap.add_argument("--press", default="press0", help="Pressure sensor device id")
    ap.add_argument("--ctrl", default="press_ctrl0", help="Pressure controller device id")
    ap.add_argument("--target-kpa", type=float, default=40.0, help="Target pressure setpoint")
    ap.add_argument("--observe-s", type=float, default=60.0, help="Observation time with pump disabled")
    ap.add_argument("--sample-period-s", type=float, default=1.0, help="Polling period")
    ap.add_argument("--p-atm-kpa", type=float, default=101.3, help="Atmospheric pressure reference")
    ap.add_argument("--stable-tol-kpa", type=float, default=0.3, help="Stability tolerance for pressure")
    ap.add_argument("--stable-window-s", type=float, default=4.0, help="Stability sliding window")
    ap.add_argument("--stable-consecutive", type=int, default=6, help="Consecutive stable windows required")
    args = ap.parse_args()

    asyncio.run(
        run_leak_check(
            ws_url=args.ws,
            pressure_sensor_id=args.press,
            pressure_controller_id=args.ctrl,
            target_kpa=args.target_kpa,
            stabilize_tolerance_kpa=args.stable_tol_kpa,
            stabilize_window_s=args.stable_window_s,
            stabilize_consecutive=args.stable_consecutive,
            observe_s=args.observe_s,
            sample_period_s=args.sample_period_s,
            p_atm_kpa=args.p_atm_kpa,
        )
    )


if __name__ == "__main__":
    main()
