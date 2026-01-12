// Standalone tool that connects to StoneGate backend WS and renders:
// - live plot (time series)
// - transformed plot (script-defined)

const WS_URL_KEY = 'stonegate.ws_url'
const SCRIPT_ID_KEY = 'stonegate.liveTransforms.scriptId'
const TRANSFORM_ID_KEY = 'stonegate.liveTransforms.transformId'
const API_URL_KEY = 'stonegate.liveTransforms.apiUrl'

const AX_X_DEVICE_KEY = 'stonegate.liveTransforms.axis.x.deviceId'
const AX_X_METRIC_KEY = 'stonegate.liveTransforms.axis.x.metric'
const AX_Y_DEVICE_KEY = 'stonegate.liveTransforms.axis.y.deviceId'
const AX_Y_METRIC_KEY = 'stonegate.liveTransforms.axis.y.metric'
const AX_Z_DEVICE_KEY = 'stonegate.liveTransforms.axis.z.deviceId'
const AX_Z_METRIC_KEY = 'stonegate.liveTransforms.axis.z.metric'
const AX_AGG_KEY = 'stonegate.liveTransforms.axis.aggregation'

function getDefaultApiUrl() {
  try {
    const v = localStorage.getItem(API_URL_KEY)
    if (v) return v
  } catch {}
  return 'http://127.0.0.1:8765'
}

function getDefaultWsUrl() {
  try {
    const v = localStorage.getItem(WS_URL_KEY)
    if (v) return v
  } catch {}

  try {
    const cfg = globalThis.__STONEGATE_CONFIG__
    if (cfg && typeof cfg.ws_url === 'string' && cfg.ws_url) return cfg.ws_url
  } catch {}

  return 'ws://localhost:8080/status'
}

function nowIso() {
  return new Date().toISOString()
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n))
}

// Simple per-device history buffer: samples { ts, measurements }
const buffers = new Map()
const MAX_SAMPLES = 2500

function addSample(deviceId, numericMeasurements, ts = Date.now()) {
  const arr = buffers.get(deviceId) || []
  arr.push({ ts, measurements: numericMeasurements })
  if (arr.length > MAX_SAMPLES) arr.splice(0, arr.length - MAX_SAMPLES)
  buffers.set(deviceId, arr)
}

function metricsFor(deviceId) {
  const arr = buffers.get(deviceId) || []
  for (let i = arr.length - 1; i >= 0; i--) {
    const keys = Object.keys(arr[i].measurements || {})
    if (keys.length) return keys
  }
  return []
}

function getSeries(deviceId, metric, seconds) {
  const arr = buffers.get(deviceId) || []
  const end = Date.now()
  const start = end - seconds * 1000
  const out = []
  for (const s of arr) {
    if (s.ts < start) continue
    if (s.ts > end) continue
    const v = (s.measurements || {})[metric]
    out.push({ x: s.ts, y: typeof v === 'number' ? v : null })
  }
  return out
}

