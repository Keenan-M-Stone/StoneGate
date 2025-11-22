import React from 'react'
import Backend from '../api/backend'
import { useDeviceStore } from '../state/store'

const MACRO_KEY = 'stonegate_macros_v1'

type ScriptMacro = { name: string, steps: any[] }

export default function MacroEditor(){
  const [recording, setRecording] = React.useState(false)
  const [events, setEvents] = React.useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem(MACRO_KEY) || '[]') } catch { return [] }
  })
  const [scriptMacros, setScriptMacros] = React.useState<ScriptMacro[]>([])
  const [selectedMacroIndex, setSelectedMacroIndex] = React.useState<number>(-1)

  React.useEffect(()=>{
    // load bundled macros from public macro file
    fetch('/macros.json').then(r=>r.ok? r.json() : []).then((m:any[])=>{
      if (Array.isArray(m)) setScriptMacros(m)
    }).catch(()=>{})
  },[])

  React.useEffect(()=>{
    if (!recording) return
    const onClick = (e: any) => {
      const ev = { ts: Date.now(), type: 'click', x: e.clientX, y: e.clientY }
      setEvents(prev => [...prev, ev])
    }
    window.addEventListener('click', onClick)
    return ()=> window.removeEventListener('click', onClick)
  },[recording])

  const save = () => {
    localStorage.setItem(MACRO_KEY, JSON.stringify(events, null, 2))
    alert('Macros saved to localStorage')
  }

  const clearAll = () => { setEvents([]); localStorage.removeItem(MACRO_KEY) }

  const runScriptMacro = async (m: ScriptMacro) => {
    const store = useDeviceStore.getState()
    for (const step of m.steps || []){
      if (step.action === 'set'){
        const dev = step.device
        const params = step.params || {}
        Backend.send({ type: 'control', cmd: 'action', device_id: dev, action: { set: params } })
        // small delay for device to accept
        await new Promise(r=>setTimeout(r, 300))
      } else if (step.action === 'wait_for_stable'){
        const devices = step.devices || []
        const metrics = step.metrics || []
        const tol = step.tolerance || {}
        const window_ms = step.window_ms || 2000
        const consecutive = step.consecutive || 2
        const deadline = Date.now() + (step.timeout_ms || 60000)
        let consecutive_ok = 0
        while (Date.now() < deadline){
          let ok = true
          for (const d of devices){
            const state = store.devices[d]
            if (!state) { ok = false; break }
            for (const metric of metrics){
              const val = state.measurements?.[metric]?.value
              if (val === undefined) { ok = false; break }
              const t = tol[metric] ?? tol['default'] ?? 0.5
              // simple stability check: abs(diff from last sample) < tol
              // use last known value vs median over window not available; use single-sample heuristic
              if (Math.abs(val - (state.last_sample_value ?? val)) > t) { ok = false; break }
            }
            if (!ok) break
          }
          if (ok) consecutive_ok++ ; else consecutive_ok = 0
          if (consecutive_ok >= consecutive) break
          await new Promise(r=>setTimeout(r, Math.min(window_ms, 1000)))
        }
      }
    }
    alert(`Macro '${m.name}' finished`)
  }

  const runSelected = () => {
    if (selectedMacroIndex < 0 || selectedMacroIndex >= scriptMacros.length) { alert('Select a macro first'); return }
    runScriptMacro(scriptMacros[selectedMacroIndex])
  }

  return (
    <div style={{ position: 'fixed', right: 12, top: 120, width: 360, background: '#041018', color: '#cfe', padding: 8, borderRadius: 8, zIndex: 90 }}>
      <h4 style={{ margin: '4px 0' }}>Macros</h4>
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={()=>setRecording(r=>!r)} style={{ background: recording? '#822' : undefined }}>{recording? 'Stop' : 'Record'}</button>
        <button onClick={save}>Save</button>
        <button onClick={clearAll}>Clear</button>
      </div>

      <div style={{ marginTop: 10 }}>
        <strong>Saved Script Macros</strong>
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          <select value={selectedMacroIndex} onChange={e=>setSelectedMacroIndex(parseInt(e.target.value))}>
            <option value={-1}>-- select --</option>
            {scriptMacros.map((m, i)=>(<option key={i} value={i}>{m.name}</option>))}
          </select>
          <button onClick={runSelected}>Run</button>
        </div>
      </div>

      <div style={{ maxHeight: 200, overflow: 'auto', marginTop: 8, fontSize: 12 }}>
        {events.length===0 ? <div style={{ color: '#888' }}>No events recorded</div> : events.map((e,i)=>(<div key={i}>[{new Date(e.ts).toLocaleTimeString()}] {e.type} @{Math.round(e.x)},{Math.round(e.y)}</div>))}
      </div>
    </div>
  )
}
