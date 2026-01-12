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
import InspectDock from './components/InspectDock'


export default function App() {
  // initialize websocket connection
  React.useEffect(() => {
    Backend.connect()
    return () => {
      Backend.disconnect()
    }
  }, [])

  const devices = useDeviceStore(s => s.devices)

  const [openInspectIds, setOpenInspectIds] = React.useState<string[]>([])
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

  const onSelectNode = (_id?: string|null) => {}
  const onOpenDialog = (id:string) => {
    setOpenInspectIds(prev => (prev.includes(id) ? prev : [...prev, id]))
  }


  return (
    <div style={{ padding: 12, fontFamily: 'Inter, sans-serif', overflowX: 'auto' }}>
      <header style={{ marginBottom: 12 }}>
        <h2> Stone Gate: Quantum Control - Diagnostic Schematic </h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {/* There's really no harm in just making the port selectable */}
              <div> Backend status: <strong>{Backend.connected ? 'Connected' : 'Disconnected'}</strong></div>
                <ConnectionPanel buildMode={buildMode} />
          </div>
      </header>
          <SchematicCanvas buildMode={buildMode} onSelectNode={onSelectNode} onOpenDialog={onOpenDialog} />
          <InspectDock
            openIds={openInspectIds}
            onClose={(id) => setOpenInspectIds(prev => prev.filter(x => x !== id))}
            childrenForId={(id) => (
              <ComponentDialog
                id={id}
                status={devices[id]}
                schema={undefined}
                onClose={() => setOpenInspectIds(prev => prev.filter(x => x !== id))}
              />
            )}
          />
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
        <footer style={{ marginTop: 12 }}>
        <small>Nodes show "NO SIGNAL" until backend sends updates.</small>
      </footer>
    </div>
  )
}