function drawLine(canvas, points, opts) {
  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#04121d'
  ctx.fillRect(0, 0, w, h)

  const pad = 34
  const usableW = w - pad * 2
  const usableH = h - pad * 2

  // grid
  ctx.strokeStyle = 'rgba(80, 200, 120, 0.08)'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = pad + (usableH * i) / 4
    ctx.beginPath()
    ctx.moveTo(pad, y)
    ctx.lineTo(w - pad, y)
    ctx.stroke()
  }

  const clean = points.filter((p) => typeof p.y === 'number')
  if (clean.length < 2) {
    ctx.fillStyle = '#88a2b9'
    ctx.font = '12px sans-serif'
    ctx.fillText('No data', pad, pad)
    return
  }

  const xs = clean.map((p) => p.x)
  const ys = clean.map((p) => p.y)
  const xmin = Math.min(...xs)
  const xmax = Math.max(...xs)
  const ymin0 = Math.min(...ys)
  const ymax0 = Math.max(...ys)
  const ymin = ymin0 === ymax0 ? ymin0 - 0.5 : ymin0
  const ymax = ymin0 === ymax0 ? ymax0 + 0.5 : ymax0

  const toX = (x) => pad + ((x - xmin) / (xmax - xmin || 1)) * usableW
  const toY = (y) => pad + (1 - (y - ymin) / (ymax - ymin || 1)) * usableH

  ctx.strokeStyle = opts?.color || '#00ff88'
  ctx.lineWidth = 2
  ctx.beginPath()
  let first = true
  for (const p of clean) {
    const x = toX(p.x)
    const y = toY(p.y)
    if (first) {
      ctx.moveTo(x, y)
      first = false
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()

  ctx.fillStyle = '#6f8aa5'
  ctx.font = '11px sans-serif'
  if (opts?.xLabel) ctx.fillText(String(opts.xLabel), pad, h - 10)
  if (opts?.yLabel) ctx.fillText(String(opts.yLabel), 10, pad)
}

function drawCustom(canvas, out) {
  if (typeof out?.draw === 'function') {
    out.draw(canvas)
    return
  }

  const ctx = canvas.getContext('2d')
  const w = canvas.width
  const h = canvas.height

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#04121d'
  ctx.fillRect(0, 0, w, h)

  ctx.fillStyle = '#88a2b9'
  ctx.font = '12px sans-serif'
  ctx.fillText('No custom renderer', 18, 24)
}

const builtin = {
  name: 'builtin',
  ui: {
    usesApiUrl: false,
    usesAxes: false,
  },
  transforms: [
    { id: 'none', label: 'None (identity)' },
    { id: 'running_avg', label: 'Running average' },
    { id: 'fft', label: 'Fourier (magnitude)' },
    { id: 'psd', label: 'Power spectral density' },
  ],
  transform(ctx) {
    if (ctx.transformId === 'none') {
      return { kind: 'time', points: ctx.points, xLabel: 'Time (ms)', yLabel: ctx.metric }
    }

    if (ctx.transformId === 'running_avg') {
      const w = clamp(Number(ctx.avgWindow || 12) | 0, 1, 500)
      let sum = 0
      const q = []
      const out = []
      for (const p of ctx.points) {
        if (typeof p.y !== 'number') continue
        q.push(p.y)
        sum += p.y
        if (q.length > w) sum -= q.shift()
        out.push({ x: p.x, y: sum / q.length })
      }
      return { kind: 'time', points: out, xLabel: 'Time (ms)', yLabel: `${ctx.metric} (avg)` }
    }

    // Basic DFT for demo purposes.
    const clean = ctx.points.filter((p) => typeof p.y === 'number')
    const maxN = 256
    if (clean.length < 8) return { kind: 'freq', points: [], xLabel: 'Hz', yLabel: 'mag' }

    const take = Math.min(maxN, clean.length)
    const stride = Math.max(1, Math.floor(clean.length / take))
    const windowed = clean.filter((_, i) => i % stride === 0).slice(-take)

    const values = windowed.map((p) => p.y)
    const times = windowed.map((p) => p.x)

    const diffs = []
    for (let i = 1; i < times.length; i++) diffs.push(times[i] - times[i - 1])
    diffs.sort((a, b) => a - b)
    const dtMs = diffs.length ? diffs[(diffs.length / 2) | 0] : 0
    const dt = dtMs / 1000
    if (!(dt > 0)) return { kind: 'freq', points: [], xLabel: 'Hz', yLabel: 'mag' }

    let nfft = 1
    while (nfft < values.length) nfft *= 2
    nfft = Math.min(256, nfft)

    const padded = new Array(nfft).fill(0)
    for (let i = 0; i < Math.min(values.length, nfft); i++) padded[i] = values[i]

    const half = (nfft / 2) | 0
    const out = []
    const twoPiOverN = (2 * Math.PI) / nfft

    for (let k = 0; k <= half; k++) {
      let re = 0
      let im = 0
      for (let n = 0; n < nfft; n++) {
        const ang = -twoPiOverN * k * n
        const x = padded[n]
        re += x * Math.cos(ang)
        im += x * Math.sin(ang)
      }
      const mag = Math.sqrt(re * re + im * im) / nfft
      const freq = k / (dt * nfft)
      const y = ctx.transformId === 'psd' ? mag * mag : mag
      out.push({ x: freq, y })
    }

    return { kind: 'freq', points: out, xLabel: 'Frequency (Hz)', yLabel: ctx.transformId === 'psd' ? 'PSD' : 'Magnitude' }
  },
}

let plugin = builtin
let customScript = null
let customScriptLabel = ''
let lastCustomFile = null

const els = {
  wsBadge: document.getElementById('wsBadge'),
  wsUrl: document.getElementById('wsUrl'),
  apiUrl: document.getElementById('apiUrl'),
  scriptApiRow: document.getElementById('scriptApiRow'),
  connectBtn: document.getElementById('connectBtn'),
  disconnectBtn: document.getElementById('disconnectBtn'),
  status: document.getElementById('status'),
  deviceSel: document.getElementById('deviceSel'),
  metricSel: document.getElementById('metricSel'),
  xDeviceSel: document.getElementById('xDeviceSel'),
  xMetricSel: document.getElementById('xMetricSel'),
  yDeviceSel: document.getElementById('yDeviceSel'),
  yMetricSel: document.getElementById('yMetricSel'),
  zDeviceSel: document.getElementById('zDeviceSel'),
  zMetricSel: document.getElementById('zMetricSel'),
  axisAggSel: document.getElementById('axisAggSel'),
  scriptAxesRow: document.getElementById('scriptAxesRow'),
  scriptExtraControls: document.getElementById('scriptExtraControls'),
  rangeSec: document.getElementById('rangeSec'),
  refreshHz: document.getElementById('refreshHz'),
  pluginSel: document.getElementById('pluginSel'),
  transformSel: document.getElementById('transformSel'),
  reloadScriptsBtn: document.getElementById('reloadScriptsBtn'),
  refreshScriptBtn: document.getElementById('refreshScriptBtn'),
  pluginFile: document.getElementById('pluginFile'),
  liveCanvas: document.getElementById('liveCanvas'),
  xformCanvas: document.getElementById('xformCanvas'),
  liveMeta: document.getElementById('liveMeta'),
  xformMeta: document.getElementById('xformMeta'),
}

els.wsUrl.value = getDefaultWsUrl()
if (els.apiUrl) {
  els.apiUrl.value = getDefaultApiUrl()
  els.apiUrl.onchange = () => {
    try { localStorage.setItem(API_URL_KEY, String(els.apiUrl.value || '')) } catch {}
  }
}
els.wsBadge.textContent = `default ws: ${els.wsUrl.value}`

if (els.axisAggSel) {
  let desired = 'mean'
  try {
    const last = localStorage.getItem(AX_AGG_KEY)
    if (last) desired = String(last)
  } catch {}
  const allowed = new Set(['mean', 'latest'])
  els.axisAggSel.value = allowed.has(desired) ? desired : 'mean'
  els.axisAggSel.onchange = () => {
    try { localStorage.setItem(AX_AGG_KEY, String(els.axisAggSel.value || 'mean')) } catch {}
  }
}

function clearScriptExtraControls() {
  if (!els.scriptExtraControls) return
  els.scriptExtraControls.innerHTML = ''
}

function getPluginUi(p, selectedScriptId) {
  const ui = p && typeof p === 'object' ? p.ui : null
  if (ui && typeof ui === 'object') {
    return {
      usesApiUrl: Boolean(ui.usesApiUrl),
      usesAxes: Boolean(ui.usesAxes),
    }
  }

  // Heuristic: custom scripts are likely to want advanced controls.
  if (selectedScriptId === '__custom__') {
    return { usesApiUrl: true, usesAxes: true }
  }

  return { usesApiUrl: false, usesAxes: false }
}

function applyScriptUi() {
  const selectedScriptId = String(els.pluginSel?.value || '__builtin__')
  const ui = getPluginUi(plugin, selectedScriptId)

  if (els.scriptApiRow) {
    els.scriptApiRow.style.display = ui.usesApiUrl ? 'contents' : 'none'
  }
  if (els.scriptAxesRow) {
    els.scriptAxesRow.style.display = ui.usesAxes ? 'flex' : 'none'
  }

  clearScriptExtraControls()

  // Optional extension point: scripts may render their own per-script controls.
  try {
    if (els.scriptExtraControls && typeof plugin?.renderControls === 'function') {
      plugin.renderControls(els.scriptExtraControls)
    }
  } catch {
    // Best-effort: ignore control render errors
  }
}

function setStatus(s) {
  els.status.textContent = s
}

function updateTransformOptions() {
  els.transformSel.innerHTML = ''
  const list = Array.isArray(plugin.transforms) ? plugin.transforms : []
  for (const t of list) {
    const opt = document.createElement('option')
    opt.value = t.id
    opt.textContent = `${t.label}`
    els.transformSel.appendChild(opt)
  }

  // Try to restore last transform selection.
  try {
    const last = localStorage.getItem(TRANSFORM_ID_KEY)
    if (last && list.some((t) => String(t.id) === String(last))) {
      els.transformSel.value = String(last)
    }
  } catch {}
}

updateTransformOptions()
applyScriptUi()

let packagedPlugins = []

function getCurrentScriptLabel() {
  try {
    const id = String(els.pluginSel?.value || '__builtin__')
    if (id === '__custom__') return customScriptLabel || 'Custom'
    if (id === '__builtin__') return 'Built-in scripts'
    const opt = Array.from(els.pluginSel?.options || []).find((o) => o.value === id)
    return opt?.textContent || id
  } catch {
    return customScriptLabel || plugin?.name || 'Script'
  }
}

function renderScriptMenu({ preserveSelection = true } = {}) {
  const prev = preserveSelection ? String(els.pluginSel?.value || '__builtin__') : '__builtin__'

  els.pluginSel.innerHTML = ''

  const optBuiltin = document.createElement('option')
  optBuiltin.value = '__builtin__'
  optBuiltin.textContent = 'Built-in scripts'
  els.pluginSel.appendChild(optBuiltin)

  if (customScript) {
    const optCustom = document.createElement('option')
    optCustom.value = '__custom__'
    optCustom.textContent = customScriptLabel ? `Custom: ${customScriptLabel}` : 'Custom'
    els.pluginSel.appendChild(optCustom)
  }

  for (const p of packagedPlugins) {
    const id = String(p?.id || '')
    const label = String(p?.label || id)
    if (!id) continue
    const opt = document.createElement('option')
    opt.value = id
    opt.textContent = label
    els.pluginSel.appendChild(opt)
  }

  const available = new Set(Array.from(els.pluginSel.options).map((o) => o.value))
  els.pluginSel.value = available.has(prev) ? prev : '__builtin__'
}

async function importModuleFresh(url) {
  const u = new URL(url, window.location.href)
  u.searchParams.set('_t', String(Date.now()))
  return await import(u.toString())
}

async function loadPackagedPlugins() {
  // Source-of-truth: tools/live-transform-demo/plugins/manifest.json
  // Served path: /tools/live-transform-demo/plugins/manifest.json
  try {
    const resp = await fetch('./plugins/manifest.json', { cache: 'no-store' })
    if (!resp.ok) throw new Error(`manifest HTTP ${resp.status}`)
    const json = await resp.json()
    const list = Array.isArray(json?.plugins) ? json.plugins : []
    packagedPlugins = list
  } catch {
    packagedPlugins = []
  }

  // Restore last selection if possible.
  let desired = '__builtin__'
  try {
    const last = localStorage.getItem(SCRIPT_ID_KEY)
    if (last) desired = String(last)
  } catch {}

  renderScriptMenu({ preserveSelection: false })

  // If we don't have a custom script loaded, don't stick on __custom__.
  if (desired === '__custom__' && !customScript) desired = '__builtin__'

  const available = new Set(Array.from(els.pluginSel.options).map((o) => o.value))
  els.pluginSel.value = available.has(desired) ? desired : '__builtin__'
}

async function initScriptSelection() {
  await loadPackagedPlugins()
  try {
    await activatePackagedPlugin(String(els.pluginSel.value || '__builtin__'))
  } catch {
    els.pluginSel.value = '__builtin__'
    plugin = builtin
    updateTransformOptions()
    applyScriptUi()
  }
}

async function activatePackagedPlugin(id) {
  if (!id || id === '__builtin__') {
    plugin = builtin
    updateTransformOptions()
    applyScriptUi()
    return
  }

  if (id === '__custom__') {
    plugin = customScript || builtin
    updateTransformOptions()
    applyScriptUi()
    return
  }

  const found = packagedPlugins.find((p) => String(p?.id || '') === String(id))
  if (!found) return

  const moduleRel = String(found?.module || '')
  if (!moduleRel) return

  // Module path is relative to /tools/live-transform-demo/plugins/
  const url = new URL(moduleRel, new URL('./plugins/', window.location.href)).toString()
  const mod = await import(url)
  const next = mod?.default || mod
  if (!next || typeof next.transform !== 'function') throw new Error('Script must export transform(ctx)')
  plugin = next
  updateTransformOptions()
  applyScriptUi()
}

async function activatePackagedPluginFresh(id) {
  if (!id || id === '__builtin__') {
    plugin = builtin
    updateTransformOptions()
    applyScriptUi()
    return
  }

  if (id === '__custom__') {
    plugin = customScript || builtin
    updateTransformOptions()
    applyScriptUi()
    return
  }

  const found = packagedPlugins.find((p) => String(p?.id || '') === String(id))
  if (!found) return

  const moduleRel = String(found?.module || '')
  if (!moduleRel) return

  const url = new URL(moduleRel, new URL('./plugins/', window.location.href)).toString()
  const mod = await importModuleFresh(url)
  const next = mod?.default || mod
  if (!next || typeof next.transform !== 'function') throw new Error('Script must export transform(ctx)')
  plugin = next
  updateTransformOptions()
  applyScriptUi()
}

async function reloadScriptMenu() {
  await loadPackagedPlugins()
  renderScriptMenu({ preserveSelection: true })
}

async function refreshCurrentScript() {
  const id = String(els.pluginSel?.value || '__builtin__')
  if (id === '__builtin__') {
    plugin = builtin
    updateTransformOptions()
    applyScriptUi()
    return
  }

  if (id === '__custom__') {
    if (!lastCustomFile) {
      alert('No custom script file selected yet.')
      return
    }

    const url = URL.createObjectURL(lastCustomFile)
    try {
      const mod = await import(url)
      const next = mod?.default || mod
      if (!next || typeof next.transform !== 'function') throw new Error('Script must export transform(ctx)')
      customScript = next
      customScriptLabel = String(next?.name || lastCustomFile?.name || '').trim()
      renderScriptMenu({ preserveSelection: true })
      plugin = next
      updateTransformOptions()
      applyScriptUi()
    } finally {
      URL.revokeObjectURL(url)
    }
    return
  }

  await activatePackagedPluginFresh(id)
}

els.pluginSel.onchange = async () => {
  try {
    clearScriptExtraControls()
    try { localStorage.setItem(SCRIPT_ID_KEY, String(els.pluginSel.value || '__builtin__')) } catch {}
    await activatePackagedPlugin(String(els.pluginSel.value || ''))
  } catch (e) {
    alert(String(e?.message || e))
    els.pluginSel.value = '__builtin__'
    try { localStorage.setItem(SCRIPT_ID_KEY, '__builtin__') } catch {}
    plugin = builtin
    updateTransformOptions()
    applyScriptUi()
  }
}

els.transformSel.onchange = () => {
  try { localStorage.setItem(TRANSFORM_ID_KEY, String(els.transformSel.value || 'none')) } catch {}
}

// Initialize packaged scripts + restore last selection.
initScriptSelection()

function pickFirstMetricForDevice(deviceId) {
  const ms = metricsFor(deviceId)
  return ms.length ? ms[0] : ''
}

function updateAxisDeviceOptions(ids) {
  const axes = [
    { axis: 'x', sel: els.xDeviceSel, deviceKey: AX_X_DEVICE_KEY, defaultIndex: 0 },
    { axis: 'y', sel: els.yDeviceSel, deviceKey: AX_Y_DEVICE_KEY, defaultIndex: 1 },
    { axis: 'z', sel: els.zDeviceSel, deviceKey: AX_Z_DEVICE_KEY, defaultIndex: 2 },
  ]

  for (const a of axes) {
    if (!a.sel) continue
    let desired = String(a.sel.value || '')
    try {
      const last = localStorage.getItem(a.deviceKey)
      if (last) desired = String(last)
    } catch {}

    a.sel.innerHTML = ''
    for (const id of ids) {
      const opt = document.createElement('option')
      opt.value = id
      opt.textContent = id
      a.sel.appendChild(opt)
    }

    if (desired && ids.includes(desired)) a.sel.value = desired
    else if (ids.length > a.defaultIndex) a.sel.value = ids[a.defaultIndex]
    else if (ids.length) a.sel.value = ids[0]
  }
}

function updateAxisMetricOptions() {
  const axes = [
    { devSel: els.xDeviceSel, metSel: els.xMetricSel, metricKey: AX_X_METRIC_KEY },
    { devSel: els.yDeviceSel, metSel: els.yMetricSel, metricKey: AX_Y_METRIC_KEY },
    { devSel: els.zDeviceSel, metSel: els.zMetricSel, metricKey: AX_Z_METRIC_KEY },
  ]

  for (const a of axes) {
    if (!a.devSel || !a.metSel) continue
    const deviceId = String(a.devSel.value || '')
    const ms = metricsFor(deviceId)
    let desired = String(a.metSel.value || '')
    try {
      const last = localStorage.getItem(a.metricKey)
      if (last) desired = String(last)
    } catch {}

    a.metSel.innerHTML = ''
    for (const m of ms) {
      const opt = document.createElement('option')
      opt.value = m
      opt.textContent = m
      a.metSel.appendChild(opt)
    }

    if (desired && ms.includes(desired)) a.metSel.value = desired
    else if (ms.length) a.metSel.value = ms[0]
  }
}

function updateDeviceOptions() {
  const ids = Array.from(buffers.keys()).sort()
  const current = els.deviceSel.value
  els.deviceSel.innerHTML = ''
  for (const id of ids) {
    const opt = document.createElement('option')
    opt.value = id
    opt.textContent = id
    els.deviceSel.appendChild(opt)
  }
  if (current && ids.includes(current)) els.deviceSel.value = current
  else if (ids.length) els.deviceSel.value = ids[0]

  updateAxisDeviceOptions(ids)
}

function updateMetricOptions() {
  const deviceId = els.deviceSel.value
  const ms = metricsFor(deviceId)
  const current = els.metricSel.value
  els.metricSel.innerHTML = ''
  for (const m of ms) {
    const opt = document.createElement('option')
    opt.value = m
    opt.textContent = m
    els.metricSel.appendChild(opt)
  }
  if (current && ms.includes(current)) els.metricSel.value = current
  else if (ms.length) els.metricSel.value = ms[0]

  updateAxisMetricOptions()
}

let ws = null

function connect() {
  if (ws) return
  const url = String(els.wsUrl.value || '').trim()
  if (!url) return
  try { localStorage.setItem(WS_URL_KEY, url) } catch {}

  setStatus('connecting…')
  ws = new WebSocket(url)
  ws.onopen = () => {
    setStatus(`connected @ ${nowIso()}`)
    els.wsBadge.textContent = `ws: ${url}`
  }
  ws.onclose = () => {
    setStatus('disconnected')
    ws = null
  }
  ws.onerror = () => {
    setStatus('error')
    try { ws?.close() } catch {}
  }
  ws.onmessage = (ev) => {
    let raw
    try { raw = JSON.parse(ev.data) } catch { return }

    // Mirror the frontend parsing strategy: accept batch updates or a legacy DeviceStatus.
    try {
      if (raw && Array.isArray(raw.updates)) {
        for (const u of raw.updates) {
          const deviceId = u?.id
          const measurement = u?.measurement
          if (typeof deviceId !== 'string') continue

          const shaped = measurement && typeof measurement === 'object' ? measurement : null
          let measurements = shaped?.measurements

          if (!measurements && shaped && !Array.isArray(shaped)) {
            const out = {}
            for (const k of Object.keys(shaped)) {
              const v = shaped[k]
              if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) out[k] = v
              else out[k] = { value: v }
            }
            measurements = out
          }

          const numeric = {}
          for (const k of Object.keys(measurements || {})) {
            const m = measurements[k]
            numeric[k] = m && typeof m.value === 'number' ? m.value : null
          }
          addSample(deviceId, numeric)
        }
      } else if (raw && typeof raw === 'object' && typeof raw.device_id === 'string') {
        const deviceId = raw.device_id
        const measurements = raw.measurements || {}
        const numeric = {}
        for (const k of Object.keys(measurements)) {
          const m = measurements[k]
          numeric[k] = m && typeof m.value === 'number' ? m.value : null
        }
        addSample(deviceId, numeric)
      }
    } catch {
      // ignore
    }

    updateDeviceOptions()
    updateMetricOptions()
  }
}

