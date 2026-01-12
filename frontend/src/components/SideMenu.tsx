import React from 'react'

export default function SideMenu({ buildMode, setBuildMode, showMacro, setShowMacro, showMiniMap, setShowMiniMap, onOpenInstanceManager, onOpenSnapshots, onOpenSchematics, onOpenDiagnostics, onOpenHelp }: any){
  const [collapsed, setCollapsed] = React.useState(false)
  const liveTransformsUrl = `${import.meta.env.BASE_URL}tools/live-transform-demo/index.html`
  const menuItemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    padding: '0.4em 0.6em',
    marginBottom: 8,
    textAlign: 'center',
    textDecoration: 'none',
    color: 'inherit',
    backgroundColor: '#1a1a1a',
    border: '1px solid transparent',
    borderRadius: 8,
    cursor: 'pointer',
    userSelect: 'none',
  }

  return (
    <div style={{ position: 'fixed', right: 12, top: 80, width: collapsed?36:220, background: '#021018', color: '#cfe', padding: 8, borderRadius: 8, zIndex: 120 }}>
      <button
        onClick={()=>setCollapsed(c=>!c)}
        title={collapsed ? 'Expand Tools' : 'Collapse Tools'}
        aria-label={collapsed ? 'Expand Tools' : 'Collapse Tools'}
        style={{ position: 'absolute', right: 6, top: 6, width: 28 }}
      >
        {collapsed ? '<' : '>'}
      </button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 14 }}>{collapsed? '': 'Tools'}</strong>
        <div style={{ display: 'flex', gap: 6 }} />
      </div>
      {!collapsed && (
        <div style={{ marginTop: 8 }}>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type='checkbox' checked={buildMode} onChange={e=>setBuildMode(e.target.checked)} />
              <span>Build Mode</span>
            </label>
          </div>
          <div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type='checkbox' checked={showMacro} onChange={e=>setShowMacro(e.target.checked)} />
              <span>Show Macros</span>
            </label>
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type='checkbox' checked={!!showMiniMap} onChange={e=>setShowMiniMap?.(e.target.checked)} />
              <span>Show Minimap</span>
            </label>
          </div>

          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
            <a
              href={liveTransformsUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={menuItemStyle}
              onClick={(e) => {
                // Try to open a new tab reliably. If popups are blocked, fall back to same-tab navigation.
                const url = (e.currentTarget as HTMLAnchorElement).href
                const w = window.open(url, '_blank', 'noopener,noreferrer')
                if (w) {
                  try { w.opener = null } catch {}
                  e.preventDefault()
                } else {
                  e.preventDefault()
                  window.location.assign(url)
                }
              }}
            >
              Live Transforms…
            </a>
            <button onClick={onOpenSnapshots} style={{ width: '100%', padding: '0.4em 0.6em', marginBottom: 8 }}>
              Snapshots…
            </button>
            <button onClick={onOpenSchematics} style={{ width: '100%', padding: '0.4em 0.6em', marginBottom: 8 }}>
              Schematics…
            </button>
            <button onClick={onOpenDiagnostics} style={{ width: '100%', padding: '0.4em 0.6em', marginBottom: 8 }}>
              Diagnostics…
            </button>
            <button onClick={onOpenInstanceManager} style={{ width: '100%', padding: '0.4em 0.6em' }}>
              Instance Manager…
            </button>
            <button onClick={onOpenHelp} style={{ width: '100%', padding: '0.4em 0.6em', marginTop: 8 }}>
              Help…
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
