import React from 'react'

export default function ComponentDialog({ id, status, schema, onClose }:{
  id:string, status:any, schema:any, onClose?:()=>void
}){
  return (
    <div style={{ width: 480, height: 320, background: '#071827', color: '#e6eef8', padding: 12 }}>
      <h3>{id}</h3>
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h4>Measurements</h4>
          <pre>{JSON.stringify(status?.measurements ?? {}, null, 2)}</pre>
        </div>
        <div style={{ width: 200 }}>
          <h4>Operations</h4>
          {(schema?.interactive ?? []).map((op:any) => (
            <button key={op} style={{ display: 'block', marginBottom: 6 }}>{op}</button>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  )
}