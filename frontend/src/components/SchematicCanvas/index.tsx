import React from 'react'
import { useDeviceStore } from '../../state/store'
import compSchema from '../../../../shared/protocol/ComponentSchema.json'
import deviceGraph from '../../../../shared/protocol/DeviceGraph.json'
import ComponentNode from './ComponentNode'
import Wire from './Wire'

export default function SchematicCanvas({ buildMode=false, onSelectNode, onOpenDialog }:{ buildMode?:boolean, onSelectNode?: (id?:string|null)=>void, onOpenDialog?: (id:string)=>void }) {
  const devices = useDeviceStore(s => s.devices)

  const [selected, setSelected] = React.useState<string | null>(null)

  const nodes = deviceGraph.nodes || []
  const edges = deviceGraph.edges || []

  const handleSelect = (id:string|null) => { setSelected(id); if (onSelectNode) onSelectNode(id); }
  const handleDouble = (id:string) => { if (onOpenDialog) onOpenDialog(id); }

  const width = 1000
  const height = 400

  return (
    <div style={{ background: '#071028', padding: 12, borderRadius: 8 }}>
      <svg width={width} height={height} style={{ display: 'block', margin: '0 auto' }}>
        {/* wires first */}
        {edges.map((e:any, i:number) => {
          const from = nodes.find((n:any)=>n.id===e.from)
          const to = nodes.find((n:any)=>n.id===e.to)
          if (!from || !to) return null
          return <Wire key={i} from={from} to={to} />
        })}

        {/* nodes */}
        {nodes.map((n:any) => {
          const status = devices[n.id]
          const isSelected = selected === n.id
          return (
            <foreignObject key={n.id} x={n.x - 80} y={n.y - 40} width={200} height={170}>
              <div style={{ width: 180, height: 150, position: 'relative' }} onClick={() => { handleSelect(n.id) }} onDoubleClick={() => { handleDouble(n.id) }}>
                {isSelected && (
                  <div style={{ position: 'absolute', right: 6, top: 6, zIndex: 50 }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={(e)=>{ e.stopPropagation(); if (onOpenDialog) onOpenDialog(n.id) }}>Inspect</button>
                      <button onClick={(e)=>{ e.stopPropagation(); /* TODO: open Manual Control */ alert('Manual Control not implemented yet') }}>Manual</button>
                      {buildMode && <button onClick={(e)=>{ e.stopPropagation(); alert('Assign part (drag from Parts Browser)') }}>Assign</button>}
                    </div>
                  </div>
                )}
                <div style={{ width: 180, height: 150 }}>
                  <ComponentNode
                    id={n.id}
                    label={n.label}
                    type={n.type}
                    status={status}
                    schema={(compSchema as any)[n.type]}
                  />
                </div>
              </div>
            </foreignObject>
          )
        })}
      </svg>
    </div>
  )
}