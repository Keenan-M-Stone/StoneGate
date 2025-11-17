import React from 'react'
import { useDeviceStore } from '../../state/store'
import compSchema from '../../../../shared/protocol/ComponentSchema.json'
import deviceGraph from '../../../../shared/protocol/DeviceGraph.json'
import ComponentNode from './ComponentNode'
import Wire from './Wire'

export default function SchematicCanvas() {
  const devices = useDeviceStore(s => s.devices)

  const nodes = deviceGraph.nodes || []
  const edges = deviceGraph.edges || []

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
          return (
            <foreignObject key={n.id} x={n.x - 80} y={n.y - 40} width={160} height={80}>
              <div style={{ width: 160, height: 80 }}>
                <ComponentNode
                  id={n.id}
                  label={n.label}
                  type={n.type}
                  status={status}
                  schema={(compSchema as any)[n.type]}
                />
              </div>
            </foreignObject>
          )
        })}
      </svg>
    </div>
  )
}