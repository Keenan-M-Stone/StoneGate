import React from 'react'
import Backend from '../api/backend'
import { useDeviceStore, useDeviceStoreRef } from '../state/store'

const AUTO_BACKEND_SCHEM_KEY = 'stonegate.auto_backend_schematic'

function getAutoBackendSchematic(): boolean {
  try { return (localStorage.getItem(AUTO_BACKEND_SCHEM_KEY) || 'false') === 'true' } catch { return false }
}

export default function ConnectionPanel({ buildMode = false }:{ buildMode?: boolean }){
  const [stats, setStats] = React.useState(Backend.stats())
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const schematicOverride = useDeviceStore(s => s.schematicOverride)
  const [autoBackendSchematic, setAutoBackendSchematic] = React.useState<boolean>(() => getAutoBackendSchematic())
  React.useEffect(()=>{
    const t = setInterval(()=> setStats(Backend.stats()), 500)
    return ()=> clearInterval(t)
  },[])

  React.useEffect(() => {
    try { localStorage.setItem(AUTO_BACKEND_SCHEM_KEY, autoBackendSchematic ? 'true' : 'false') } catch {}
  }, [autoBackendSchematic])

  const changeEndpoint = () => {
    setDraft(stats.endpoint)
    setEditing(true)
  }

  return (
    <div style={{ padding: '6px 8px', background: '#022', borderRadius: 6, color: '#9fe' }} title={stats.endpoint}>
      <div style={{ fontSize: 12 }}>WS: <strong style={{ color: stats.connected ? '#8f8' : '#f88' }}>{stats.connected? 'connected' : 'disconnected'}</strong></div>
      <div style={{ fontSize: 12 }}>
        Compat:{' '}
        <strong
          style={{
            color: stats.compatibility?.ok ? '#8f8' : stats.connected ? '#fbb' : '#aaa',
          }}
          title={stats.compatibility?.reason ?? ''}
        >
          {stats.connected ? (stats.compatibility?.ok ? 'compatible' : 'INCOMPATIBLE') : 'n/a'}
        </strong>
        {stats.backendInfo?.protocol_version ? (
          <span style={{ opacity: 0.8, marginLeft: 6, fontSize: 11 }}>
            v{stats.backendInfo.protocol_version}
          </span>
        ) : null}
      </div>
      <div style={{ fontSize: 11, marginTop: 2 }}>
        <span style={{ opacity: 0.85 }}>Schematic:</span>{' '}
        <span
          style={{
            display: 'inline-block',
            padding: '1px 6px',
            borderRadius: 999,
            fontSize: 11,
            border: '1px solid rgba(255,255,255,0.18)',
            background: schematicOverride ? 'rgba(122,162,255,0.16)' : 'rgba(255,255,255,0.06)',
            color: schematicOverride ? '#cfe0ff' : 'rgba(230,238,248,0.75)',
          }}
          title={
            schematicOverride
              ? `Using backend-provided DeviceGraph/ComponentSchema.\n\nGraph hash: ${schematicOverride.meta?.graph_hash ?? '?'}\nSchema hash: ${schematicOverride.meta?.schema_hash ?? '?'}`
              : 'Using the frontend\'s built-in DeviceGraph/ComponentSchema.'
          }
        >
          {schematicOverride ? 'backend' : 'local'}
        </span>
      </div>
      <div style={{ fontSize: 11 }}>{stats.endpoint}</div>
      <div style={{ fontSize: 11 }}>Rx: {stats.received} Tx: {stats.sent}</div>
      <div style={{ marginTop: 6 }}>
        {!editing ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={changeEndpoint} style={{ fontSize: 11 }}>Change</button>
            <button
              onClick={() => Backend.resetEndpointToDefault()}
              style={{ fontSize: 11 }}
              title="Clear the saved endpoint override and reconnect using the build default (VITE_BACKEND_WS_URL)."
            >
              Reset
            </button>

            {buildMode && (
              <>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, opacity: 0.9 }} title="When enabled, switching endpoints auto-loads that backend's current schematic.">
                  <input
                    type="checkbox"
                    checked={autoBackendSchematic}
                    onChange={e => setAutoBackendSchematic(e.target.checked)}
                  />
                  Auto-load backend schematic
                </label>

                <button
                  onClick={async () => {
                    try {
                      const res = await Backend.rpc('graph.get', { include_graph: true, include_schema: true }, 6000)
                      if (!res?.available) throw new Error(res?.error ?? 'graph.get not available')
                      useDeviceStoreRef.getState().setSchematicOverride({ graph: res.graph, schema: res.schema, meta: res })
                    } catch (e: any) {
                      alert(`Failed to load backend schematic: ${String(e?.message ?? e)}`)
                    }
                  }}
                  disabled={!stats.connected}
                  style={{ fontSize: 11 }}
                  title="Load DeviceGraph/ComponentSchema from the backend (build-mode)"
                >
                  Use Backend Schematic
                </button>
                <button
                  onClick={() => useDeviceStoreRef.getState().setSchematicOverride(null)}
                  style={{ fontSize: 11 }}
                  title="Revert to the frontend's built-in schematic"
                >
                  Use Local Schematic
                </button>
              </>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder='ws://localhost:8080/'
              style={{ fontSize: 11, flex: 1, minWidth: 0 }}
            />
            <button
              onClick={() => {
                const next = draft.trim()
                if (!next) return
                Backend.setEndpoint(next)
                setEditing(false)
              }}
              style={{ fontSize: 11 }}
            >
              Apply
            </button>
            <button
              onClick={() => {
                Backend.resetEndpointToDefault()
                setEditing(false)
              }}
              style={{ fontSize: 11 }}
              title="Clear the saved endpoint override and reconnect using the build default."
            >
              Default
            </button>
            <button onClick={() => setEditing(false)} style={{ fontSize: 11 }}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