function disconnect() {
  if (!ws) return
  try { ws.close() } catch {}
}

els.connectBtn.onclick = connect
els.disconnectBtn.onclick = disconnect

els.deviceSel.onchange = () => updateMetricOptions()

if (els.xDeviceSel) {
  els.xDeviceSel.onchange = () => {
    try { localStorage.setItem(AX_X_DEVICE_KEY, String(els.xDeviceSel.value || '')) } catch {}
    // If metric is unset, pick first available.
    updateAxisMetricOptions()
    if (els.xMetricSel && !els.xMetricSel.value) {
      const m = pickFirstMetricForDevice(String(els.xDeviceSel.value || ''))
      if (m) els.xMetricSel.value = m
    }
    try { localStorage.setItem(AX_X_METRIC_KEY, String(els.xMetricSel?.value || '')) } catch {}
  }
}
if (els.yDeviceSel) {
  els.yDeviceSel.onchange = () => {
    try { localStorage.setItem(AX_Y_DEVICE_KEY, String(els.yDeviceSel.value || '')) } catch {}
    updateAxisMetricOptions()
    if (els.yMetricSel && !els.yMetricSel.value) {
      const m = pickFirstMetricForDevice(String(els.yDeviceSel.value || ''))
      if (m) els.yMetricSel.value = m
    }
    try { localStorage.setItem(AX_Y_METRIC_KEY, String(els.yMetricSel?.value || '')) } catch {}
  }
}
if (els.zDeviceSel) {
  els.zDeviceSel.onchange = () => {
    try { localStorage.setItem(AX_Z_DEVICE_KEY, String(els.zDeviceSel.value || '')) } catch {}
    updateAxisMetricOptions()
    if (els.zMetricSel && !els.zMetricSel.value) {
      const m = pickFirstMetricForDevice(String(els.zDeviceSel.value || ''))
      if (m) els.zMetricSel.value = m
    }
    try { localStorage.setItem(AX_Z_METRIC_KEY, String(els.zMetricSel?.value || '')) } catch {}
  }
}
if (els.xMetricSel) els.xMetricSel.onchange = () => { try { localStorage.setItem(AX_X_METRIC_KEY, String(els.xMetricSel.value || '')) } catch {} }
if (els.yMetricSel) els.yMetricSel.onchange = () => { try { localStorage.setItem(AX_Y_METRIC_KEY, String(els.yMetricSel.value || '')) } catch {} }
if (els.zMetricSel) els.zMetricSel.onchange = () => { try { localStorage.setItem(AX_Z_METRIC_KEY, String(els.zMetricSel.value || '')) } catch {} }

