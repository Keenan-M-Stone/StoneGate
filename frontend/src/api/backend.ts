import type { StatusUpdateMessage } from '../../../shared/protocol/MessageTypes'
import { useDeviceStore } from '../state/store'

const WS_URL = (import.meta.env.VITE_BACKEND_WS_URL as string) ?? 'ws://localhost:8080/status'

class BackendClient {
  ws: WebSocket | null = null
  connected = false

  connect() {
    if (this.ws) return
    this.ws = new WebSocket(WS_URL)
    this.ws.onopen = () => {
      this.connected = true
      console.log('WS connected')
    }
    this.ws.onmessage = ev => {
      try {
        const msg: StatusUpdateMessage = JSON.parse(ev.data)
        // update store
        const store = useDeviceStore.getState()
        store.upsertDevice(msg)
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
}

const Backend = new BackendClient()
export default Backend
