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


async def benchmark_via_rpc(
    *,
    code: str,
    p_flip: Optional[float] = None,
    rounds: int = 3,
    shots: int = 1000,
    seed: Optional[int] = None,
    params: Optional[Dict[str, Any]] = None,
    timeout_s: float = 20.0,
    qec_device_id: str = "qec0",
) -> Any:
    """Call the backend `qec.benchmark` RPC.

    If `p_flip` is omitted, this will try to read it from `qec_device_id` via `devices.poll`.
    """

    if p_flip is None:
        _tK, p = await read_noise_estimate(qec_device_id=qec_device_id)
        p_flip = float(p) if p is not None else 0.01

    req: Dict[str, Any] = {
        "code": str(code),
        "p_flip": float(p_flip),
        "rounds": int(rounds),
        "shots": int(shots),
    }
    if seed is not None:
        req["seed"] = int(seed)
    if params is not None:
        req["params"] = dict(params)

    return await sg.rpc("qec.benchmark", req, timeout_s=timeout_s)


async def benchmark_repetition_from_hardware(
    *,
    rounds: int,
    shots: int = 2000,
    seed: Optional[int] = None,
    qec_device_id: str = "qec0",
    timeout_s: float = 20.0,
) -> Any:
    """Convenience wrapper: repetition-code benchmark using the simulator's reported p_flip."""

    return await benchmark_via_rpc(
        code="repetition",
        p_flip=None,
        rounds=rounds,
        shots=shots,
        seed=seed,
        qec_device_id=qec_device_id,
        timeout_s=timeout_s,
    )


async def benchmark_surface_heuristic(
    *,
    distance: int = 5,
    p_flip: Optional[float] = None,
    qec_device_id: str = "qec0",
    timeout_s: float = 20.0,
) -> Any:
    """Surface-code heuristic benchmark (backend-owned scaling-law model)."""

    return await benchmark_via_rpc(
        code="surface",
        p_flip=p_flip,
        rounds=1,
        shots=1,
        params={"distance": int(distance)},
        qec_device_id=qec_device_id,
        timeout_s=timeout_s,
    )


def make_measurement(*, qubit: int, basis: str, round: int, value: int) -> Measurement:
    return {"qubit": int(qubit), "basis": str(basis), "round": int(round), "value": int(value)}


# ---- Simulator QEC tooling convenience wrappers (device.action)


async def syndrome_stream_start(
    *,
    device_id: str = "syn0",
    code_type: str = "repetition",
    rate_hz: float = 10.0,
) -> None:
    await sg.device_action(device_id, {"set_code_type": str(code_type), "set_rate_hz": float(rate_hz), "start": True})


async def syndrome_stream_stop(*, device_id: str = "syn0") -> None:
    await sg.device_action(device_id, {"stop": True})


async def noise_spectrometer_scan(
    *,
    device_id: str = "noise0",
    band_hz: float = 2000.0,
    duration_s: float = 0.5,
) -> None:
    await sg.device_action(device_id, {"set_band_hz": float(band_hz), "set_duration_s": float(duration_s), "run_scan": True})


async def readout_calibrate(
    *,
    device_id: str = "rocal0",
    target_device: str = "det0",
    samples: int = 500,
) -> None:
    await sg.device_action(device_id, {"set_target_device": str(target_device), "set_samples": int(samples), "calibrate": True})


async def fault_inject_set_env(
    *,
    device_id: str = "fault0",
    temperature_K: Optional[float] = None,
    pressure_kPa: Optional[float] = None,
    ambient_lux: Optional[float] = None,
    vibration_rms: Optional[float] = None,
) -> None:
    patch: Dict[str, float] = {}
    if temperature_K is not None:
        patch["temperature_K"] = float(temperature_K)
    if pressure_kPa is not None:
        patch["pressure_kPa"] = float(pressure_kPa)
    if ambient_lux is not None:
        patch["ambient_lux"] = float(ambient_lux)
    if vibration_rms is not None:
        patch["vibration_rms"] = float(vibration_rms)
    if patch:
        await sg.device_action(device_id, {"set_env": patch})


async def fault_inject_override_device(
    *,
    device_id: str = "fault0",
    target_device_id: str,
    override: Dict[str, Any],
) -> None:
    await sg.device_action(device_id, {"override_device": {"device_id": str(target_device_id), "override": dict(override)}})


async def fault_inject_clear_overrides(*, device_id: str = "fault0") -> None:
    await sg.device_action(device_id, {"clear_overrides": True})


async def leakage_set_fraction(
    *,
    device_id: str = "leak0",
    target_device: str = "qec0",
    leakage_fraction: float,
) -> None:
    await sg.device_action(device_id, {"set_target_device": str(target_device), "set_leakage_fraction": float(leakage_fraction)})


async def leakage_attempt_reset(*, device_id: str = "leak0") -> None:
    await sg.device_action(device_id, {"attempt_reset": True})


async def surface_configure_and_run(
    *,
    device_id: str = "surf0",
    distance: int = 5,
    cycles: int = 25,
) -> None:
    await sg.device_action(device_id, {"configure": {"distance": int(distance)}})
    await sg.device_action(device_id, {"run_cycles": {"cycles": int(cycles)}})


async def lattice_surgery_run_demo(
    *,
    device_id: str = "surg0",
    operation: str = "merge",
) -> None:
    await sg.device_action(device_id, {"set_operation": str(operation), "run_demo": True})


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
