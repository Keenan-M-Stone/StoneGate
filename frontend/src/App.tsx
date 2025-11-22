import React from 'react'
import SchematicCanvas from './components/SchematicCanvas'
import { useDeviceStore } from './state/store'
import Backend from './api/backend'
import ConnectionPanel from './components/ConnectionPanel'
import MacroEditor from './components/MacroEditor'
import SideMenu from './components/SideMenu'
import ComponentDialog from './components/SchematicCanvas/dialogs/ComponentDialog'


export default function App() {
  // initialize websocket connection
  React.useEffect(() => {
    Backend.connect()
    return () => {
      Backend.disconnect()
    }
  }, [])

  const devices = useDeviceStore(s => s.devices)

  const [selectedNode, setSelectedNode] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [buildMode, setBuildMode] = React.useState(false)
  const [showMacro, setShowMacro] = React.useState(false)

  const onSelectNode = (id?: string|null) => { setSelectedNode(id??null) }
  const onOpenDialog = (id:string) => { setSelectedNode(id); setDialogOpen(true) }


  return (
    <div style={{ padding: 12, fontFamily: 'Inter, sans-serif' }}>
      <header style={{ marginBottom: 12 }}>
        <h2>Quantum Control — Diagnostic Schematic</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div>Backend status: <strong>{Backend.connected ? 'Connected' : 'Disconnected'}</strong></div>
              <ConnectionPanel />
          </div>
      </header>
          <SchematicCanvas buildMode={buildMode} onSelectNode={onSelectNode} onOpenDialog={onOpenDialog} />
          <SideMenu buildMode={buildMode} setBuildMode={setBuildMode} showMacro={showMacro} setShowMacro={setShowMacro} />
          {showMacro && <MacroEditor />}
        {dialogOpen && selectedNode && (
          <div style={{ position: 'fixed', left: '50%', top: '10%', transform: 'translateX(-50%)', zIndex: 80 }}>
            <ComponentDialog id={selectedNode} status={devices[selectedNode]} schema={undefined} onClose={() => setDialogOpen(false)} />
          </div>
        )}
        <footer style={{ marginTop: 12 }}>
        <small>Nodes show "NO SIGNAL" until backend sends updates.</small>
      </footer>
    </div>
  )
}