const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')
const { v4: uuidv4 } = require('uuid')

const DEVICE_GRAPH_PATH = path.resolve(__dirname, '../shared/protocol/DeviceGraph.json')
const COMPONENT_SCHEMA_PATH = path.resolve(__dirname, '../shared/protocol/ComponentSchema.json')

const config = JSON.parse(fs.readFileSync(DEVICE_GRAPH_PATH, 'utf8'))
const schema = JSON.parse(fs.readFileSync(COMPONENT_SCHEMA_PATH, 'utf8'))

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080

const wss = new WebSocket.Server({ port: PORT, path: '/status' })

console.log(`WebSocket backend simulator running on ws://localhost:${PORT}/status`)

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
