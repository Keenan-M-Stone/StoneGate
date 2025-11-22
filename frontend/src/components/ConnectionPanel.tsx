import React from 'react'
import Backend from '../api/backend'

export default function ConnectionPanel(){
  const [stats, setStats] = React.useState(Backend.stats())
  React.useEffect(()=>{
    const t = setInterval(()=> setStats(Backend.stats()), 500)
    return ()=> clearInterval(t)
  },[])

  return (
    <div style={{ padding: '6px 8px', background: '#022', borderRadius: 6, color: '#9fe' }} title={stats.endpoint}>
      <div style={{ fontSize: 12 }}>WS: <strong style={{ color: stats.connected ? '#8f8' : '#f88' }}>{stats.connected? 'connected' : 'disconnected'}</strong></div>
      <div style={{ fontSize: 11 }}>{stats.endpoint}</div>
      <div style={{ fontSize: 11 }}>Rx: {stats.received} Tx: {stats.sent}</div>
    </div>
  )
}
