// index.tsx

import React from 'react'
import { useDeviceStore } from '../../state/store'
import compSchema from '../../../../shared/protocol/ComponentSchema.json'
import deviceGraph from '../../../../shared/protocol/DeviceGraph.json'
import ComponentNode from './ComponentNode'
import Wire from './Wire'
import { PanZoomContainer } from '../../utils/usePanZoom'
import { UiErrors } from '../../utils/errorCatalog'

export default function SchematicCanvas({ buildMode=false, onSelectNode, onOpenDialog }:{ buildMode?:boolean, onSelectNode?: (id?:string|null)=>void, onOpenDialog?: (id:string)=>void }) {
  const devices = useDeviceStore(s => s.devices)

  const [selected, setSelected] = React.useState<string | null>(null)
  const [nodeSizes, setNodeSizes] = React.useState<Record<string,{width:number,height:number}>>({})

  const nodes = deviceGraph.nodes || []
  const edges = deviceGraph.edges || []

  const handleSelect = (id:string|null) => { setSelected(id); if (onSelectNode) onSelectNode(id); }

  // compute canvas size from graph extents so we can make it scrollable
  const padding = 80
  const spacing = 1.25 // scale spacing to space elements out
  const xs = nodes.map((n:any)=>n.x)
  const ys = nodes.map((n:any)=>n.y)
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxX = Math.max(...xs)
  const maxY = Math.max(...ys)

  const viewWidth = Math.max(800, Math.ceil((maxX - minX) * spacing + padding*2))
  const viewHeight = Math.max(400, Math.ceil((maxY - minY) * spacing + padding*2))

  // helper to get node size (defaults)
  const getNodeSize = (id:string) => nodeSizes[id] ?? { width: 200, height: 120 }

  const updateNodeSize = (id:string, w:number, h:number) => {
    setNodeSizes(s => ({ ...s, [id]: { width: Math.max(48, Math.round(w)), height: Math.max(32, Math.round(h)) } }))
  }

  // minimap rendering: simple shapes only (no foreignObject)
  const miniMapContent = (
    <g transform={`translate(${padding + minX }, ${padding - minY})`}>
      {edges.map((e:any, i:number) => {
        const from = nodes.find((n:any)=>n.id===e.from)
        const to   = nodes.find((n:any)=>n.id===e.to)
        if (!from || !to) return null
        return <line key={i} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke='#7aa2ff' strokeOpacity={0.35} strokeWidth={6} />
      })}
      {nodes.map((n:any) => {
        const size = getNodeSize(n.id)
        const x = n.x - size.width/2
        const y = n.y - size.height/2
        return (
          <g key={n.id}>
            <rect x={x} y={y} width={size.width} height={size.height} rx={18} ry={18} fill='#14314a' fillOpacity={0.6} stroke='#2b7' strokeOpacity={0.25} strokeWidth={6} />
          </g>
        )
      })}
    </g>
  )

return (
  <PanZoomContainer
    contentWidth={viewWidth}
    contentHeight={viewHeight}
    buildMode={buildMode}
    miniMapContent={miniMapContent}
    style={{
      width: '100%',
      height: '70vh',
      overflow: 'hidden',
      background: '#071028',
      borderRadius: 8,
    }}
  >
    <svg
      width={viewWidth}
      height={viewHeight}
      style={{ display: 'block' }}
      onClick={() => handleSelect(null)}
    >
      <g transform={`translate(${padding + minX }, ${padding - minY})`}>
    
        {/* wires */}
        {edges.map((e:any, i:number) => {
          const from = nodes.find((n:any)=>n.id===e.from)
          const to   = nodes.find((n:any)=>n.id===e.to)
          if (!from || !to) return null
          return <Wire key={i} from={from} to={to} />
        })}

        {/* nodes */}
        {nodes.map((n:any) => {
          const status = devices[n.id]
          const isSelected = selected === n.id
          const size = getNodeSize(n.id)
          const x = n.x - size.width/2
          const y = n.y - size.height/2

          return (
            <foreignObject key={n.id} x={x} y={y} width={size.width} height={size.height}>
              <div
                style={{ width:'100%', height:'100%', position:'relative', boxSizing:'border-box' }}
                onClick={(e) => {
                  e.stopPropagation()
                  handleSelect(n.id)
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  handleSelect(n.id)
                }}
              >

                {isSelected && (
                  <div style={{ position:'absolute', right:6, top:6, zIndex:50 }}>
                    <div style={{ display:'flex', gap:6 }}>
                      <button onClick={(e)=>{ e.stopPropagation(); onOpenDialog?.(n.id) }}>Inspect</button>
                      <button onClick={(e)=>{ e.stopPropagation(); alert(UiErrors.featureNotImplemented('Manual Control')) }}>Manual</button>
                      {buildMode && (
                        <button
                          onClick={(e)=>{
                            e.stopPropagation();
                            alert('Assign part (drag from Parts Browser)');
                          }}
                        >
                          Assign
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <ComponentNode
                  id={n.id}
                  label={n.label}
                  type={n.type}
                  status={status}
                  schema={(compSchema as any)[n.type]}
                  buildMode={buildMode}
                  width={size.width}
                  height={size.height}
                  onResize={(w:number,h:number)=> updateNodeSize(n.id, w, h)}
                  spacing={spacing}
                />
              </div>
            </foreignObject>
          )
        })}
      </g>
    </svg>
  </PanZoomContainer>
)
}