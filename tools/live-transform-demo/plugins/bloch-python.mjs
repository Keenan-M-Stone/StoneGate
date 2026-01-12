// Example script: multi-device Bloch-sphere-style visualization backed by a local Python server.
//
// Requirements:
// - Run the Python server from tools/live-transform-demo/python
//   (see README in that folder / main README).
// - Set External API URL in the tool page to match (default http://127.0.0.1:8765)
//
// This script demonstrates:
// - reading signals from MULTIPLE backend devices (via ctx.getSeries)
// - sending a small window of samples to Python for computation
// - rendering a custom visualization in the transform canvas

export const name = 'bloch-python'

export const ui = {
  usesApiUrl: true,
  usesAxes: true,
}

export const transforms = [{ id: 'bloch', label: 'Bloch sphere (Python, multi-device)' }]

const state = {
  lastMs: 0,
  lastResult: null,
  lastErr: null,
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x))
}

function drawBloch2D(canvas, v, meta) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#04121d'
  ctx.fillRect(0, 0, w, h)

  const pad = 24
  const cx = w / 2
  const cy = h / 2
  const r = Math.min(w, h) / 2 - pad

  // Sphere outline
  ctx.strokeStyle = 'rgba(180,220,255,0.35)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()

  // Equator
  ctx.strokeStyle = 'rgba(180,220,255,0.18)'
  ctx.beginPath()
  ctx.ellipse(cx, cy, r, r * 0.35, 0, 0, Math.PI * 2)
  ctx.stroke()

  // Vector projection (x,y)
  const vx = (v?.x ?? 0) * r
  const vy = -(v?.y ?? 0) * r

  // Encode z as color
  const z = v?.z ?? 0
  const t = clamp01((z + 1) / 2)
  const color = `rgba(${Math.round(40 + 140 * (1 - t))}, ${Math.round(120 + 120 * t)}, 200, 0.95)`

  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + vx, cy + vy)
  ctx.stroke()

  // Tip
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx + vx, cy + vy, 5, 0, Math.PI * 2)
  ctx.fill()

  // Text
  ctx.fillStyle = '#cfe'
  ctx.font = '12px Inter, system-ui, sans-serif'
  const lines = [
    meta?.title ?? 'Bloch sphere (2D projection)',
    `x=${(v?.x ?? 0).toFixed(3)}  y=${(v?.y ?? 0).toFixed(3)}  z=${(v?.z ?? 0).toFixed(3)}  r=${(v?.r ?? 0).toFixed(3)}`,
  ]
  if (meta?.subtitle) lines.push(String(meta.subtitle))
  if (meta?.error) lines.push(String(meta.error))

  let y0 = 18
  for (const line of lines) {
    ctx.fillText(line, 14, y0)
    y0 += 16
  }
}

async function callPython(apiUrl, payload) {
  const resp = await fetch(`${apiUrl.replace(/\/$/, '')}/analyze/bloch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) throw new Error(`Python API HTTP ${resp.status}`)
  return await resp.json()
}

export function transform(ctx) {
  // Expect at least 3 devices to demonstrate multi-device aggregation.
  const ids = Array.isArray(ctx.allDeviceIds) ? ctx.allDeviceIds : []
  if (ids.length < 3) {
    return {
      kind: 'custom',
      xLabel: 'Bloch',
      yLabel: '',
      draw(canvas) {
        drawBloch2D(canvas, { x: 0, y: 0, z: 0, r: 0 }, { error: 'Need at least 3 devices connected to show this example.' })
      },
    }
  }

  const apiUrl = String(ctx.apiUrl || '').trim() || 'http://127.0.0.1:8765'

  const axes = ctx?.axes && typeof ctx.axes === 'object' ? ctx.axes : null
  const aggregation = String(axes?.aggregation || 'mean')

  // Prefer explicit X/Y/Z selections from the UI (if present), otherwise fall
  // back to a deterministic pick of the first 3 devices.
  const devX = String(axes?.x?.deviceId || '').trim() || ids[0]
  const devY = String(axes?.y?.deviceId || '').trim() || ids[1]
  const devZ = String(axes?.z?.deviceId || '').trim() || ids[2]

  const metricX = String(axes?.x?.metric || '').trim() || ctx.metric
  const metricY = String(axes?.y?.metric || '').trim() || ctx.metric
  const metricZ = String(axes?.z?.metric || '').trim() || ctx.metric

  const winSec = Math.max(1, Math.min(30, Number(ctx.rangeSec || 10)))

  const xs = (ctx.getSeries?.(devX, metricX, winSec) || []).filter((p) => typeof p.y === 'number').map((p) => p.y)
  const ys = (ctx.getSeries?.(devY, metricY, winSec) || []).filter((p) => typeof p.y === 'number').map((p) => p.y)
  const zs = (ctx.getSeries?.(devZ, metricZ, winSec) || []).filter((p) => typeof p.y === 'number').map((p) => p.y)

  const lastOrEmpty = (arr) => {
    if (!arr || !arr.length) return []
    return [arr[arr.length - 1]]
  }

  // Throttle Python calls.
  const now = Date.now()
  if (now - state.lastMs > 500) {
    state.lastMs = now
    state.lastErr = null
    const payload = {
      x: { deviceId: devX, metric: metricX, values: aggregation === 'latest' ? lastOrEmpty(xs) : xs.slice(-256) },
      y: { deviceId: devY, metric: metricY, values: aggregation === 'latest' ? lastOrEmpty(ys) : ys.slice(-256) },
      z: { deviceId: devZ, metric: metricZ, values: aggregation === 'latest' ? lastOrEmpty(zs) : zs.slice(-256) },
    }

    callPython(apiUrl, payload)
      .then((res) => {
        state.lastResult = res
      })
      .catch((e) => {
        state.lastErr = String(e?.message || e)
      })
  }

  const subtitle = `X=${devX}:${metricX}  Y=${devY}:${metricY}  Z=${devZ}:${metricZ}  (${aggregation})`

  return {
    kind: 'custom',
    xLabel: 'Bloch',
    yLabel: '',
    draw(canvas) {
      drawBloch2D(canvas, state.lastResult, {
        title: 'Bloch sphere (Python, multi-device) — 2D projection',
        subtitle,
        error: state.lastErr,
      })
    },
  }
}
