// App.tsx
import React from 'react'
import SchematicCanvas from './components/SchematicCanvas'
import { useDeviceStore } from './state/store'
import Backend from './api/backend'
import ConnectionPanel from './components/ConnectionPanel'
import MacroEditor from './components/MacroEditor'
import SideMenu from './components/SideMenu'
import ComponentDialog from './components/SchematicCanvas/dialogs/ComponentDialog'
import InstanceManagerDialog from './components/InstanceManagerDialog'
import SnapshotDialog from './components/SnapshotDialog'
import SchematicsDialog from './components/SchematicsDialog'
import DiagnosticsWindow from './components/DiagnosticsWindow'
import InstallationWizardDialog from './components/InstallationWizardDialog'
import AppHelpDialog from './components/AppHelpDialog'


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
  const [buildMode, setBuildMode] = React.useState<boolean>(() => {
    try { return (localStorage.getItem('stonegate.build_mode') || 'false') === 'true' } catch { return false }
  })
  const [showMacro, setShowMacro] = React.useState(false)
  const [showInstanceManager, setShowInstanceManager] = React.useState(false)
  const [showSnapshots, setShowSnapshots] = React.useState(false)
  const [showSchematics, setShowSchematics] = React.useState(false)
  const [showDiagnostics, setShowDiagnostics] = React.useState(false)
  const [showInstallWizard, setShowInstallWizard] = React.useState(false)
  const [showHelp, setShowHelp] = React.useState(false)

  React.useEffect(() => {
    try { localStorage.setItem('stonegate.build_mode', buildMode ? 'true' : 'false') } catch {}
  }, [buildMode])

  const onSelectNode = (id?: string|null) => { setSelectedNode(id??null) }
  const onOpenDialog = (id:string) => { setSelectedNode(id); setDialogOpen(true) }


  return (
    <div style={{ padding: 12, fontFamily: 'Inter, sans-serif' }}>
      <header style={{ marginBottom: 12 }}>
        <h2> Stone Gate: Quantum Control - Diagnostic Schematic </h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {/* There's really no harm in just making the port selectable */}
              <div> Backend status: <strong>{Backend.connected ? 'Connected' : 'Disconnected'}</strong></div>
                <ConnectionPanel buildMode={buildMode} />
          </div>
      </header>
          <SchematicCanvas buildMode={buildMode} onSelectNode={onSelectNode} onOpenDialog={onOpenDialog} />
          <SideMenu
            buildMode={buildMode}
            setBuildMode={setBuildMode}
            showMacro={showMacro}
            setShowMacro={setShowMacro}
            onOpenInstanceManager={() => setShowInstanceManager(true)}
            onOpenInstallWizard={() => setShowInstallWizard(true)}
            onOpenSnapshots={() => setShowSnapshots(true)}
            onOpenSchematics={() => setShowSchematics(true)}
            onOpenDiagnostics={() => setShowDiagnostics(true)}
            onOpenHelp={() => setShowHelp(true)}
          />
          {showMacro && <MacroEditor />}
          {showDiagnostics && <DiagnosticsWindow onClose={() => setShowDiagnostics(false)} />}
          <InstanceManagerDialog open={showInstanceManager} onClose={() => setShowInstanceManager(false)} />
          <SnapshotDialog open={showSnapshots} onClose={() => setShowSnapshots(false)} />
          <SchematicsDialog open={showSchematics} onClose={() => setShowSchematics(false)} />
          <InstallationWizardDialog open={showInstallWizard} onClose={() => setShowInstallWizard(false)} />
          <AppHelpDialog open={showHelp} onClose={() => setShowHelp(false)} />
        {dialogOpen && selectedNode && (
          <div style={{ position: 'relative', left: '50%', top: '10%', transform: 'translateX(-50%)', zIndex: 80 }}>
            <ComponentDialog id={selectedNode} status={devices[selectedNode]} schema={undefined} onClose={() => setDialogOpen(false)} />
          </div>
        )}
        <footer style={{ marginTop: 12 }}>
        <small>Nodes show "NO SIGNAL" until backend sends updates.</small>
      </footer>
    </div>
  )
}