import type { StatusUpdateMessage } from '../../../shared/protocol/MessageTypes'
import { useDeviceStore } from '../state/store'
import History from '../state/history'

const WS_URL_KEY = 'stonegate.ws_url'

function getWsUrl() {
  try {
    const v = localStorage.getItem(WS_URL_KEY)
    if (v && typeof v === 'string') return v
  } catch {}
  return ((import.meta.env.VITE_BACKEND_WS_URL as string) ?? 'ws://localhost:8080/status') as string
}

class BackendClient {
  ws: WebSocket | null = null
  connected = false
  messagesSent = 0
  messagesReceived = 0
  endpoint = getWsUrl()

  private pendingRpc = new Map<
    string,
    {
      resolve: (v: any) => void
      reject: (e: any) => void
      timeoutId: number
    }
  >()

  setEndpoint(url: string) {
    this.endpoint = url
    try { localStorage.setItem(WS_URL_KEY, url) } catch {}
  }

  connect() {
    if (this.ws) return
    this.ws = new WebSocket(this.endpoint)
    this.ws.onopen = () => {
      this.connected = true
      console.log('WS connected')
    }
    this.ws.onmessage = ev => {
      this.messagesReceived += 1
      try {
        const raw = JSON.parse(ev.data)

        const store = useDeviceStore.getState()

        // Discovery snapshot
        if (raw && typeof raw === 'object' && (raw as any).type === 'descriptor' && Array.isArray((raw as any).devices)) {
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
    this.ws.onclose = () => {
      this.connected = false
      this.ws = null
      console.log('WS disconnected')

      // Fail any pending RPCs.
      for (const [, p] of this.pendingRpc) {
        clearTimeout(p.timeoutId)
        p.reject(new Error('ws-disconnected'))
      }
      this.pendingRpc.clear()

      // try reconnect after delay
      setTimeout(() => this.connect(), 2000)
    }
    this.ws.onerror = (e) => {
      console.error('WS error', e)
      this.ws?.close()
    }
  }

  disconnect() {
    this.ws?.close()
    this.ws = null
    this.connected = false
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

    const resp = await new Promise<any>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.pendingRpc.delete(id)
        reject(new Error('rpc-timeout'))
      }, timeoutMs)

      this.pendingRpc.set(id, { resolve, reject, timeoutId })
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
    return { endpoint: this.endpoint, connected: this.connected, sent: this.messagesSent, received: this.messagesReceived }
  }
}

const Backend = new BackendClient()
export default Backend
