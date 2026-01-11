import React from 'react'
import Backend from '../api/backend'
import { useDeviceStore, useDeviceStoreRef } from '../state/store'

import localGraph from '../../../shared/protocol/DeviceGraph.json'
import localSchema from '../../../shared/protocol/ComponentSchema.json'

type SchematicsEntry = { name: string; path?: string; mtime_ms?: number }

type GraphListResult = { ok: true; schematics: SchematicsEntry[] } | { ok: false; error: string; schematics?: SchematicsEntry[] }

type GraphLoadResult = {
  available: boolean
  error?: string
  name?: string
  path?: string
  graph_hash?: string
  schema_hash?: string
  graph?: any
  schema?: any
}

type GraphSaveResult = { saved: boolean; error?: string; name?: string; path?: string; graph_hash?: string; schema_hash?: string }

type GraphSetActiveResult = { ok: boolean; error?: string; active_schematic?: string; restart_required?: boolean }

function sanitizeBaseName(name: string) {
  return (name || '').trim().replace(/\s+/g, '_')
}

function autoName(base: string) {
  const ts = new Date()
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return `${sanitizeBaseName(base) || 'schematic'}_${ts.getFullYear()}${pad2(ts.getMonth() + 1)}${pad2(ts.getDate())}_${pad2(ts.getHours())}${pad2(ts.getMinutes())}${pad2(ts.getSeconds())}`
}

export default function SchematicsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [entries, setEntries] = React.useState<SchematicsEntry[]>([])

  const [name, setName] = React.useState('')
  const [overwrite, setOverwrite] = React.useState(false)
  const [autoRename, setAutoRename] = React.useState(true)

  const schematicOverride = useDeviceStore(s => s.schematicOverride)
  const backendInfo = Backend.stats().backendInfo

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = (await Backend.rpc('graph.list', {}, 6000)) as GraphListResult
      if (!res || (res as any).ok === false) throw new Error((res as any)?.error ?? 'graph.list failed')
      const list = Array.isArray((res as any).schematics) ? (res as any).schematics : []
      setEntries(list)
    } catch (e: any) {
      setError(String(e?.message ?? e))
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!open) return
    refresh()
  }, [open, refresh])

  const getCurrentGraphSchema = () => {
    const graph = schematicOverride?.graph ?? (localGraph as any)
    const schema = schematicOverride?.schema ?? (localSchema as any)
    return { graph, schema }
  }

  const saveToBackend = async () => {
    setLoading(true)
    setError('')
    try {
      const { graph, schema } = getCurrentGraphSchema()
      const base = sanitizeBaseName(name)
      const finalName = autoRename ? autoName(base || 'schematic') : base
      if (!finalName) throw new Error('Missing name')

      const res = (await Backend.rpc(
        'graph.save',
        {
          name: finalName,
          overwrite,
          graph,
          schema,
        },
        8000
      )) as GraphSaveResult

      if (!res?.saved) throw new Error(res?.error ?? 'graph.save failed')
      await refresh()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  const loadFromBackend = async (n: string) => {
    setLoading(true)
    setError('')
    try {
      const res = (await Backend.rpc('graph.load', { name: n, include_graph: true, include_schema: true }, 8000)) as GraphLoadResult
      if (!res?.available) throw new Error(res?.error ?? 'graph.load not available')
      useDeviceStoreRef.getState().setSchematicOverride({ graph: res.graph, schema: res.schema, meta: res })
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  const setActive = async (n: string) => {
    setLoading(true)
    setError('')
    try {
      const res = (await Backend.rpc('graph.set_active', { name: n }, 6000)) as GraphSetActiveResult
      if (!res?.ok) throw new Error(res?.error ?? 'graph.set_active failed')
      await refresh()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 260,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: 70,
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: 'min(1050px, 94vw)',
          maxHeight: '84vh',
          overflow: 'auto',
          background: '#071827',
          color: '#e6eef8',
          borderRadius: 10,
          padding: 12,
          border: '1px solid rgba(255,255,255,0.18)',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div>
            <h3 style={{ margin: 0 }}>Schematics (Backend Storage)</h3>
            <div style={{ opacity: 0.8, fontSize: 12 }}>
              Save/load schematics to the currently connected backend for persistence. Setting “active” typically requires a backend restart.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={refresh} disabled={loading}>
              Refresh
            </button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>

        <div style={{ marginTop: 10, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            Connected: <strong style={{ color: Backend.stats().connected ? '#8f8' : '#f88' }}>{Backend.stats().connected ? 'yes' : 'no'}</strong>
          </div>
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            Active source:{' '}
            <strong style={{ color: schematicOverride ? '#cfe0ff' : 'rgba(230,238,248,0.75)' }}>{schematicOverride ? 'backend override' : 'local'}</strong>
          </div>
          {backendInfo?.device_graph_path ? (
            <div style={{ fontSize: 12, opacity: 0.75, fontFamily: 'monospace' }}>graph: {backendInfo.device_graph_path}</div>
          ) : null}
        </div>

        {error && <div style={{ marginTop: 10, color: '#ffb3b3', whiteSpace: 'pre-wrap' }}>{error}</div>}

        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 10 }}>
          <h4 style={{ margin: '0 0 8px 0' }}>Save current schematic</h4>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 280 }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Name</div>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. baseline" />
            </label>

            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 18 }}>
              <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
              <span style={{ fontSize: 12 }}>Overwrite if exists</span>
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 18 }}>
              <input type="checkbox" checked={autoRename} onChange={e => setAutoRename(e.target.checked)} />
              <span style={{ fontSize: 12 }} title="If enabled, appends a timestamp so loops won’t clobber names.">Auto-append timestamp</span>
            </label>

            <button onClick={saveToBackend} disabled={loading || !Backend.stats().connected} style={{ marginTop: 18 }}>
              Save to backend
            </button>
            <button
              onClick={() => useDeviceStoreRef.getState().setSchematicOverride(null)}
              disabled={loading}
              style={{ marginTop: 18 }}
              title="Revert to the frontend’s built-in schematic"
            >
              Use local
            </button>
          </div>
        </div>

        <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 10 }}>
          <h4 style={{ margin: '0 0 8px 0' }}>Stored schematics</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
                <th style={{ padding: 6 }}>Name</th>
                <th style={{ padding: 6 }}>Modified</th>
                <th style={{ padding: 6 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.name} style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <td style={{ padding: 6, fontFamily: 'monospace' }}>{e.name}</td>
                  <td style={{ padding: 6, fontFamily: 'monospace', opacity: 0.8 }}>
                    {e.mtime_ms ? new Date(e.mtime_ms).toISOString() : ''}
                  </td>
                  <td style={{ padding: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => loadFromBackend(e.name)} disabled={loading || !Backend.stats().connected}>
                      Load
                    </button>
                    <button
                      onClick={() => setActive(e.name)}
                      disabled={loading || !Backend.stats().connected}
                      title="Marks this schematic as active on the backend (restart typically required)."
                    >
                      Set active
                    </button>
                  </td>
                </tr>
              ))}
              {!entries.length && (
                <tr>
                  <td colSpan={3} style={{ padding: 10, opacity: 0.8 }}>
                    {loading ? 'Loading…' : 'No stored schematics found.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
