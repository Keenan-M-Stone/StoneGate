import React from 'react'

type Instance = {
  kind: 'backend' | 'frontend'
  subtype: string
  safeToShutdown: boolean
  pid: number
  ports?: number[]
  wsUrl?: string
  deviceCount?: number
  git_commit?: string
  protocol_version?: string
  compatibility?: { compatible: boolean; reason?: string; protocolVersion?: string | null; required?: string }
  cmd?: string
}

type KillResult =
  | { ok: true; selected: number[]; dryRun?: boolean; killed?: number[]; stillAlive?: number[] }
  | { ok: false; error: string; code?: number; selected?: number[]; blocked?: Array<any> }

export default function InstanceManagerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [instances, setInstances] = React.useState<Instance[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string>('')
  const [selected, setSelected] = React.useState<Set<number>>(new Set())

  const [dryRun, setDryRun] = React.useState(false)
  const [forceUnsafe, setForceUnsafe] = React.useState(false)
  const [lastAction, setLastAction] = React.useState<string>('')

  const refresh = React.useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await fetch('/__stonegate_admin/instances')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      if (!j?.ok) throw new Error(j?.error ?? 'failed')
      setInstances(j.instances ?? [])
      setSelected(new Set())
    } catch (e: any) {
      setError(
        `Instance manager is available only in dev (pnpm dev). Failed to load /__stonegate_admin/instances: ${String(
          e?.message ?? e
        )}`
      )
      setInstances([])
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (!open) return
    refresh()
  }, [open, refresh])

  const togglePid = (pid: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(pid)) next.delete(pid)
      else next.add(pid)
      return next
    })
  }

  const postKill = React.useCallback(
    async (body: any) => {
      setLoading(true)
      setError('')
      setLastAction('')
      try {
        const r = await fetch('/__stonegate_admin/kill', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const j: KillResult = await r.json()
        if (!j.ok) {
          throw new Error(j.error)
        }
        setLastAction(
          j.dryRun
            ? `Dry-run OK: would signal ${j.selected.length} pid(s).`
            : `Stop OK: selected=${j.selected.length} killed=${j.killed?.length ?? 0} stillAlive=${j.stillAlive?.length ?? 0}`
        )
        await refresh()
      } catch (e: any) {
        setError(String(e?.message ?? e))
      } finally {
        setLoading(false)
      }
    },
    [refresh]
  )

  const stopSafe = () => postKill({ safeOnly: true, dryRun })
  const stopSelected = () => postKill({ pids: Array.from(selected), forceUnsafe, dryRun })

  if (!open) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        zIndex: 250,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: 80,
      }}
      onMouseDown={onClose}
    >
      <div
        style={{
          width: 'min(1100px, 94vw)',
          maxHeight: '82vh',
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
            <h3 style={{ margin: 0 }}>Instance Manager</h3>
            <div style={{ opacity: 0.8, fontSize: 12 }}>Dev-only: discovers local listeners via Vite server</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={refresh} disabled={loading}>
              Refresh
            </button>
            <button onClick={onClose}>Close</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 14, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} />
            <span>Dry-run</span>
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={forceUnsafe} onChange={e => setForceUnsafe(e.target.checked)} />
            <span>Force unsafe (danger)</span>
          </label>
          <button onClick={stopSafe} disabled={loading}>
            Stop Safe Instances
          </button>
          <button onClick={stopSelected} disabled={loading || selected.size === 0}>
            Stop Selected
          </button>
          <div style={{ opacity: 0.8, fontSize: 12 }}>Selected: {selected.size}</div>
        </div>

        {error && (
          <div style={{ marginTop: 10, color: '#ffb3b3', whiteSpace: 'pre-wrap' }}>{error}</div>
        )}
        {lastAction && <div style={{ marginTop: 10, color: '#b6fcb6' }}>{lastAction}</div>}

        <div style={{ marginTop: 12, borderTop: '1px solid rgba(255,255,255,0.12)', paddingTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
                <th style={{ padding: 6 }}></th>
                <th style={{ padding: 6 }}>Kind</th>
                <th style={{ padding: 6 }}>Subtype</th>
                <th style={{ padding: 6 }}>Safe</th>
                <th style={{ padding: 6 }}>PID</th>
                <th style={{ padding: 6 }}>Ports</th>
                <th style={{ padding: 6 }}>WS</th>
                <th style={{ padding: 6 }}>Devices</th>
                <th style={{ padding: 6 }}>Commit</th>
                <th style={{ padding: 6 }}>Protocol</th>
                <th style={{ padding: 6 }}>Compat</th>
              </tr>
            </thead>
            <tbody>
              {instances.map(inst => {
                const isSel = selected.has(inst.pid)
                const safe = inst.safeToShutdown
                const compat = inst.compatibility
                const compatOk = inst.kind !== 'backend' ? null : !!compat?.compatible
                return (
                  <tr
                    key={inst.pid}
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,0.08)',
                      opacity: safe ? 1 : 0.85,
                    }}
                  >
                    <td style={{ padding: 6 }}>
                      <input type="checkbox" checked={isSel} onChange={() => togglePid(inst.pid)} />
                    </td>
                    <td style={{ padding: 6 }}>{inst.kind}</td>
                    <td style={{ padding: 6 }}>{inst.subtype}</td>
                    <td style={{ padding: 6, color: safe ? '#b6fcb6' : '#ffce99' }}>{safe ? 'yes' : 'NO'}</td>
                    <td style={{ padding: 6 }}>{inst.pid}</td>
                    <td style={{ padding: 6 }}>{(inst.ports ?? []).join(',')}</td>
                    <td style={{ padding: 6, fontFamily: 'monospace' }}>{inst.wsUrl ?? ''}</td>
                    <td style={{ padding: 6 }}>{inst.deviceCount ?? ''}</td>
                    <td style={{ padding: 6, fontFamily: 'monospace' }}>{inst.git_commit ?? ''}</td>
                    <td style={{ padding: 6, fontFamily: 'monospace' }}>{inst.protocol_version ?? ''}</td>
                    <td
                      style={{
                        padding: 6,
                        color:
                          compatOk === null ? 'rgba(230,238,248,0.65)' : compatOk ? '#b6fcb6' : '#ffb3b3',
                        fontFamily: 'monospace',
                      }}
                      title={compat?.reason ? `reason: ${compat.reason}${compat.required ? ` (min ${compat.required})` : ''}` : ''}
                    >
                      {compatOk === null ? '' : compatOk ? 'OK' : 'NO'}
                    </td>
                  </tr>
                )
              })}
              {!instances.length && (
                <tr>
                  <td colSpan={11} style={{ padding: 10, opacity: 0.8 }}>
                    {loading ? 'Loading…' : 'No instances found.'}
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
