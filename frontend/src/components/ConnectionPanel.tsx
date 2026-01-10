import React from 'react'
import Backend from '../api/backend'

export default function ConnectionPanel(){
  const [stats, setStats] = React.useState(Backend.stats())
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  React.useEffect(()=>{
    const t = setInterval(()=> setStats(Backend.stats()), 500)
    return ()=> clearInterval(t)
  },[])

  const changeEndpoint = () => {
    setDraft(stats.endpoint)
    setEditing(true)
  }

  return (
    <div style={{ padding: '6px 8px', background: '#022', borderRadius: 6, color: '#9fe' }} title={stats.endpoint}>
      <div style={{ fontSize: 12 }}>WS: <strong style={{ color: stats.connected ? '#8f8' : '#f88' }}>{stats.connected? 'connected' : 'disconnected'}</strong></div>
      <div style={{ fontSize: 11 }}>{stats.endpoint}</div>
      <div style={{ fontSize: 11 }}>Rx: {stats.received} Tx: {stats.sent}</div>
      <div style={{ marginTop: 6 }}>
        {!editing ? (
          <button onClick={changeEndpoint} style={{ fontSize: 11 }}>Change</button>
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
                window.location.reload()
              }}
              style={{ fontSize: 11 }}
            >
              Apply
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
