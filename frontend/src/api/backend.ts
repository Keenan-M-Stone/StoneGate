import type { StatusUpdateMessage } from '../../../shared/protocol/MessageTypes'
import { useDeviceStore } from '../state/store'
import History from '../state/history'
import { checkBackendCompatibility } from './compat'
import { logBackend, logFrontend } from '../state/logStore'

const WS_URL_KEY = 'stonegate.ws_url'
const BUILD_MODE_KEY = 'stonegate.build_mode'
const AUTO_BACKEND_SCHEM_KEY = 'stonegate.auto_backend_schematic'

type StoneGateRuntimeConfig = {
  ws_url?: string
  build_mode?: boolean
  auto_backend_schematic?: boolean
}

function getRuntimeConfig(): StoneGateRuntimeConfig {
  try {
    const cfg = (globalThis as any).__STONEGATE_CONFIG__
    if (cfg && typeof cfg === 'object') return cfg as StoneGateRuntimeConfig
  } catch {}
  return {}
}

function readFlag(key: string, fallback = false): boolean {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return fallback
    return v === 'true'
  } catch {
    // fallthrough
  }

  const cfg = getRuntimeConfig()
  if (key === BUILD_MODE_KEY && typeof cfg.build_mode === 'boolean') return cfg.build_mode
  if (key === AUTO_BACKEND_SCHEM_KEY && typeof cfg.auto_backend_schematic === 'boolean') return cfg.auto_backend_schematic
  return fallback
}

function getWsUrl() {
  try {
    const v = localStorage.getItem(WS_URL_KEY)
    if (v && typeof v === 'string') return v
  } catch {}

  const cfg = getRuntimeConfig()
  if (typeof cfg.ws_url === 'string' && cfg.ws_url) return cfg.ws_url

  return ((import.meta.env.VITE_BACKEND_WS_URL as string) ?? 'ws://localhost:8080/status') as string
}

function getDefaultWsUrl() {
  const cfg = getRuntimeConfig()
  if (typeof cfg.ws_url === 'string' && cfg.ws_url) return cfg.ws_url
  return ((import.meta.env.VITE_BACKEND_WS_URL as string) ?? 'ws://localhost:8080/status') as string
}

class BackendClient {
  ws: WebSocket | null = null
  connected = false
  messagesSent = 0
  messagesReceived = 0
  endpoint = getWsUrl()

  lastBackendInfo: any = null
  lastCompat: { ok: boolean; reason: string } | null = null

  private pendingRpc = new Map<
    string,
    {
      resolve: (v: any) => void
      reject: (e: any) => void
      timeoutId: number
      method: string
      startedAt: number
    }
  >()

  private recentRpc = new Map<string, { method: string; ts: number }>()

  private noteRpc(id: string, method: string) {
    const now = Date.now()
    this.recentRpc.set(id, { method, ts: now })
    // best-effort cleanup
    for (const [k, v] of this.recentRpc) {
      if (now - v.ts > 60_000) this.recentRpc.delete(k)
    }
  }

  setEndpoint(url: string) {
    this.endpoint = url
    try { localStorage.setItem(WS_URL_KEY, url) } catch {}

    logFrontend(`Connection changed to ${url}`)

    // Live-switch endpoints: drop current connection and reconnect.
    // Also clear any backend-derived schematic override so the UI doesn't
    // keep rendering a schematic from the old backend.
    try {
      const store = useDeviceStore.getState()
      store?.resetRuntimeState?.()
      if (store?.schematicOverride) store.setSchematicOverride(null)
    } catch {}

    this.disconnect()
    this.connect()
  }

  resetEndpointToDefault() {
    // Clear any persisted override so future builds/env defaults take effect.
    try { localStorage.removeItem(WS_URL_KEY) } catch {}

    this.endpoint = getDefaultWsUrl()
    logFrontend(`Connection reset to default (${this.endpoint})`)

    try {
      const store = useDeviceStore.getState()
      store?.resetRuntimeState?.()
      if (store?.schematicOverride) store.setSchematicOverride(null)
    } catch {}

    this.disconnect()
    this.connect()
  }

