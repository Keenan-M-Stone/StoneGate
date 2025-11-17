import React from 'react'
import SchematicCanvas from './components/SchematicCanvas'
import { useDeviceStore } from './state/store'
import Backend from './api/backend'


export default function App() {
  // initialize websocket connection
  React.useEffect(() => {
    Backend.connect()
    return () => {
      Backend.disconnect()
    }
  }, [])


  const devices = useDeviceStore(s => s.devices)


  return (
    <div style={{ padding: 12, fontFamily: 'Inter, sans-serif' }}>
      <header style={{ marginBottom: 12 }}>
        <h2>Quantum Control — Diagnostic Schematic</h2>
        <div>Backend status: <strong>{Backend.connected ? 'Connected' : 'Disconnected'}</strong></div>
      </header>
      <SchematicCanvas />
        <footer style={{ marginTop: 12 }}>
        <small>Nodes show "NO SIGNAL" until backend sends updates.</small>
      </footer>
    </div>
  )
}