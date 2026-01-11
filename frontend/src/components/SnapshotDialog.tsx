import React from 'react'
import { captureSnapshotNow, downloadSnapshotJson, listSnapshotNames, loadSnapshotFromFile, putSnapshot } from '../utils/snapshots'

export default function SnapshotDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState('')
  const [name, setName] = React.useState('')
  const [overwrite, setOverwrite] = React.useState(false)
  const [autoRename, setAutoRename] = React.useState(true)
  const [alsoStore, setAlsoStore] = React.useState(true)

  const [storedNames, setStoredNames] = React.useState<string[]>([])

  const refresh = React.useCallback(() => {
    setStoredNames(listSnapshotNames())
  }, [])

  React.useEffect(() => {
    if (!open) return
    refresh()
  }, [open, refresh])

  const capture = async (download: boolean) => {
    setLoading(true)
    setError('')
    try {
      const snap = await captureSnapshotNow(name)
      if (alsoStore) {
        const res = putSnapshot(snap.name, snap, { overwrite, autoRename })
        if (!res.ok) throw new Error(res.error)
        snap.name = res.name
      }
      if (download) downloadSnapshotJson(snap)
      refresh()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  const importFile = async (file: File) => {
    setLoading(true)
    setError('')
    try {
      const snap = await loadSnapshotFromFile(file)
      const res = putSnapshot(snap.name, snap, { overwrite, autoRename })
      if (!res.ok) throw new Error(res.error)
      refresh()
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }

  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

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
          width: 'min(980px, 94vw)',
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
            <h3 style={{ margin: 0 }}>Snapshots</h3>
            <div style={{ opacity: 0.8, fontSize: 12 }}>
              Capture the current instrument state + schematic. Store in browser for Macro Wizard, and/or download as a file.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={refresh} disabled={loading}>
              Refresh
            </button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>

        {error && <div style={{ marginTop: 10, color: '#ffb3b3', whiteSpace: 'pre-wrap' }}>{error}</div>}

        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 10 }}>
          <h4 style={{ margin: '0 0 8px 0' }}>Capture</h4>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 280 }}>
              <div style={{ fontSize: 12, opacity: 0.8 }}>Name (base)</div>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. safe_idle" />
            </label>

            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 18 }}>
              <input type="checkbox" checked={alsoStore} onChange={e => setAlsoStore(e.target.checked)} />
              <span style={{ fontSize: 12 }}>Store in browser</span>
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 18 }}>
              <input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
              <span style={{ fontSize: 12 }}>Overwrite name</span>
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 18 }}>
              <input type="checkbox" checked={autoRename} onChange={e => setAutoRename(e.target.checked)} />
              <span style={{ fontSize: 12 }} title="If enabled, automatically creates a new name when there’s a conflict.">Auto-rename on conflict</span>
            </label>

            <button onClick={() => capture(true)} disabled={loading} style={{ marginTop: 18 }}>
              Capture & Download
            </button>
            <button onClick={() => capture(false)} disabled={loading} style={{ marginTop: 18 }}>
              Capture (no download)
            </button>
          </div>
        </div>

        <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 10 }}>
          <h4 style={{ margin: '0 0 8px 0' }}>Import snapshot file</h4>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => fileInputRef.current?.click()} disabled={loading}>
              Choose file…
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) void importFile(f)
                e.currentTarget.value = ''
              }}
            />
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Imported snapshots are stored in the browser (for Macro Wizard).
            </div>
          </div>
        </div>

        <div style={{ marginTop: 14, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 10 }}>
          <h4 style={{ margin: '0 0 8px 0' }}>Stored snapshots</h4>
          <div style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.9, whiteSpace: 'pre-wrap' }}>
            {storedNames.length ? storedNames.join('\n') : loading ? 'Loading…' : '(none yet)'}
          </div>
        </div>
      </div>
    </div>
  )
}