els.pluginFile.onchange = async () => {
  const file = els.pluginFile.files?.[0]
  if (!file) return
  try {
    clearScriptExtraControls()
    lastCustomFile = file
    const url = URL.createObjectURL(file)
    const mod = await import(url)
    URL.revokeObjectURL(url)

    const next = mod?.default || mod
    if (!next || typeof next.transform !== 'function') {
      alert('Script must export transform(ctx)')
      return
    }

    customScript = next
    customScriptLabel = String(next?.name || file?.name || '').trim()
    renderScriptMenu({ preserveSelection: false })
    els.pluginSel.value = '__custom__'
    try { localStorage.setItem(SCRIPT_ID_KEY, '__custom__') } catch {}

    plugin = next
    updateTransformOptions()
    applyScriptUi()
  } catch (e) {
    alert(String(e?.message || e))
  }
}

if (els.reloadScriptsBtn) {
  els.reloadScriptsBtn.onclick = async () => {
    try {
      await reloadScriptMenu()
      await activatePackagedPlugin(String(els.pluginSel?.value || '__builtin__'))
    } catch (e) {
      alert(String(e?.message || e))
    }
  }
}

if (els.refreshScriptBtn) {
  els.refreshScriptBtn.onclick = async () => {
    try {
      await refreshCurrentScript()
    } catch (e) {
      alert(String(e?.message || e))
    }
  }
}

