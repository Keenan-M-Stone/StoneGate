# Troubleshooting

This page is meant to be the quick “cause → action” guide you can jump to from the StoneGate UI.

## First checks

- Confirm the backend is running and the frontend shows **Connected**.
- Verify the WebSocket URL in the UI matches your backend (`stonegate.ws_url`).
- Open **Diagnostics…** and look for:
  - connection errors
  - RPC failures (`rpc_result` with `ok:false`)
  - device updates not arriving

## UI error codes (1000–1999)

These codes come from the frontend validation layer.

### Error 1000 — Invalid identifier

**Cause**
- An identifier field contains characters outside `^[A-Za-z0-9_\-:.]+$` or is too long.

**Action**
- Rename the field to use only alphanumerics plus `_ - : .`.
- Keep identifiers ≤ 128 characters.

### Error 1010 — Numeric out of range

**Cause**
- A numeric field violates the allowed min/max for that input.

**Action**
- Clamp the value into the displayed range.
- If the range is wrong for your use case, update the schema/UI constraints.

### Error 1020 — Missing required field

**Cause**
- A required input is missing.

**Action**
- Fill the missing field and retry.

### Error 1021 — Unknown device

**Cause**
- The frontend attempted to reference a device id that doesn’t exist in the backend registry.

**Action**
- Check for typos in device ids.
- Ensure the simulator loaded the device (see backend logs).
- Refresh schematic/state and retry.

### Error 1022 — Device not nominal

**Cause**
- The UI attempted an operation requiring a nominal device state.

**Action**
- Bring the device back to nominal (power/reset/calibrate depending on device).
- Check backend diagnostics for the device state machine.

### Error 1023 — Params not object

**Cause**
- RPC call was constructed with a non-object params payload.

**Action**
- Ensure your macro/command is sending a JSON object for params.

### Error 1024 — Wait seconds invalid

**Cause**
- A wait duration was negative.

**Action**
- Use `0` or a positive number.

### Error 1025 — Missing condition field

**Cause**
- A condition entry is missing a required key.

**Action**
- Ensure the condition includes all required keys (metric/op/value/etc.).

### Error 1026 — Metric not available

**Cause**
- The selected metric is not present on that device’s measurement payload.

**Action**
- Choose a metric that exists for that device.
- Verify device schema and that the backend is publishing the metric.

### Error 1027 — Timeout invalid

**Cause**
- A timeout value was non-positive.

**Action**
- Use a timeout > 0.

### Error 1028 — Record streams required

**Cause**
- A recording request was made without any streams selected.

**Action**
- Add at least one stream and retry.

### Error 1029 — Stream invalid

**Cause**
- One stream entry is invalid (shape/value mismatch).

**Action**
- Check the stream’s device id/metric and any optional transform/constraints.

### Error 1030 — Invalid JSON

**Cause**
- An input JSON blob failed to parse.

**Action**
- Validate JSON formatting and retry.

### Error 1190 — Feature not implemented

**Cause**
- The UI invoked a feature stub.

**Action**
- Check docs for supported workflows.
- If you need the feature, implement the backend/frontend hook and remove the stub.

## When you need deeper context

- Read [Software_Specifications.md](Software_Specifications.md) for protocol/architecture.
- Use the Diagnostics window to see the exact payloads being sent/received.
