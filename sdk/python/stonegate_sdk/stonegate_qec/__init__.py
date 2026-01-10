# Generated file.
# Do not edit in sdk/. Edit the repo root sources instead:
#   - stonegate_api.py
#   - stonegate_qec.py
#   - stonegate_api.hpp
#   - stonegate_qec.hpp
# Regenerate with: python3 tools/generate_stonegate_sdk.py

"""StoneGate quantum error correction (QEC) helpers.

This module complements `stonegate_api.py`.

Design goal: treat the simulator backend like real hardware.
- Measurements should come from devices in the backend simulator (via `devices.poll`).
- Noise/physics simulation belongs in the backend simulator, not in this file.

This file therefore focuses on:
- building QEC measurement payloads
- invoking backend decode RPC (`qec.decode`)
- driving simulated QEC hardware via `device.action` and reading back results
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

import math
import random

import stonegate_api as sg

Measurement = Dict[str, Any]


def repetition_decode_majority(measurements: Sequence[Measurement]) -> int:
    """Toy repetition-code decoder: majority vote over 'value' bits."""

    bits: List[int] = []
    for m in measurements:
        try:
            bits.append(1 if int(m.get("value", 0)) != 0 else 0)
        except Exception:
            bits.append(0)
    if not bits:
        return 0
    ones = sum(bits)
    return 1 if ones > (len(bits) / 2.0) else 0


def repetition_measurements(
    *,
    true_bit: int,
    p_flip: float,
    rounds: int,
    qubit: int = 0,
    basis: str = "Z",
    rng: Optional[random.Random] = None,
) -> List[Measurement]:
    """Generate synthetic repetition-code measurements (pure Python demo)."""

    r = rng or random.Random()
    out: List[Measurement] = []
    tb = 1 if int(true_bit) != 0 else 0
    p = float(p_flip)
    p = max(0.0, min(1.0, p))
    for i in range(int(rounds)):
        bit = tb
        if r.random() < p:
            bit ^= 1
        out.append(make_measurement(qubit=qubit, basis=basis, round=i, value=bit))
    return out


def logical_error_rate_repetition(*, trials: int, p_flip: float, rounds: int, seed: Optional[int] = None) -> float:
    """Estimate logical error rate for a repetition code using majority vote."""

    r = random.Random(seed)
    errs = 0
    for _ in range(int(trials)):
        true_bit = 0
        meas = repetition_measurements(true_bit=true_bit, p_flip=p_flip, rounds=rounds, rng=r)
        dec = repetition_decode_majority(meas)
        if dec != true_bit:
            errs += 1
    return float(errs) / max(1, int(trials))


def p_flip_from_temperature(*, temperature_K: float) -> float:
    """Simple monotone mapping for demos.

    Realistic noise is simulated in the backend; this is for notebook plots/intuition.
    """

    t = float(temperature_K)
    # Rough map: colder => less noise.
    p = 0.02 + 0.18 * (1.0 / (1.0 + math.exp(-(t - 85.0) / 6.0)))
    return max(0.0, min(0.35, p))


def choose_repetition_rounds(*, temperature_K: float, min_rounds: int = 3, max_rounds: int = 9) -> int:
    """Choose rounds from a temperature-derived p_flip (demo helper)."""

    p = p_flip_from_temperature(temperature_K=temperature_K)
    # Map p in [0.01..0.35] to [min..max].
    x = (p - 0.01) / max(1e-9, (0.35 - 0.01))
    x = max(0.0, min(1.0, x))
    r = int(round(min_rounds + (max_rounds - min_rounds) * x))
    return max(int(min_rounds), min(int(max_rounds), r))


async def decode_via_rpc(
    *,
    code: str,
    measurements: Sequence[Measurement],
    timeout_s: float = 20.0,
    **extra_params: Any,
) -> Any:
    """Call the backend `qec.decode` RPC over the StoneGate WebSocket."""

    params: Dict[str, Any] = {"code": code, "measurements": list(measurements)}
    params.update(extra_params)
    return await sg.rpc("qec.decode", params, timeout_s=timeout_s)


def make_measurement(*, qubit: int, basis: str, round: int, value: int) -> Measurement:
    return {"qubit": int(qubit), "basis": str(basis), "round": int(round), "value": int(value)}

async def read_qec_status(
    *,
    qec_device_id: str = "qec0",
) -> Dict[str, Any]:
    """Read current QEC-related simulator metrics from the backend."""

    snap = await sg.poll_all_flat()
    return dict(snap.get(qec_device_id) or {})


async def read_noise_estimate(
    *,
    qec_device_id: str = "qec0",
) -> Tuple[Optional[float], Optional[float]]:
    """Return (temperature_K, p_flip) as reported by the simulator device, if available."""

    st = await read_qec_status(qec_device_id=qec_device_id)
    t = st.get("temperature_K")
    p = st.get("p_flip")
    try:
        t_f = float(t) if t is not None else None
    except Exception:
        t_f = None
    try:
        p_f = float(p) if p is not None else None
    except Exception:
        p_f = None
    return t_f, p_f


async def choose_repetition_rounds_from_hardware(
    *,
    qec_device_id: str = "qec0",
    min_rounds: int = 3,
    max_rounds: int = 9,
) -> int:
    """Choose number of rounds based on *hardware/simulator* noise readout."""

    _tK, p = await read_noise_estimate(qec_device_id=qec_device_id)
    if p is None:
        return int(min_rounds)
    # Map p in [0.01..0.35] to [min..max].
    x = (p - 0.01) / max(1e-9, (0.35 - 0.01))
    x = max(0.0, min(1.0, x))
    r = int(round(min_rounds + (max_rounds - min_rounds) * x))
    return max(int(min_rounds), min(int(max_rounds), r))


async def acquire_repetition_measurements(
    *,
    qec_device_id: str = "qec0",
    rounds: int,
    qubit: int = 0,
    basis: str = "Z",
    set_true_bit: Optional[int] = None,
    settle_s: float = 0.0,
) -> List[Measurement]:
    """Drive the simulator to extract a syndrome bit each round and read it back.

    - Noise is simulated in the backend.
    - Measurements are read back via `devices.poll` snapshots.
    """

    if set_true_bit is not None:
        await sg.device_action(qec_device_id, {"set_true_bit": int(set_true_bit)})

    out: List[Measurement] = []
    for r in range(int(rounds)):
        # Trigger a hardware-like measurement. Backend simulator sets/updates the `syndrome` metric.
        await sg.device_action(qec_device_id, {"extract_syndrome": True})
        if settle_s and settle_s > 0:
            # Optional small wait if the UI wants time to reflect updates.
            import asyncio

            await asyncio.sleep(float(settle_s))
        st = await read_qec_status(qec_device_id=qec_device_id)
        v = st.get("syndrome")
        try:
            bit = 1 if (v is not None and int(v) != 0) else 0
        except Exception:
            bit = 0
        out.append(make_measurement(qubit=qubit, basis=basis, round=r, value=bit))
    return out


def summarize_measurements(measurements: Sequence[Measurement]) -> Dict[str, Any]:
    vals = [int(m.get("value", 0)) for m in measurements]
    return {
        "count": len(measurements),
        "ones": int(sum(vals)),
        "zeros": int(len(vals) - sum(vals)),
    }


async def run_repetition_and_decode(
    *,
    qec_device_id: str = "qec0",
    rounds: Optional[int] = None,
    qubit: int = 0,
    basis: str = "Z",
    set_true_bit: Optional[int] = None,
    timeout_s: float = 20.0,
) -> Dict[str, Any]:
    """Convenience: acquire measurements from the simulator, then decode via backend RPC."""

    if rounds is None:
        rounds = await choose_repetition_rounds_from_hardware(qec_device_id=qec_device_id)
    meas = await acquire_repetition_measurements(
        qec_device_id=qec_device_id,
        rounds=int(rounds),
        qubit=qubit,
        basis=basis,
        set_true_bit=set_true_bit,
    )
    res = await decode_via_rpc(code="repetition", measurements=meas, timeout_s=timeout_s)
    return {"measurements": meas, "decode": res}