let raf = 0
function tick() {
  raf = 0

  const deviceId = els.deviceSel.value
  const metric = els.metricSel.value
  const rangeSec = clamp(Number(els.rangeSec.value || 30), 1, 600)
  const refreshHz = clamp(Number(els.refreshHz.value || 2), 0.2, 30)

  const live = getSeries(deviceId, metric, rangeSec)
  drawLine(els.liveCanvas, live, { color: '#00ff88', xLabel: 'Time (ms)', yLabel: metric })

  const transformId = String(els.transformSel.value || 'none')

  const allDeviceIds = Array.from(buffers.keys()).sort()

  const ctx = {
    deviceId,
    metric,
    rangeSec,
    sampleRateHz: refreshHz,
    transformId,
    avgWindow: 12,
    points: live.filter(p => typeof p.y === 'number'),
    apiUrl: String(els.apiUrl?.value || '').trim(),
    wsUrl: String(els.wsUrl?.value || '').trim(),
    allDeviceIds,
    getSeries,
    metricsFor,
    axes: {
      x: { deviceId: String(els.xDeviceSel?.value || ''), metric: String(els.xMetricSel?.value || '') },
      y: { deviceId: String(els.yDeviceSel?.value || ''), metric: String(els.yMetricSel?.value || '') },
      z: { deviceId: String(els.zDeviceSel?.value || ''), metric: String(els.zMetricSel?.value || '') },
      aggregation: String(els.axisAggSel?.value || 'mean'),
    },
  }

  let out
  try {
    out = plugin.transform(ctx)
  } catch (e) {
    out = { kind: 'time', points: [], xLabel: 'x', yLabel: 'y', error: String(e?.message || e) }
  }

  if (out?.kind === 'custom') {
    drawCustom(els.xformCanvas, out)
  } else {
    const points = Array.isArray(out?.points) ? out.points : []
    const xLabel = out?.xLabel || (out?.kind === 'freq' ? 'Frequency (Hz)' : 'Time')
    const yLabel = out?.yLabel || ''
    drawLine(els.xformCanvas, points, { color: '#7aa2ff', xLabel, yLabel })
  }

  els.liveMeta.textContent = deviceId ? `${deviceId} • ${metric} • ${rangeSec}s` : ''
  els.xformMeta.textContent = `${getCurrentScriptLabel()} • ${transformId}${out?.error ? ` • ERROR: ${out.error}` : ''}`

  setTimeout(() => {
    if (!raf) raf = requestAnimationFrame(tick)
  }, Math.round(1000 / refreshHz))
}

tick()

// Auto-connect by default.
connect()