  connect() {
    if (this.ws) return
    const ws = new WebSocket(this.endpoint)
    this.ws = ws
    ws.onopen = () => {
      if (this.ws !== ws) return
      this.connected = true
      console.log('WS connected')
      logFrontend(`WS connected (${this.endpoint})`)

      // Probe backend.info to check protocol compatibility.
      this.rpc('backend.info', {}, 4000)
        .then(info => {
          this.lastBackendInfo = info
          this.lastCompat = checkBackendCompatibility(info?.protocol_version)

          // Build-mode only: optionally auto-load the backend schematic so the UI
          // follows the selected port/endpoint (useful for copying schematics between instances).
          const buildMode = readFlag(BUILD_MODE_KEY, false)
          const autoBackendSchematic = readFlag(AUTO_BACKEND_SCHEM_KEY, false)
          if (buildMode && autoBackendSchematic && this.lastCompat?.ok) {
            const caps = Array.isArray(info?.capabilities) ? info.capabilities : []
            if (caps.includes('graph.get')) {
              this.rpc('graph.get', { include_graph: true, include_schema: true }, 6000)
                .then(res => {
                  if (!res?.available) return
                  const store = useDeviceStore.getState()
                  store.setSchematicOverride({ graph: res.graph, schema: res.schema, meta: { ...res, source: 'backend', endpoint: this.endpoint } })
                  logFrontend('Auto-loaded backend schematic')
                })
                .catch(() => {
                  // Keep local schematic if graph.get fails.
                  logFrontend('Auto-load backend schematic failed', 'warn')
                })
            }
          }
        })
        .catch(e => {
          this.lastBackendInfo = null
          this.lastCompat = { ok: false, reason: String((e as any)?.message ?? e) }
          logBackend(`backend.info failed: ${String((e as any)?.message ?? e)}`, 'warn')
        })
    }
    ws.onmessage = ev => {
      if (this.ws !== ws) return
      this.messagesReceived += 1
      try {
        const raw = JSON.parse(ev.data)

        // Backend broadcast logs (if supported).
        if (raw && typeof raw === 'object' && (raw as any).type === 'backend.log') {
          const lvl = String((raw as any).level || 'info')
          const kind = String((raw as any).kind || 'event')
          const ts = String((raw as any).ts || '')
          const origin = String((raw as any).origin || '')
          const sessionId = String((raw as any).session_id || '')
          const rpcId = (raw as any).rpc_id
          const method = (raw as any).method
          const fields = (raw as any).fields

          const known = typeof rpcId === 'string' && this.recentRpc.has(rpcId)
          const ext = typeof rpcId === 'string' ? (known ? '' : ' (external)') : ''
          const parts: string[] = []
          parts.push(ts ? ts : new Date().toISOString())
          const prefix = origin ? `${origin}${sessionId ? `:${sessionId}` : ''}` : ''
          parts.push(prefix ? `${prefix} • ${kind}${ext}` : `${kind}${ext}`)
          if (typeof method === 'string' && method) parts.push(method)
          if (typeof rpcId === 'string' && rpcId) parts.push(rpcId)

          logBackend(parts.join(' • '), (lvl as any) || 'info', {
            kind,
            origin: origin || undefined,
            session_id: sessionId || undefined,
            rpc_id: typeof rpcId === 'string' ? rpcId : undefined,
            method: typeof method === 'string' ? method : undefined,
            fields: fields && typeof fields === 'object' ? fields : undefined,
          })
          return
        }

        const store = useDeviceStore.getState()

        // Discovery snapshot
        if (raw && typeof raw === 'object' && (raw as any).type === 'descriptor' && Array.isArray((raw as any).devices)) {
          logBackend(`descriptor snapshot • ${(raw as any).devices.length} devices`)
          for (const d of (raw as any).devices) {
            if (d && typeof d === 'object' && typeof d.id === 'string' && typeof d.type === 'string') {
              store.upsertDescriptor(d)
            }
          }
          return
        }

        // Non-measurement protocol messages (toolbox RPC / discovery)
        if (raw && typeof raw === 'object') {
          const t = (raw as any).type
          if (t === 'control_ack') return
          if (t === 'rpc_result') {
            const id = (raw as any).id
            if (typeof id === 'string') {
              const p = this.pendingRpc.get(id)
              if (p) {
                this.pendingRpc.delete(id)
                clearTimeout(p.timeoutId)
                p.resolve(raw)

                const dur = Math.max(0, Date.now() - p.startedAt)
                if ((raw as any).ok) logBackend(`rpc_result OK • ${p.method} • ${id} • ${dur}ms`)
                else logBackend(`rpc_result ERR • ${p.method} • ${id} • ${dur}ms`, 'warn')
              }
            }
            return
          }
        }

        // Support two message shapes:
        // 1) single DeviceStatus (legacy)
        // 2) batch: { type: 'measurement_update', updates: [{ id, measurement: { state, measurements } }, ...] }
        if (raw && Array.isArray(raw.updates)) {
          for (const u of raw.updates) {
            try {
              const deviceId = u.id
              const measurement = u.measurement

              // Prefer the structured shape, but also accept a flat { metric: value } object.
              const shaped = measurement && typeof measurement === 'object' ? (measurement as any) : null
              const state = shaped?.state ?? 'unknown'
              let measurements: any = shaped?.measurements

              if (!measurements && shaped && !Array.isArray(shaped)) {
                const meta = store.descriptors?.[deviceId]?.metrics ?? {}
                const out: any = {}
                for (const k of Object.keys(shaped)) {
                  const v = shaped[k]
                  if (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) out[k] = v
                  else out[k] = { value: v, unit: meta?.[k]?.unit }
                }
                measurements = out
              }

              store.upsertDevice({ device_id: deviceId, state, measurements } as any)
              // capture numeric samples into history
              const numeric: Record<string, number | null> = {}
              for (const k of Object.keys(measurements || {})){
                const m = (measurements as any)[k]
                numeric[k] = (m && typeof m.value === 'number') ? m.value : null
              }
              History.addSample(deviceId, numeric)
            } catch (e) {
              console.error('Failed to apply update entry', e)
            }
          }
        } else {
          // Only treat as DeviceStatus if it looks like one.
          if (!raw || typeof raw !== 'object' || typeof (raw as any).device_id !== 'string') return
          const msg: StatusUpdateMessage = raw
          store.upsertDevice(msg)
          const numeric: Record<string, number | null> = {}
          for (const k of Object.keys(msg.measurements || {})){
            const m = (msg as any).measurements[k]
            numeric[k] = (m && typeof m.value === 'number') ? m.value : null
          }
          History.addSample(msg.device_id, numeric)
        }
      } catch (e) {
        console.error('Invalid message', e)
      }
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.connected = false
      this.ws = null
      console.log('WS disconnected')
      logFrontend(`WS disconnected (${this.endpoint})`, 'warn')

      this.lastBackendInfo = null
      this.lastCompat = null

      // Avoid rendering a stale backend-derived schematic when disconnected.
      try {
        const store = useDeviceStore.getState()
        if (store?.schematicOverride) store.setSchematicOverride(null)
      } catch {}

      // Fail any pending RPCs.
      for (const [, p] of this.pendingRpc) {
        clearTimeout(p.timeoutId)
        p.reject(new Error('ws-disconnected'))
      }
      this.pendingRpc.clear()

      // try reconnect after delay
      setTimeout(() => this.connect(), 2000)
    }
    ws.onerror = (e) => {
      if (this.ws !== ws) return
      console.error('WS error', e)
      this.ws?.close()
    }
  }

