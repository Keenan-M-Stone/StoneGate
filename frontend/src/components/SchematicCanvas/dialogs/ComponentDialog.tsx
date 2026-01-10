import React from 'react'
import History from '../../../state/history'
import Backend from '../../../api/backend'
import { useDeviceStore } from '../../../state/store'
import { UiErrors } from '../../../utils/errorCatalog'
import DeviceActionDialog from '../../DeviceActionDialog'

function calcStats(values: (number|null)[]){
  const nums = values.filter((v): v is number => typeof v === 'number')
  if (nums.length === 0) return null
  const mean = nums.reduce((s,n)=>s+n,0)/nums.length
  const sorted = nums.slice().sort((a,b)=>a-b)
  const median = sorted[Math.floor(sorted.length/2)]
  const mode = (() => { const counts = new Map<number,number>(); for (const n of nums){ counts.set(n,(counts.get(n)||0)+1)} let best=nums[0], bestc=0; counts.forEach((c,k)=>{ if (c>bestc){ best=k; bestc=c } }); return best })()
  const variance = nums.reduce((s,n)=>s+(n-mean)*(n-mean),0)/nums.length
  const std = Math.sqrt(variance)
  // first derivative simple approx
  const derivs: number[] = []
  for (let i=1;i<nums.length;i++) derivs.push(nums[i]-nums[i-1])
  const meanDeriv = derivs.length? derivs.reduce((s,n)=>s+n,0)/derivs.length : 0
  return { mean, median, mode, std, meanDeriv }
}

