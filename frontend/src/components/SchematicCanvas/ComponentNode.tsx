import React from 'react'
import type { DeviceStatus } from '../../../../shared/protocol/MessageTypes'

export default function ComponentNode({ id, label, type, status, schema }:{
  id:string, label:string, type:string, status?:DeviceStatus | null, schema?:any
}){
  const stateColor = status ? (status.state==='nominal'? '#2ecc71' : status.state==='warning'? '#f1c40f' : status.state==='fault'? '#e74c3c' : '#95a5a6') : '#6b7280'

  const measurements = status?.measurements ?? {}

  return (
    <div style={{
      width: '100%', height: '100%',
      background: '#071827', border: `2px solid ${stateColor}`, borderRadius: 8,
      color: '#e6eef8', padding: 8, boxSizing: 'border-box', fontSize: 12
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 700 }}>{label}</div>
        <div style={{ fontSize: 10 }}>{type}</div>
      </div>

      <div style={{ marginTop: 6 }}>
        {status ? (
          Object.keys(measurements).slice(0,2).map(k => {
            const m = (measurements as any)[k]
            const val = (m && typeof m.value === 'number') ? m.value.toFixed(3) : '—'
            const u = (m && typeof m.uncertainty === 'number') ? `±${m.uncertainty}` : ''
            return <div key={k}>{k}: {val} {m.unit ?? ''} {u}</div>
          })
        ) : (
          <div style={{ color: '#94a3b8' }}>NO SIGNAL</div>
        )}
      </div>

    </div>
  )
}
