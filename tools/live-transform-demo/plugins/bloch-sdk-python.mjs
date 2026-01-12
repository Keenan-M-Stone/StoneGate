// Example script: Bloch-sphere-style visualization where Python pulls data via stonegate_api.
//
// Run:
//   python3 tools/generate_stonegate_sdk.py
//   python3 -m pip install -e sdk/python/stonegate_sdk
//   python3 -m pip install -r tools/live-transform-demo/python/requirements.txt
//   python3 tools/live-transform-demo/python/bloch_server_stonegate_sdk.py
//
// Then set External API to: http://127.0.0.1:8766

export const name = 'bloch-sdk-python'

export const ui = {
  usesApiUrl: true,
  usesAxes: true,
}

export const transforms = [{ id: 'bloch_sdk', label: 'Bloch sphere (Python + stonegate_api)' }]

const state = {
  lastMs: 0,
  lastResult: null,
  lastErr: null,
  history: [],
}

function meanVec(history) {
  if (!history || history.length === 0) return null
  let sx = 0
  let sy = 0
  let sz = 0
  let n = 0
  for (const v of history) {
    if (!v) continue
    if (typeof v.x !== 'number' || typeof v.y !== 'number' || typeof v.z !== 'number') continue
    sx += v.x
    sy += v.y
    sz += v.z
    n += 1
  }
  if (!n) return null
  const x = sx / n
  const y = sy / n
  const z = sz / n
  const r = Math.sqrt(x * x + y * y + z * z)
  return { x, y, z, r }
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

  ctx.strokeStyle = 'rgba(180,220,255,0.35)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()

  ctx.strokeStyle = 'rgba(180,220,255,0.18)'
  ctx.beginPath()
  ctx.ellipse(cx, cy, r, r * 0.35, 0, 0, Math.PI * 2)
  ctx.stroke()

  const vx = (v?.x ?? 0) * r
  const vy = -(v?.y ?? 0) * r

  const z = v?.z ?? 0
  const t = clamp01((z + 1) / 2)
  const color = `rgba(${Math.round(40 + 140 * (1 - t))}, ${Math.round(120 + 120 * t)}, 200, 0.95)`

  ctx.strokeStyle = color
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + vx, cy + vy)
  ctx.stroke()

  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx + vx, cy + vy, 5, 0, Math.PI * 2)
  ctx.fill()

  ctx.fillStyle = '#cfe'
  ctx.font = '12px Inter, system-ui, sans-serif'
  const lines = [
    meta?.title ?? 'Bloch sphere (2D projection)',
    `x=${(v?.x ?? 0).toFixed(3)}  y=${(v?.y ?? 0).toFixed(3)}  z=${(v?.z ?? 0).toFixed(3)}  r=${(v?.r ?? 0).toFixed(3)}`,
  ]
  if (v?.ts_ms) lines.push(`updated=${new Date(v.ts_ms).toLocaleTimeString()}`)
  if (meta?.subtitle) lines.push(String(meta.subtitle))
  if (meta?.error) lines.push(String(meta.error))

  let y0 = 18
  for (const line of lines) {
    ctx.fillText(line, 14, y0)
    y0 += 16
  }
}

async function callPython(apiUrl, payload) {
  const resp = await fetch(`${apiUrl.replace(/\/$/, '')}/analyze/bloch_from_sdk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!resp.ok) throw new Error(`Python API HTTP ${resp.status}`)
  return await resp.json()
}

export function transform(ctx) {
  const apiUrl = String(ctx.apiUrl || '').trim() || 'http://127.0.0.1:8766'
  const aggregation = String(ctx?.axes?.aggregation || 'mean')

  const ax = ctx?.axes || {}
  const x = { deviceId: String(ax?.x?.deviceId || '').trim(), metric: String(ax?.x?.metric || '').trim() }
  const y = { deviceId: String(ax?.y?.deviceId || '').trim(), metric: String(ax?.y?.metric || '').trim() }
  const z = { deviceId: String(ax?.z?.deviceId || '').trim(), metric: String(ax?.z?.metric || '').trim() }

  const subtitle = `X=${x.deviceId}:${x.metric}  Y=${y.deviceId}:${y.metric}  Z=${z.deviceId}:${z.metric}`

  const now = Date.now()
  if (now - state.lastMs > 500) {
    state.lastMs = now
    state.lastErr = null
    callPython(apiUrl, { wsUrl: String(ctx.wsUrl || '').trim(), x, y, z })
      .then((res) => {
        state.lastResult = res
        state.history.push(res)
        if (state.history.length > 24) state.history.splice(0, state.history.length - 24)
      })
      .catch((e) => {
        state.lastErr = String(e?.message || e)
      })
  }

  const v = aggregation === 'latest' ? state.lastResult : (meanVec(state.history) || state.lastResult)

  return {
    kind: 'custom',
    xLabel: 'Bloch',
    yLabel: '',
    draw(canvas) {
      drawBloch2D(canvas, v, {
        title: 'Bloch sphere (Python + stonegate_api) — 2D projection',
        subtitle: `${subtitle}  (${aggregation})`,
        error: state.lastErr,
      })
    },
  }
}
