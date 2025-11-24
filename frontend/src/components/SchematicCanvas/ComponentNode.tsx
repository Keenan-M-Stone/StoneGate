import React from 'react'
import type { DeviceStatus } from '../../../../shared/protocol/MessageTypes'

export default function ComponentNode({ id, label, type, status, schema, buildMode=false, width=220, height=140, onResize, spacing=1 }:{
	id:string, label:string, type:string, status?:DeviceStatus | null, schema?:any,
	buildMode?:boolean, width?:number, height?:number, onResize?: (w:number,h:number)=>void, spacing?:number
}){
	const stateColor = status ? (status.state==='nominal'? '#2ecc71' : status.state==='warning'? '#f1c40f' : status.state==='fault'? '#e74c3c' : '#95a5a6') : '#6b7280'

	const measurements = status?.measurements ?? {}

	// Resizing logic (drag handles) — convert screen delta to SVG units by dividing by spacing
	const startRef = React.useRef<{x:number,y:number,w:number,h:number}|null>(null)

	const handleMouseDown = (e:React.MouseEvent, corner:'se'|'e'|'s') => {
		if (!buildMode) return
		e.stopPropagation()
		startRef.current = { x: e.clientX, y: e.clientY, w: width, h: height }
		const onMove = (ev:MouseEvent) => {
			if (!startRef.current) return
			const dx = (ev.clientX - startRef.current.x) / (spacing || 1)
			const dy = (ev.clientY - startRef.current.y) / (spacing || 1)
			let nw = startRef.current.w
			let nh = startRef.current.h
			if (corner === 'se' || corner === 'e') nw = Math.max(48, startRef.current.w + dx)
			if (corner === 'se' || corner === 's') nh = Math.max(32, startRef.current.h + dy)
			if (onResize) onResize(nw, nh)
		}
		const onUp = () => { startRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
		window.addEventListener('mousemove', onMove)
		window.addEventListener('mouseup', onUp)
	}

	return (
		<div style={{
			width: '100%', height: '100%',
			background: '#071827', border: `2px solid ${stateColor}`, borderRadius: 8,
			color: '#e6eef8', padding: 8, boxSizing: 'border-box', fontSize: 12, position: 'relative'
		}}>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
				<div style={{ fontWeight: 700, maxWidth: '70%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{label}</div>
				<div style={{ fontSize: 10, marginLeft: 8, color: '#9fb0c8', maxWidth: '30%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{type}</div>
			</div>

			<div style={{ marginTop: 6 }}>
				{status ? (
					Object.keys(measurements).slice(0,2).map(k => {
						const m = (measurements as any)[k]
						const val = (m && typeof m.value === 'number') ? m.value.toFixed(3) : '—'
						const u = (m && typeof m.uncertainty === 'number') ? `±${m.uncertainty}` : ''
						return <div key={k} style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{k}: {val} {m.unit ?? ''} {u}</div>
					})
				) : (
					<div style={{ color: '#94a3b8' }}>NO SIGNAL</div>
				)}
			</div>

			{buildMode && (
				<>
					{/* east edge resize */}
					<div onMouseDown={(e)=>handleMouseDown(e,'e')} style={{ position: 'absolute', right: -6, top: '50%', transform: 'translateY(-50%)', width: 12, height: 24, cursor: 'ew-resize' }} />
					{/* south edge resize */}
					<div onMouseDown={(e)=>handleMouseDown(e,'s')} style={{ position: 'absolute', bottom: -6, left: '50%', transform: 'translateX(-50%)', width: 24, height: 12, cursor: 'ns-resize' }} />
					{/* south-east corner */}
					<div onMouseDown={(e)=>handleMouseDown(e,'se')} style={{ position: 'absolute', right: -6, bottom: -6, width: 14, height: 14, borderRadius: 2, background: '#12323a', border: '1px solid #25606b', cursor: 'se-resize' }} />
				</>
			)}

		</div>
	)
}
