import React from 'react';

export const DiagnosticsPanel: React.FC<{devices:any[], onZero:(id:string)=>void}> = ({devices, onZero}) => {
  return (
    <div>
      {devices.map(d => (
        <div key={d.device_id} style={{border: '1px solid #ccc', padding:8, margin:6}}>
          <div><strong>{d.device_id}</strong> ({d.type})</div>
          <div>Last: {d.lastValue}</div>
          <div>Tolerance: [{d.tolerance_low} - {d.tolerance_high}]</div>
          <button onClick={()=>onZero(d.device_id)}>Zero</button>
        </div>
      ))}
    </div>
  )
}