export default function ComponentDialog({ id, status, schema: _schema, onClose, onStageSet, onStageZero }:{
  id:string, status:any, schema:any, onClose?:()=>void,
  onStageSet?: (params:any)=>void,
  onStageZero?: ()=>void
}){
  const device = useDeviceStore(s=>s.devices[id])
  const descriptor = useDeviceStore(s=>s.descriptors[id])
  const [showSetDialog, setShowSetDialog] = React.useState(false)
  const [tab, setTab] = React.useState<'plot'|'settings'|'stats'|'json'>('plot')
  const metrics = History.metricsFor(id)
  const defaultMetric = metrics[0] ?? Object.keys(device?.measurements ?? {})[0] ?? ''
  const [metric, setMetric] = React.useState(defaultMetric)
  const [timeRange, setTimeRange] = React.useState<number>(() => { try { return parseInt(localStorage.getItem('cg.timeRange')||'30') } catch { return 30 } })
  const [refreshRate, setRefreshRate] = React.useState<number>(() => { try { return parseFloat(localStorage.getItem('cg.refreshRate')||'1') } catch { return 1 } })
  const [paused, setPaused] = React.useState(false)
  const [offsetMs, setOffsetMs] = React.useState(0)
  const [color, setColor] = React.useState<string>(() => localStorage.getItem('cg.color') || '#00ff88')
  const [grid, setGrid] = React.useState<boolean>(() => (localStorage.getItem('cg.grid')||'true')==='true')
  const [logX, setLogX] = React.useState<boolean>(false)
  const [logY, setLogY] = React.useState<boolean>(false)

  React.useEffect(()=>{
    localStorage.setItem('cg.timeRange', String(timeRange))
  },[timeRange])
  React.useEffect(()=>{
    localStorage.setItem('cg.refreshRate', String(refreshRate))
  },[refreshRate])
  React.useEffect(()=>{ localStorage.setItem('cg.color', color) },[color])
  React.useEffect(()=>{ localStorage.setItem('cg.grid', String(grid)) },[grid])

  // update visible metric if metrics list changes
  React.useEffect(()=>{
    if (metrics.length && !metrics.includes(metric)) setMetric(metrics[0])
  },[metrics.join(',' )])

  // plot update interval
  const [, forceRerender] = React.useReducer((n:number)=>n+1, 0)
  React.useEffect(()=>{
    if (paused) return
    const idt = setInterval(()=> forceRerender(), Math.max(100, 1000*Math.max(0.1, 1/refreshRate)))
    return ()=> clearInterval(idt)
  },[paused, refreshRate])

  const series = History.getSeries(id, metric, timeRange, offsetMs)

  // build svg path
  const svgWidth = 560, svgHeight = 240, pad = 28
  const values = series.map(s=> s.value === null ? NaN : s.value)
  const numeric = values.filter(v => !isNaN(v))
  const vmin = numeric.length? Math.min(...numeric) : 0
  const vmax = numeric.length? Math.max(...numeric) : 1
  const ymin = vmin === vmax ? vmin - 0.5 : vmin
  const ymax = vmin === vmax ? vmax + 0.5 : vmax
  const pts = series.map(s => {
    const x = svgWidth - ((series[series.length-1]?.ts ?? Date.now()) - s.ts) / (timeRange*1000) * (svgWidth - pad*2) - pad
    const y = isNaN(s.value as any) ? NaN : pad + (1 - ((s.value as number)-ymin)/(ymax-ymin)) * (svgHeight - pad*2)
    return { x, y }
  })

  const stats = calcStats(series.map(s=> s.value ?? null))

  const handleBack = ()=> setOffsetMs(o => Math.min(o + Math.round(1000/Math.max(0.1, refreshRate)), timeRange*1000))
  const handleForward = ()=> setOffsetMs(o => Math.max(0, o - Math.round(1000/Math.max(0.1, refreshRate))))

  const doZero = ()=>{
    if (onStageZero) return onStageZero()
    Backend.send({ type: 'control', cmd: 'action', device_id: id, action: { zero: true } })
  }

  // CSV record
  const doRecord = async (seconds:number, filename?:string)=>{
    const now = Date.now()
    const start = now - seconds*1000
    // build timestamps according to refreshRate
    const stepMs = Math.max(100, Math.round(1000/Math.max(0.1, refreshRate)))
    const rows: string[] = []
    const header = ['ts']
    const metrics = History.metricsFor(id)
    header.push(...metrics)
    rows.push(header.join(','))
    for (let t=start; t<=now; t += stepMs){
      const line: string[] = [new Date(t).toISOString()]
      for (const m of metrics){
        // find latest sample <= t
        const s = (History.getSeries(id, m, seconds+1, now - t).slice().sort((a,b)=>b.ts-a.ts)[0])
        line.push(s? String(s.value ?? '') : '')
      }
      rows.push(line.join(','))
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const fname = filename || `${id.replace(/[^a-z0-9_-]/gi,'_')}_${new Date().toISOString().replace(/[:.]/g,'-')}.csv`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
  }

  return (
    <div style={{ maxWidth: 720, maxHeight: '80vh', overflow: 'auto', background: '#071827', color: '#e6eef8', padding: 12, borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>{id}</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <nav style={{ display: 'flex', gap: 8 }}>
          <button onClick={()=>setTab('plot')} style={{ fontWeight: tab==='plot'?700:400 }}>Plot</button>
          <button onClick={()=>setTab('settings')} style={{ fontWeight: tab==='settings'?700:400 }}>Settings</button>
          <button onClick={()=>setTab('stats')} style={{ fontWeight: tab==='stats'?700:400 }}>Stats</button>
          <button onClick={()=>setTab('json')} style={{ fontWeight: tab==='json'?700:400 }}>JSON</button>
        </nav>
      </div>

      <div style={{ marginTop: 10 }}>
        {tab === 'plot' && (
          <div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label>Metric: <select value={metric} onChange={e=>setMetric(e.target.value)}>{History.metricsFor(id).map(m=>(<option key={m} value={m}>{m}</option>))}</select></label>
              <label>Range (s): <input type='number' value={timeRange} onChange={e=>setTimeRange(parseInt(e.target.value||'30'))} style={{ width: 80 }} /></label>
              <label>Refresh (Hz): <input type='number' value={refreshRate} onChange={e=>setRefreshRate(parseFloat(e.target.value||'1'))} style={{ width: 80 }} /></label>
              <button onClick={()=>setTab('settings')}>Plot Options</button>
            </div>

            <div style={{ marginTop: 8, border: '1px solid #123', padding: 8, borderRadius: 6 }}>
              <svg width={svgWidth} height={svgHeight}>
                {grid && Array.from({length:5}).map((_,i)=> <line key={i} x1={pad} x2={svgWidth-pad} y1={pad + i*(svgHeight-pad*2)/4} y2={pad + i*(svgHeight-pad*2)/4} stroke='#0b2' strokeOpacity={0.06} />)}
                <polyline fill='none' stroke={color} strokeWidth={2} points={pts.filter(p=>!isNaN(p.y)).map(p=>`${Math.max(p.x,0)},${p.y}`).join(' ')} />
              </svg>
            </div>

            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button onClick={()=>setPaused(p=>!p)}>{paused? 'Play' : 'Pause'}</button>
              <button onClick={handleBack}>◀ Back</button>
              <button onClick={handleForward}>Forward ▶</button>
              <button onClick={()=>doZero()}>{onStageZero ? 'Stage Zero' : 'Zero'}</button>
              <button onClick={()=>setShowSetDialog(true)}>{onStageSet ? 'Stage Set' : 'Set'}</button>
              <button onClick={()=>{ const s = parseInt(prompt('Record seconds','10')||'0'); if (s>0) doRecord(s) }}>Record CSV</button>
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div>
            <h4>Plot settings</h4>
            <label style={{ display: 'block' }}><input type='checkbox' checked={grid} onChange={e=>setGrid(e.target.checked)} /> Grid</label>
            <label style={{ display: 'block' }}>Color: <input type='color' value={color} onChange={e=>setColor(e.target.value)} /></label>
            <label style={{ display: 'block' }}><input type='checkbox' checked={logX} onChange={e=>setLogX(e.target.checked)} /> Log X</label>
            <label style={{ display: 'block' }}><input type='checkbox' checked={logY} onChange={e=>setLogY(e.target.checked)} /> Log Y</label>
          </div>
        )}

        {tab === 'stats' && (
          <div>
            <h4>Statistics</h4>
            {stats ? (
              <div>
                <div>Mean: {stats.mean.toFixed(4)}</div>
                <div>Median: {stats.median}</div>
                <div>Mode: {stats.mode}</div>
                <div>Std Dev: {stats.std.toFixed(4)}</div>
                <div>Mean Derivative: {stats.meanDeriv.toFixed(4)}</div>
              </div>
            ) : <div style={{ color: '#888' }}>Not enough samples</div>}
          </div>
        )}

        {tab === 'json' && (
          <div>
            <h4>Raw JSON</h4>
            <div style={{ maxHeight: 300, overflow: 'auto', background: '#01101a', padding: 8, borderRadius: 6 }}>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(device ?? status ?? {}, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>

      {showSetDialog && (
        <DeviceActionDialog
          title={onStageSet ? 'Stage Set' : 'Set Parameters'}
          deviceId={id}
          descriptor={descriptor}
          onClose={() => setShowSetDialog(false)}
          onApply={(action) => {
            try {
              // For stage integration, pass set-payload only.
              if (onStageSet && action?.set) onStageSet(action.set)
              else Backend.send({ type: 'control', cmd: 'action', device_id: id, action })
              setShowSetDialog(false)
            } catch (e) {
              alert(UiErrors.invalidJson())
            }
          }}
        />
      )}
    </div>
  )
}