#!/usr/bin/env node

// Smoke test: connect to a StoneGate backend and verify backend.log broadcasts flow.
// Usage:
//   node tools/diagnostics/backend-log-smoke.mjs ws://localhost:8080/status

const url = process.argv[2] || 'ws://localhost:8080/status'

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function newId() {
  return `smoke_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

async function main() {
  if (typeof WebSocket === 'undefined') {
    throw new Error('Global WebSocket not available in this Node runtime')
  }

  const ws = new WebSocket(url)

  /** @type {any[]} */
  const backendLogs = []

  ws.onopen = async () => {
    const id1 = newId()
    ws.send(JSON.stringify({ type: 'rpc', id: id1, method: 'backend.info', params: {} }))

    // Force a control-path log (still origin=ws, but kind=control.*)
    ws.send(JSON.stringify({ cmd: 'device_action' }))

    // Force an RPC-path log
    const id2 = newId()
    ws.send(JSON.stringify({ type: 'rpc', id: id2, method: 'devices.list', params: {} }))

    // Give it a moment, then print summary and exit.
    await sleep(900)
    ws.close()

    const byKind = new Map()
    for (const l of backendLogs) {
      const k = String(l.kind || 'unknown')
      byKind.set(k, (byKind.get(k) || 0) + 1)
    }

    console.log(`OK: received ${backendLogs.length} backend.log messages`) 
    for (const [k, n] of Array.from(byKind.entries()).sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
      console.log(`- ${k}: ${n}`)
    }

    if (backendLogs.length) {
      const sample = backendLogs[0]
      console.log('Sample:', {
        ts: sample.ts,
        ts_ms: sample.ts_ms,
        level: sample.level,
        origin: sample.origin,
        session_id: sample.session_id,
        kind: sample.kind,
      })
    }
  }

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data)
      if (msg && typeof msg === 'object' && msg.type === 'backend.log') {
        backendLogs.push(msg)
      }
    } catch {}
  }

  ws.onerror = (e) => {
    console.error('WebSocket error', e)
    process.exitCode = 2
  }

  ws.onclose = () => {
    // exit when closed
  }
}

main().catch(e => {
  console.error(String(e?.stack || e?.message || e))
  process.exitCode = 2
})
