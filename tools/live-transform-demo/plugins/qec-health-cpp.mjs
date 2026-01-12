// Example script: QEC health monitor backed by a small C++ HTTP service.
//
// Build + run the server:
//   tools/live-transform-demo/cpp/README.md
//
// In the Live Transforms page:
//   External API: http://127.0.0.1:8770
//   Script: QEC health (C++ + stonegate_qec)

export const name = 'qec-health-cpp'

export const ui = {
  usesApiUrl: true,
  usesAxes: false,
}

export const transforms = [{ id: 'qec_health', label: 'QEC health score (monitoring)' }]

const state = {
  lastMs: 0,
  lastResult: null,
  lastErr: null,
  loading: false,
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x))
}

function drawGauge(ctx, x, y, r, v01, label) {
  const v = clamp01(v01)
  const a0 = Math.PI * 0.75
  const a1 = Math.PI * 2.25

  ctx.save()
  ctx.translate(x, y)

  // background arc
  ctx.strokeStyle = 'rgba(180,220,255,0.18)'
  ctx.lineWidth = 10
  ctx.beginPath()
  ctx.arc(0, 0, r, a0, a1)
  ctx.stroke()

  // value arc
  const hue = 120 * v
  ctx.strokeStyle = `hsl(${hue}, 90%, 60%)`
  ctx.lineWidth = 10
  ctx.beginPath()
  ctx.arc(0, 0, r, a0, a0 + (a1 - a0) * v)
  ctx.stroke()

  // needle
  const ang = a0 + (a1 - a0) * v
  ctx.strokeStyle = 'rgba(255,255,255,0.65)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(Math.cos(ang) * (r - 6), Math.sin(ang) * (r - 6))
  ctx.stroke()

  // text
  ctx.fillStyle = 'rgba(210,230,255,0.90)'
  ctx.font = '12px sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(label, 0, r + 18)

  ctx.font = '18px sans-serif'
  ctx.fillText(`${Math.round(v * 100)}%`, 0, 6)

  ctx.restore()
}

function drawPanel(canvas, result, errorText, isUpdating) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#04121d'
  ctx.fillRect(0, 0, w, h)

  const pad = 18

  ctx.fillStyle = 'rgba(180,220,255,0.85)'
  ctx.font = '14px sans-serif'
  ctx.fillText('QEC Health Monitor (C++)', pad, pad + 4)

  if (isUpdating) {
    ctx.fillStyle = 'rgba(180,220,255,0.55)'
    ctx.font = '12px sans-serif'
    ctx.textAlign = 'right'
    ctx.fillText('Updating…', w - pad, pad + 4)
    ctx.textAlign = 'left'
  }

  if (errorText) {
    ctx.fillStyle = 'rgba(255,120,120,0.90)'
    ctx.font = '12px sans-serif'
    ctx.fillText(errorText, pad, pad + 26)
    ctx.fillStyle = 'rgba(180,220,255,0.70)'
    ctx.fillText('Hint: ensure the C++ server is running and supports CORS (OPTIONS preflight).', pad, pad + 44)
    return
  }

  const health = typeof result?.health_score === 'number' ? result.health_score : 0
  drawGauge(ctx, w * 0.25, h * 0.55, Math.min(w, h) * 0.18, health, 'Health score')

  const lines = []
  if (typeof result?.p_flip === 'number') lines.push(`p_flip: ${result.p_flip.toFixed(4)}`)
  if (typeof result?.syndrome_bit === 'number') lines.push(`syndrome_bit: ${result.syndrome_bit.toFixed(0)}`)
  if (typeof result?.leakage_fraction === 'number') lines.push(`leakage_fraction: ${result.leakage_fraction.toFixed(3)}`)
  if (typeof result?.suggested_rounds === 'number') lines.push(`suggested_rounds: ${result.suggested_rounds}`)
  if (typeof result?.recommendation === 'string') lines.push(`recommendation: ${result.recommendation}`)

  if (result?.benchmark_error) lines.push(`benchmark_error: ${String(result.benchmark_error)}`)

  ctx.fillStyle = 'rgba(200,220,255,0.85)'
  ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

  const startX = w * 0.52
  let y = pad + 36
  for (const line of lines) {
    ctx.fillText(line, startX, y)
    y += 16
  }

  // Actions (if any)
  const actions = Array.isArray(result?.actions) ? result.actions : []
  if (actions.length) {
    y += 10
    ctx.fillStyle = 'rgba(160,255,200,0.85)'
    ctx.font = '12px sans-serif'
    ctx.fillText('Suggested actions:', startX, y)
    y += 16

    ctx.fillStyle = 'rgba(160,255,200,0.75)'
    ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
    for (const a of actions.slice(0, 4)) {
      const s = typeof a?.action === 'string' ? a.action : JSON.stringify(a)
      ctx.fillText(`- ${s}`, startX, y)
      y += 16
    }
  }
}

export function transform(ctx) {
  const apiUrl = String(ctx.apiUrl || '').trim().replace(/\/$/, '')
  if (!apiUrl) {
    return {
      kind: 'custom',
      draw(canvas) {
        drawPanel(canvas, null, 'Set External API (C++ server), e.g. http://127.0.0.1:8770')
      },
    }
  }

  const now = Date.now()
  if (!state.loading && now - state.lastMs > 1200) {
    state.lastMs = now
    state.loading = true

    const payload = {
      ws_url: String(ctx.wsUrl || '').trim(),
      qec_device_id: 'qec0',
      syndrome_device_id: 'syn0',
      leak_device_id: 'leak0',
      do_benchmark: true,
      shots: 500,
    }

    fetch(`${apiUrl}/analyze/qec_health`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async (r) => {
        const txt = await r.text()
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt}`)
        return JSON.parse(txt)
      })
      .then((j) => {
        state.lastResult = j
        state.lastErr = null
        state.loading = false
      })
      .catch((e) => {
        state.lastErr = String(e?.message || e)
        state.loading = false
      })
  }

  return {
    kind: 'custom',
    draw(canvas) {
      const hasResult = !!state.lastResult
      const msg = state.lastErr || (!hasResult && state.loading ? 'Loading…' : null)
      drawPanel(canvas, state.lastResult, msg, hasResult && state.loading)
    },
  }
}
