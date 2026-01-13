# Error Messages (Master Catalog)

This document is generated from `shared/config/errors.json`. Do not edit it manually.

## Numbering blocks

- 1000-1099: UI validation and input errors (frontend)
- 1100-1199: Build-mode / parts browser errors (frontend)
- 2000-2199: Device read & status errors (backend)
- 2200-2299: Parts library / overrides errors (backend)
- 2300-2399: PhysicsEngine & simulation errors (backend)
- 2400-2499: WebSocket / control channel errors (backend)
- 3000-3099: QEC submission/format errors (qec)
- 3100-3199: QEC run-time errors (qec)

## Errors

### 1000-1099 — UI validation and input errors

#### 1000 — Invalid identifier

**Message form**
- `Error 1000: Invalid identifier for %s — must match ^[A-Za-z0-9_\-:.]+$ and be <=128 chars.`

**Cause**
- An identifier contains disallowed characters or exceeds the maximum length.

**Action**
- Rename it to use only alphanumerics plus _ - : .
- Keep identifiers <= 128 characters.

### 1100-1199 — Build-mode / parts browser errors

#### 1100 — Cannot overwrite builtin part

**Message form**
- `Error 1100: Cannot overwrite builtin part '%s' without Save-As-New.`

**Cause**
- Attempted to save a part under a builtin name without requesting Save-As-New.

**Action**
- Use Save-As-New and provide a unique new name.
- If you intended to update a user part, confirm you selected the user part (not the builtin).

### 2000-2199 — Device read & status errors

#### 2000 — Device read failed

**Message form**
- `Error 2000: Failed to read device '%s' — I/O error: %s`

**Cause**
- The device is disconnected, powered off, or the underlying driver cannot communicate (USB/ETH timeout, permissions).

**Action**
- Check physical connections and power.
- Verify OS-level drivers/permissions and restart the backend.

**Cause**
- The device is present but busy or wedged.

**Action**
- Try a device reset action (if available).
- Power-cycle the device (only if safe).

### 2200-2299 — Parts library / overrides errors

_No errors currently catalogued in this block._

### 2300-2399 — PhysicsEngine & simulation errors

#### 2310 — Override reload failed

**Message form**
- `Error 2310: Override reload failed for file '%s'`

**Cause**
- The override file could not be read (missing file, permissions).

**Action**
- Verify the file exists and the backend has read permissions.
- If running in a container, confirm the volume mount/path.

**Cause**
- The override file contains malformed JSON.

**Action**
- Fix JSON syntax (quotes, braces, commas).
- Validate the override against the expected schema.

### 2400-2499 — WebSocket / control channel errors

_No errors currently catalogued in this block._

### 3000-3099 — QEC submission/format errors

_No errors currently catalogued in this block._

### 3100-3199 — QEC run-time errors

_No errors currently catalogued in this block._
