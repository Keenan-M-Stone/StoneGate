# Live Transforms (external analysis)

This is a small, **standalone browser page** that connects directly to the StoneGate backend WebSocket and renders:
- a live time-series plot
- a second canvas that runs a selectable transform (built-ins, or your own script)

## How to open it from the StoneGate UI

The StoneGate UI includes a menu item (**Live Transforms…**) that opens this page in a new tab.

## How it is served

This folder is mirrored into `frontend/public/tools/live-transform-demo/` via:
- `frontend/scripts/sync-live-transform-demo.mjs`

So it is available at:
- `<BASE_URL>/tools/live-transform-demo/index.html`

## Python-backed example (Bloch sphere)

One of the packaged scripts uses a local Python server to do heavier computation and then renders a custom visualization.

1) Start the server:

```bash
cd tools/live-transform-demo/python
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python bloch_server.py
```

The server listens on `http://127.0.0.1:8765` by default.

2) In the Live Transforms page:
- Set **External API** to `http://127.0.0.1:8765`
- In **Script**, select **Bloch sphere (Python, multi-device)**
- Pick any device + metric (live plot)
- Optionally set **Axes: X/Y/Z device + metric** (used by the Bloch example)
- Use **Aggregation** to choose between smoother windowed means and more dynamic “latest sample” updates.

### Refreshing scripts during development

- **Reload scripts** re-fetches `plugins/manifest.json` and refreshes the Script dropdown.
- **Refresh current** re-imports the currently selected script module.
	- For a browsed file, this re-imports the last selected file.

## Python example that uses `stonegate_api`

There is also a reference server that pulls measurements directly from the backend using the StoneGate SDK helpers.

1) Generate and install the SDK (repo root):

```bash
python3 tools/generate_stonegate_sdk.py
python3 -m pip install -e sdk/python/stonegate_sdk
```

2) Start the SDK-backed server:

```bash
python3 -m pip install -r tools/live-transform-demo/python/requirements.txt
python3 tools/live-transform-demo/python/bloch_server_stonegate_sdk.py
```

3) In the Live Transforms page:
- Set **External API** to `http://127.0.0.1:8766`
- Select **Bloch sphere (Python + stonegate_api)**

### Should the Bloch diagram change over time?

Yes, but only if the underlying axis values are changing.

Common reasons it looks static:
- The selected axis device/metric values are steady (or quantized) at the timescale you’re viewing.
- Your axis selections point to the wrong metrics (so the server returns zeros / missing values).
- The Python computation is intentionally smoothing (the non-SDK example uses a windowed mean).

For the most “alive” behavior, try:
- Use the **SDK-backed** scripts (they use the latest polled values).
- Choose a metric with visible noise/variation.
- Reduce the Range window for the non-SDK example.

### Rotatable 3D Bloch sphere

Interactivity (rotation/zoom) must be implemented in the browser (it’s a UI feature). The Python side can supply the vector, but it can’t make the browser canvas rotatable by itself.

There’s a packaged script that renders a rotatable 3D Bloch sphere using Three.js:
- **Bloch sphere 3D (Python + stonegate_api)**

It uses the same `bloch_server_stonegate_sdk.py` endpoint and renders smoothly using an internal animation loop.

## Writing your own transform script

Use [plugin-template.mjs](plugin-template.mjs) as a starting point.

In the page:
- either choose one of the packaged scripts from the **Script** dropdown (see `plugins/manifest.json`)
- or click **Browse script…** and select your local `.mjs` file

Your script runs in the browser tab and may import any dependencies you want (for example from a CDN).

### Script API

Your module should export:
- `name: string`
- `transforms: Array<{ id: string, label: string }>`
- `transform(ctx)`

`ctx` includes the currently selected device/metric and the live sample window for that device, plus helpers for multi-device transforms:
- `deviceId`, `metric`, `rangeSec`, `sampleRateHz`, `transformId`
- `points: Array<{ x:number, y:number }>` where `x` is a timestamp in ms
- `apiUrl: string` from the **External API** input
- `allDeviceIds: string[]`
- `getSeries(deviceId, metric, seconds) => Array<{ x:number, y:number|null }>`
- `metricsFor(deviceId) => string[]`

Return either a line plot:
- `{ kind: 'time'|'freq', points, xLabel, yLabel, error? }`

Or a custom renderer:
- `{ kind: 'custom', draw(canvas), xLabel?, yLabel?, error? }`
