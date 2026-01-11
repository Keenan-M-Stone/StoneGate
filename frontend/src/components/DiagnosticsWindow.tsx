import React from 'react'
import FloatingWindow from './FloatingWindow'
import { useLogStore } from '../state/logStore'

const LAYOUT_KEY = 'stonegate_diagnostics_window_layout_v1'

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function formatLines(lines: { ts: string; level: string; message: string }[]) {
  return lines
    .map(l => `${l.ts} [${l.level.toUpperCase()}] ${l.message}`)
    .join('\n')
}

function LogPane({
  title,
  lines,
  persist,
  onPersist,
  onClear,
  enableOriginFilter,
}: {
  title: string
  lines: { id: string; ts: string; level: string; message: string }[]
  persist: boolean
  onPersist: (v: boolean) => void
  onClear: () => void
  enableOriginFilter?: boolean
}) {
  const [copyStatus, setCopyStatus] = React.useState<string>('')
  const [search, setSearch] = React.useState('')
  const [showLevels, setShowLevels] = React.useState<Record<string, boolean>>({
    debug: false,
    info: true,
    warn: true,
    error: true,
  })
  const [showOrigins, setShowOrigins] = React.useState<Record<string, boolean>>({})

  const origins = React.useMemo(() => {
    if (!enableOriginFilter) return [] as string[]
    const set = new Set<string>()
    for (const l of lines as any[]) {
      const o = l?.meta?.origin
      if (typeof o === 'string' && o) set.add(o)
    }
    const arr = Array.from(set)
    arr.sort()
    return arr
  }, [enableOriginFilter, lines])

  React.useEffect(() => {
    if (!enableOriginFilter) return
    setShowOrigins(prev => {
      const next = { ...prev }
      for (const o of origins) {
        if (!(o in next)) next[o] = true
      }
      return next
    })
  }, [enableOriginFilter, origins])

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    return (lines as any[]).filter(l => {
      const lvl = String(l?.level || 'info').toLowerCase()
      if (lvl in showLevels && !showLevels[lvl]) return false
      if (enableOriginFilter) {
        const o = String(l?.meta?.origin || '')
        if (o && showOrigins[o] === false) return false
      }
      if (!q) return true
      const msg = String(l?.message || '').toLowerCase()
      if (msg.includes(q)) return true
      const meta = l?.meta
      if (meta && typeof meta === 'object') {
        try {
          const s = JSON.stringify(meta).toLowerCase()
          if (s.includes(q)) return true
        } catch {}
      }
      return false
    })
  }, [lines, search, showLevels, enableOriginFilter, showOrigins])

  const onCopy = async () => {
    const ok = await copyToClipboard(formatLines(filtered as any))
    setCopyStatus(ok ? 'Copied.' : 'Copy failed.')
    window.setTimeout(() => setCopyStatus(''), 1200)
  }

  return (
    <div style={{ flex: 1, minWidth: 320, display: 'flex', flexDirection: 'column', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 10 }}>
      <div style={{ padding: 8, display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.10)', flexWrap: 'wrap' }}>
        <strong style={{ flex: 1 }}>{title}</strong>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="filter…"
          style={{ padding: '0.25em 0.5em', minWidth: 160 }}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: showLevels.debug ? 1 : 0.8 }} title="Show debug">
          <input type="checkbox" checked={!!showLevels.debug} onChange={e => setShowLevels(s => ({ ...s, debug: e.target.checked }))} />
          dbg
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: showLevels.info ? 1 : 0.8 }}>
          <input type="checkbox" checked={!!showLevels.info} onChange={e => setShowLevels(s => ({ ...s, info: e.target.checked }))} />
          info
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: showLevels.warn ? 1 : 0.8 }}>
          <input type="checkbox" checked={!!showLevels.warn} onChange={e => setShowLevels(s => ({ ...s, warn: e.target.checked }))} />
          warn
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: showLevels.error ? 1 : 0.8 }}>
          <input type="checkbox" checked={!!showLevels.error} onChange={e => setShowLevels(s => ({ ...s, error: e.target.checked }))} />
          err
        </label>

        {enableOriginFilter && origins.length > 0 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, opacity: 0.75 }}>origin:</span>
            {origins.map(o => (
              <label key={o} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: showOrigins[o] === false ? 0.75 : 1 }}>
                <input type="checkbox" checked={showOrigins[o] !== false} onChange={e => setShowOrigins(s => ({ ...s, [o]: e.target.checked }))} />
                {o}
              </label>
            ))}
          </div>
        )}

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.9 }} title="Persist logs across refresh">
          <input type="checkbox" checked={persist} onChange={e => onPersist(e.target.checked)} />
          persist
        </label>
        <button onClick={onCopy} style={{ padding: '0.25em 0.6em' }}>Copy</button>
        <button onClick={onClear} style={{ padding: '0.25em 0.6em' }}>Clear</button>
        <span style={{ fontSize: 12, opacity: 0.75 }} title="shown / total">
          {filtered.length}/{lines.length}
        </span>
        {copyStatus && <span style={{ fontSize: 12, opacity: 0.75 }}>{copyStatus}</span>}
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 8,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: 12,
          lineHeight: 1.35,
          whiteSpace: 'pre-wrap',
        }}
      >
        {lines.length === 0 ? <div style={{ opacity: 0.7 }}>No log entries yet.</div> : filtered.length === 0 ? <div style={{ opacity: 0.7 }}>No entries match filter.</div> : formatLines(filtered as any)}
      </div>
    </div>
  )
}

export default function DiagnosticsWindow({ onClose }: { onClose: () => void }) {
  const frontendLogs = useLogStore(s => s.frontendLogs)
  const backendLogs = useLogStore(s => s.backendLogs)
  const persistFrontend = useLogStore(s => s.persistFrontend)
  const persistBackend = useLogStore(s => s.persistBackend)
  const setPersistFrontend = useLogStore(s => s.setPersistFrontend)
  const setPersistBackend = useLogStore(s => s.setPersistBackend)
  const clearFrontend = useLogStore(s => s.clearFrontend)
  const clearBackend = useLogStore(s => s.clearBackend)

  return (
    <FloatingWindow
      storageKey={LAYOUT_KEY}
      defaultLayout={{ x: 260, y: 110, w: 980, h: 520 }}
      minWidth={720}
      minHeight={320}
      zIndex={95}
      title="Diagnostics"
      header={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ flex: 1 }}>Diagnostics</strong>
          <button onClick={onClose} style={{ padding: '0.25em 0.6em' }} title="Close">✕</button>
        </div>
      }
    >
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: 8, fontSize: 12, opacity: 0.85 }}>
          Frontend actions (left) and backend logs (right). Backend logs include broadcasted command activity when supported by the backend.
        </div>
        <div style={{ flex: 1, display: 'flex', gap: 10, padding: 8, overflow: 'hidden' }}>
          <LogPane title="Frontend" lines={frontendLogs as any} persist={persistFrontend} onPersist={setPersistFrontend} onClear={clearFrontend} />
          <LogPane title="Backend" lines={backendLogs as any} persist={persistBackend} onPersist={setPersistBackend} onClear={clearBackend} enableOriginFilter />
        </div>
      </div>
    </FloatingWindow>
  )
}
