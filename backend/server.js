const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')
const { v4: uuidv4 } = require('uuid')

const DEVICE_GRAPH_PATH = path.resolve(__dirname, '../shared/protocol/DeviceGraph.json')
const COMPONENT_SCHEMA_PATH = path.resolve(__dirname, '../shared/protocol/ComponentSchema.json')

const config = JSON.parse(fs.readFileSync(DEVICE_GRAPH_PATH, 'utf8'))
const schema = JSON.parse(fs.readFileSync(COMPONENT_SCHEMA_PATH, 'utf8'))

const http = require('http')
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080

// Create a simple HTTP server so we can expose REST endpoints (e.g. /api/recordings)
const server = http.createServer(async (req, res) => {
  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  // Serve recordings files: GET /backend/recordings/<filename>
  if (req.method === 'GET' && req.url.startsWith('/backend/recordings/')) {
    try {
      const fname = decodeURIComponent(req.url.replace('/backend/recordings/', ''))
      const recDir = path.resolve(__dirname, 'recordings')
      const full = path.join(recDir, fname)
      if (!fs.existsSync(full)) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        return res.end(JSON.stringify({ ok:false, error: 'file not found' }))
      }
      const stat = fs.statSync(full)
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${path.basename(full)}"`
      })
      const stream = fs.createReadStream(full)
      stream.pipe(res)
      return
    } catch (err) {
      return resEndJson(res, 500, { ok:false, error: String(err) })
    }
  }

  // POST /api/recordings - accept CSV or JSON rows/objects and save to disk
  if (req.method === 'POST' && req.url === '/api/recordings') {
    try {
      let body = ''
      for await (const chunk of req) body += chunk

      // If content-type is text/csv, treat body as CSV directly
      const ct = (req.headers['content-type'] || '').toLowerCase()
      let csv = null
      let filename = null
      if (ct.includes('text/csv')) {
        csv = body
      } else if (ct.includes('application/json') || body.trim().startsWith('{') || body.trim().startsWith('[')) {
        const obj = JSON.parse(body || '{}')
        filename = obj.filename || obj.name || null
        if (typeof obj.csv === 'string') {
          csv = obj.csv
        } else if (Array.isArray(obj.rows)) {
          // rows can be array of arrays or array of objects
          if (obj.rows.length === 0) csv = ''
          else if (Array.isArray(obj.rows[0])) {
            csv = obj.rows.map(r => r.map(v => `${v}`).join(',')).join('\n')
          } else {
            // array of objects: derive header union
            const keys = Array.from(obj.rows.reduce((s, r) => { Object.keys(r).forEach(k=>s.add(k)); return s }, new Set()))
            const lines = [keys.join(',')]
            for (const row of obj.rows) {
              lines.push(keys.map(k => (row[k] === undefined || row[k] === null) ? '' : `${row[k]}`).join(','))
            }
            csv = lines.join('\n')
          }
        } else {
          return resEndJson(res, 400, { ok:false, error: 'no csv or rows provided' })
        }
      } else {
        return resEndJson(res, 400, { ok:false, error: 'unsupported content-type' })
      }

      // ensure recordings dir
      const recDir = path.resolve(__dirname, 'recordings')
      if (!fs.existsSync(recDir)) fs.mkdirSync(recDir, { recursive: true })

      const ts = (new Date()).toISOString().replace(/[:.]/g,'-')
      const outName = filename ? sanitizeFilename(filename) : `recording_${ts}.csv`
      const outPath = path.join(recDir, outName)
      fs.writeFileSync(outPath, csv, 'utf8')
      console.log(`Saved recording to ${outPath}`)
      return resEndJson(res, 200, { ok:true, path: `/backend/recordings/${outName}`, saved: outPath })
    } catch (err) {
      console.error('Error saving recording:', err)
      return resEndJson(res, 500, { ok:false, error: String(err) })
    }
  }

  // GET /api/recordings - list saved recordings
  if (req.method === 'GET' && req.url === '/api/recordings') {
    try {
      const recDir = path.resolve(__dirname, 'recordings')
      if (!fs.existsSync(recDir)) return resEndJson(res, 200, { ok:true, recordings: [] })
      const files = fs.readdirSync(recDir).filter(f => !f.startsWith('.'))
      const info = files.map(f => ({ name: f, path: `/backend/recordings/${f}` }))
      return resEndJson(res, 200, { ok:true, recordings: info })
    } catch (err) {
      return resEndJson(res, 500, { ok:false, error: String(err) })
    }
  }

  // Unknown route -> 404
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok:false, error: 'not found' }))
})

function resEndJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

function sanitizeFilename(name) {
  return name.replace(/[^A-Za-z0-9_\-.]/g, '_')
}

// attach WebSocket server to the HTTP server
const wss = new WebSocket.Server({ server, path: '/status' })

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
  console.log(`WebSocket backend simulator available at ws://localhost:${PORT}/status`)
})

let clients = new Set()

wss.on('connection', function connection(ws) {
  console.log('Client connected')
  clients.add(ws)
  ws.on('close', () => {
    clients.delete(ws)
    console.log('Client disconnected')
  })
})

// helper: random within range
function rand(n, r=0.05) {
  // n = nominal, r = relative jitter
  const jitter = (Math.random() * 2 - 1) * r * n
  return n + jitter
}

function generateMeasurement(prop) {
  // heuristics for starting values by property name
  prop = prop.toLowerCase()
  if (prop.includes('temp')) return { value: +(rand(4.2, 0.01)).toFixed(3), uncertainty: 0.01, unit: 'K' }
  if (prop.includes('count') || prop.includes('counts') || prop.includes('photon')) return { value: Math.max(0, Math.round(rand(1000, 0.2))), uncertainty: Math.max(1, Math.round(rand(5,0.5))), unit: 'counts' }
  if (prop.includes('power') || prop.includes('optical')) return { value: +(rand(12.0, 0.02)).toFixed(3), uncertainty: 0.1, unit: 'mW' }
  if (prop.includes('phase')) return { value: +(rand(0.25, 0.02)).toFixed(4), uncertainty: 0.001, unit: 'rad' }
  if (prop.includes('frequency')) return { value: +(rand(193.1e12, 1e-6)).toFixed(3), uncertainty: 1e8, unit: 'Hz' }
  if (prop.includes('dark')) return { value: +(rand(0.02, 0.3)).toFixed(4), uncertainty: 0.005, unit: 'Hz' }
  // default
  return { value: +(rand(1.0, 0.1)).toFixed(3), uncertainty: 0.1 }
}

// Build list of simulated devices from graph
const devices = (config.nodes || []).map(n => {
  const type = n.type
  const props = (schema[type] && schema[type].properties) || []
  return {
    id: n.id,
    type,
    label: n.label || n.id,
    properties: props
  }
})

function produceStatus(device) {
  const measurements = {}
  for (const p of device.properties) {
    measurements[p] = generateMeasurement(p)
  }
  // simple state machine: mostly nominal, occasional warning/faults
  const r = Math.random()
  const state = r < 0.95 ? 'nominal' : (r < 0.99 ? 'warning' : 'fault')
  return {
    device_id: device.id,
    state,
    measurements
  }
}

function broadcastAll() {
  if (clients.size === 0) return
  const timestamp = Date.now()
  for (const d of devices) {
    // mutate some measurements slightly over time
    const msg = produceStatus(d)
    // attach timestamp in each measurement
    for (const k of Object.keys(msg.measurements)) msg.measurements[k].ts = timestamp
    const text = JSON.stringify(msg)
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(text)
    }
  }
}

// broadcast every 500ms
setInterval(broadcastAll, 500)

// graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...')
  wss.close(() => process.exit(0))
})

// README (as string) - printed when run
console.log('\nSimulator initialized with devices:')
for (const d of devices) console.log(` - ${d.id} (${d.type})`)
console.log('\nBroadcasting status updates every 500ms to connected clients.')