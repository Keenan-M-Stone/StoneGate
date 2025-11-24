import type { StatusUpdateMessage } from '../../../shared/protocol/MessageTypes'
import { useDeviceStore } from '../state/store'
import History from '../state/history'

const WS_URL = (import.meta.env.VITE_BACKEND_WS_URL as string) ?? 'ws://localhost:8080/status'

class BackendClient {
  ws: WebSocket | null = null
  connected = false
  messagesSent = 0
  messagesReceived = 0

  connect() {
    if (this.ws) return
    this.ws = new WebSocket(WS_URL)
    this.ws.onopen = () => {
      this.connected = true
      console.log('WS connected')
    }
    this.ws.onmessage = ev => {
      this.messagesReceived += 1
      try {
        const raw = JSON.parse(ev.data)
        const store = useDeviceStore.getState()
        // Support two message shapes:
        // 1) single DeviceStatus (legacy)
        // 2) batch: { type: 'measurement_update', updates: [{ id, measurement: { state, measurements } }, ...] }
        if (raw && Array.isArray(raw.updates)) {
          for (const u of raw.updates) {
            try {
              const device = {
                device_id: u.id,
                state: u.measurement?.state ?? 'unknown',
                measurements: u.measurement?.measurements ?? {}
              }
              store.upsertDevice(device)
              // capture numeric samples into history
              const numeric: Record<string, number | null> = {}
              for (const k of Object.keys(device.measurements || {})){
                const m = (device.measurements as any)[k]
                numeric[k] = (m && typeof m.value === 'number') ? m.value : null
              }
              History.addSample(u.id, numeric)
            } catch (e) {
              console.error('Failed to apply update entry', e)
            }
          }
        } else {
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

  stats() {
    return { endpoint: WS_URL, connected: this.connected, sent: this.messagesSent, received: this.messagesReceived }
  }
}

const Backend = new BackendClient()
export default Backend