  disconnect() {
    const ws = this.ws
    this.ws = null
    this.connected = false
    try { ws?.close() } catch {}
  }

  send(obj: any) {
    if (!this.ws) return false
    try {
      this.ws.send(JSON.stringify(obj))
      this.messagesSent += 1
      return true
    } catch (e) { return false }
  }

  async rpc(method: string, params: any = {}, timeoutMs = 10_000): Promise<any> {
    this.connect()
    if (!this.ws) throw new Error('ws-not-connected')

    const id = `rpc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    const req = { type: 'rpc', id, method, params: params ?? {} }

    this.noteRpc(id, method)
    logBackend(`rpc → ${method} • ${id}`)

    const resp = await new Promise<any>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingRpc.delete(id)
        reject(new Error('rpc-timeout'))
      }, timeoutMs)

      this.pendingRpc.set(id, { resolve, reject, timeoutId, method, startedAt: Date.now() })
      const ok = this.send(req)
      if (!ok) {
        clearTimeout(timeoutId)
        this.pendingRpc.delete(id)
        reject(new Error('send-failed'))
      }
    })

    if (!resp || typeof resp !== 'object') throw new Error('rpc-invalid-response')
    if (!resp.ok) {
      const err = (resp as any).error || {}
      const msg = String(err.message || 'RPC failed')
      const code = String(err.code || 'error')
      const details = err.details
      const e = new Error(`${code}: ${msg}`)
      ;(e as any).code = code
      ;(e as any).details = details
      throw e
    }
    return (resp as any).result
  }

  stats() {
    return {
      endpoint: this.endpoint,
      connected: this.connected,
      sent: this.messagesSent,
      received: this.messagesReceived,
      backendInfo: this.lastBackendInfo,
      compatibility: this.lastCompat,
    }
  }
}

const Backend = new BackendClient()
export default Backend
