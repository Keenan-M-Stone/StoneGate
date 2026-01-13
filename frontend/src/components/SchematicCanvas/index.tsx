// index.tsx

import React from 'react'
import { useDeviceStore, useDeviceStoreRef } from '../../state/store'
import compSchema from '../../../../shared/protocol/ComponentSchema.json'
import deviceGraph from '../../../../shared/protocol/DeviceGraph.json'
import ComponentNode from './ComponentNode'
import Wire from './Wire'
import { PanZoomContainer } from '../../utils/usePanZoom'

export default function SchematicCanvas({ buildMode=false, showMiniMap=true, onSelectNode, onOpenDialog }:{ buildMode?:boolean, showMiniMap?: boolean, onSelectNode?: (id?:string|null)=>void, onOpenDialog?: (id:string)=>void }) {
  const devices = useDeviceStore(s => s.devices)
  const descriptors = useDeviceStore(s => s.descriptors)
  const schematicOverride = useDeviceStore(s => s.schematicOverride)

  const [selected, setSelected] = React.useState<string | null>(null)
  const [nodeSizes, setNodeSizes] = React.useState<Record<string,{width:number,height:number}>>({})
  const [linkDrag, setLinkDrag] = React.useState<null | { fromId: string; to: { x: number; y: number } }>(null)
  const [undoLen, setUndoLen] = React.useState(0)
  const [redoLen, setRedoLen] = React.useState(0)
  const [viewReady, setViewReady] = React.useState(false)
  const [assigningId, setAssigningId] = React.useState<string | null>(null)
  const [assignMode, setAssignMode] = React.useState<'connected' | 'custom'>('connected')
  const [assignDeviceId, setAssignDeviceId] = React.useState<string>('')
  const [assignMeasurementKey, setAssignMeasurementKey] = React.useState<string>('')
  const [assignCustomDeviceName, setAssignCustomDeviceName] = React.useState<string>('')
  const [manualId, setManualId] = React.useState<string | null>(null)

  const activeGraph: any = schematicOverride?.graph ?? deviceGraph
  const activeSchema: any = schematicOverride?.schema ?? compSchema

  const nodes = activeGraph?.nodes || []
  const edges = activeGraph?.edges || []

  const connectedDeviceIds = React.useMemo(() => Object.keys(devices ?? {}).map(String).sort(), [devices])

  const viewStateRef = React.useRef<{ scale: number; offset: { x: number; y: number }; containerSize: { width: number; height: number } } | null>(null)
  const undoRef = React.useRef<any[]>([])
  const redoRef = React.useRef<any[]>([])

  const svgRef = React.useRef<SVGSVGElement | null>(null)
  const draggingRef = React.useRef<null | {
    id: string
    startWorld: { x: number; y: number }
    startNode: { x: number; y: number }
    moved: boolean
    baseGraph?: any
  }>(null)

  const cloneGraph = (g: any) => {
    try { return structuredClone(g) } catch { return JSON.parse(JSON.stringify(g)) }
  }

  const syncHistoryLens = () => {
    setUndoLen(undoRef.current.length)
    setRedoLen(redoRef.current.length)
  }

  const pushUndo = (snapshot: any) => {
    if (!snapshot) return
    undoRef.current.push(cloneGraph(snapshot))
    redoRef.current = []
    syncHistoryLens()
  }

  const applyGraphEdit = (nextGraph: any) => {
    pushUndo(activeGraph)
    setGraphOverride(nextGraph)
  }

  const undo = () => {
    const prev = undoRef.current.pop()
    if (!prev) return
    redoRef.current.push(cloneGraph(activeGraph))
    setGraphOverride(prev)
    syncHistoryLens()
  }

  const redo = () => {
    const next = redoRef.current.pop()
    if (!next) return
    undoRef.current.push(cloneGraph(activeGraph))
    setGraphOverride(next)
    syncHistoryLens()
  }

  const toWorld = (clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return null

    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const p = pt.matrixTransform(ctm.inverse())

    // convert from SVG coords to graph coords (undo the inner <g> translate)
    const worldX = p.x - (padding + minX)
    const worldY = p.y - (padding - minY)
    return { x: worldX, y: worldY }
  }

  const setGraphOverride = (graph: any) => {
    useDeviceStoreRef.getState().setSchematicOverride({
      graph,
      schema: activeSchema,
      meta: {
        ...(schematicOverride?.meta ?? {}),
        source: 'ui-edit',
        edited_at: new Date().toISOString(),
      },
    })
  }

  const setNodePos = (id: string, x: number, y: number) => {
    const nextNodes = nodes.map((n: any) => (n.id === id ? { ...n, x, y } : n))
    const next = { ...activeGraph, nodes: nextNodes, edges }
    setGraphOverride(next)
  }

  const handleSelect = (id:string|null) => { setSelected(id); if (onSelectNode) onSelectNode(id); }

  // compute canvas size from graph extents so we can make it scrollable
  const padding = 80
  const spacing = 1.25 // scale spacing to space elements out
  const xs = nodes.length ? nodes.map((n:any)=>n.x) : [0]
  const ys = nodes.length ? nodes.map((n:any)=>n.y) : [0]
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

  const findNodeAtWorld = (worldX: number, worldY: number) => {
    for (const n of nodes) {
      const size = getNodeSize(n.id)
      const halfW = size.width / 2
      const halfH = size.height / 2
      if (worldX >= n.x - halfW && worldX <= n.x + halfW && worldY >= n.y - halfH && worldY <= n.y + halfH) {
        return n
      }
    }
    return null
  }

  const edgeExists = (fromId: string, toId: string) => {
    return edges.some((e: any) => String(e.from) === fromId && String(e.to) === toId)
  }

  const addEdge = (fromId: string, toId: string) => {
    if (fromId === toId) return
    if (edgeExists(fromId, toId)) return
    const nextEdges = [...edges, { from: fromId, to: toId }]
    applyGraphEdit({ ...activeGraph, nodes, edges: nextEdges })
  }

  const startLinkDrag = (fromId: string, e: React.MouseEvent) => {
    if (!buildMode) return
    e.stopPropagation()

    const fromNode = nodes.find((n: any) => n.id === fromId)
    if (!fromNode) return

    const w = toWorld((e as any).clientX, (e as any).clientY)
    if (!w) return

    setLinkDrag({ fromId, to: w })

    const onMove = (ev: MouseEvent) => {
      const cw = toWorld(ev.clientX, ev.clientY)
      if (!cw) return
      setLinkDrag(prev => (prev && prev.fromId === fromId ? { ...prev, to: cw } : prev))
    }

    const onUp = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const cw = toWorld(ev.clientX, ev.clientY)
      if (cw) {
        const target = findNodeAtWorld(cw.x, cw.y)
        if (target && String(target.id) !== fromId) {
          addEdge(fromId, String(target.id))
        }
      }
      setLinkDrag(null)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const addDevice = (interactive = false) => {
    if (!buildMode) return

    const schemaTypes = Object.keys(activeSchema ?? {})
    const defaultType = schemaTypes[0] ?? 'Device'

    let type = defaultType
    if (interactive) {
      type = (window.prompt('Device type', defaultType) ?? '').trim() || defaultType
      if (schemaTypes.length && !schemaTypes.includes(type)) {
        alert(`Unknown device type: ${type}`)
        return
      }
    }

    const base = type.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'dev'
    let n = 0
    const taken = new Set(nodes.map((x: any) => String(x.id)))
    while (taken.has(`${base}${n}`)) n++
    const suggestedId = `${base}${n}`

    let id = suggestedId
    if (interactive) {
      id = (window.prompt('Device id', suggestedId) ?? '').trim() || suggestedId
      if (taken.has(id)) {
        alert(`Device id already exists: ${id}`)
        return
      }
    }

    const labelDefault = `${type} ${n}`
    const label = interactive ? ((window.prompt('Device label', labelDefault) ?? '').trim() || id) : labelDefault

    const findPlacementInView = () => {
      const vs = viewStateRef.current
      const w = vs?.containerSize?.width ?? 0
      const h = vs?.containerSize?.height ?? 0
      if (!vs || !w || !h) return null

      // visible rect in content coords
      const vx = -vs.offset.x / vs.scale
      const vy = -vs.offset.y / vs.scale
      const vw = w / vs.scale
      const vh = h / vs.scale

      // convert to graph coords (undo inner translate)
      const gx0 = vx - (padding + minX)
      const gy0 = vy - (padding - minY)
      const gx1 = gx0 + vw
      const gy1 = gy0 + vh

      const nodeW = 200
      const nodeH = 120
      const margin = 16

      const minGX = gx0 + nodeW / 2 + margin
      const maxGX = gx1 - nodeW / 2 - margin
      const minGY = gy0 + nodeH / 2 + margin
      const maxGY = gy1 - nodeH / 2 - margin
      if (!(minGX < maxGX && minGY < maxGY)) return null

      const boxes = nodes.map((nn: any) => {
        const s = getNodeSize(nn.id)
        return { x0: nn.x - s.width / 2, y0: nn.y - s.height / 2, x1: nn.x + s.width / 2, y1: nn.y + s.height / 2 }
      })

      const overlaps = (cx: number, cy: number) => {
        const x0 = cx - nodeW / 2
        const y0 = cy - nodeH / 2
        const x1 = cx + nodeW / 2
        const y1 = cy + nodeH / 2
        for (const b of boxes) {
          const hit = !(x1 < b.x0 || x0 > b.x1 || y1 < b.y0 || y0 > b.y1)
          if (hit) return true
        }
        return false
      }

      const cx = (minGX + maxGX) / 2
      const cy = (minGY + maxGY) / 2
      if (!overlaps(cx, cy)) return { x: cx, y: cy }

      const stepX = 240
      const stepY = 180
      for (let r = 1; r <= 10; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
            const px = cx + dx * stepX
            const py = cy + dy * stepY
            if (px < minGX || px > maxGX || py < minGY || py > maxGY) continue
            if (!overlaps(px, py)) return { x: px, y: py }
          }
        }
      }
      return { x: Math.max(minGX, Math.min(maxGX, cx)), y: Math.max(minGY, Math.min(maxGY, cy)) }
    }

    const place = findPlacementInView()
    const selNode = selected ? nodes.find((x: any) => x.id === selected) : null
    const x = place?.x ?? (selNode?.x ?? (minX + maxX) / 2)
    const y = place?.y ?? (selNode?.y ?? (minY + maxY) / 2)

    setNodeSizes(s => ({ ...s, [id]: { width: 200, height: 120 } }))

    const nextNodes = [...nodes, { id, type, x, y, label }]
    const next = { ...activeGraph, nodes: nextNodes, edges }
    applyGraphEdit(next)
    handleSelect(id)
  }

  const deleteDevice = (id: string) => {
    if (!buildMode) return
    const nodeId = String(id ?? '').trim()
    if (!nodeId) return

    const exists = nodes.some((n: any) => String(n.id) === nodeId)
    if (!exists) {
      handleSelect(null)
      return
    }

    const edgeEndId = (v: any) => {
      if (v && typeof v === 'object') {
        if ('id' in v) return String((v as any).id)
        if ('device_id' in v) return String((v as any).device_id)
      }
      return String(v)
    }

    const nextNodes = nodes.filter((n: any) => String(n.id) !== nodeId)
    const nextEdges = edges.filter((e: any) => edgeEndId(e.from) !== nodeId && edgeEndId(e.to) !== nodeId)
    const next = { ...activeGraph, nodes: nextNodes, edges: nextEdges }
    applyGraphEdit(next)
    setNodeSizes(s => {
      const copy = { ...s }
      delete copy[nodeId]
      return copy
    })
    handleSelect(null)
  }

  const openAssign = (nodeId: string) => {
    const n = nodes.find((x: any) => String(x.id) === String(nodeId))
    if (!n) return

    const existing = (n as any).assignment
    if (existing?.mode === 'custom') {
      setAssignMode('custom')
      setAssignCustomDeviceName(String(existing.deviceName ?? ''))
      setAssignMeasurementKey(String(existing.measurementKey ?? ''))
      setAssignDeviceId('')
    } else if (existing?.mode === 'connected') {
      setAssignMode('connected')
      setAssignDeviceId(String(existing.deviceId ?? (connectedDeviceIds[0] ?? '')))
      setAssignMeasurementKey(String(existing.measurementKey ?? ''))
      setAssignCustomDeviceName('')
    } else {
      setAssignMode('connected')
      setAssignDeviceId(connectedDeviceIds[0] ?? '')
      setAssignMeasurementKey('')
      setAssignCustomDeviceName('')
    }
    setAssigningId(String(nodeId))
  }

  const closeAssign = () => setAssigningId(null)

  const openManual = (nodeId: string) => setManualId(String(nodeId))
  const closeManual = () => setManualId(null)

  const saveAssign = () => {
    if (!assigningId) return
    const nodeId = assigningId

    const nextNodes = nodes.map((n: any) => {
      if (String(n.id) !== String(nodeId)) return n

      if (assignMode === 'custom') {
        const deviceName = assignCustomDeviceName.trim()
        const measurementKey = assignMeasurementKey.trim()
        if (!deviceName || !measurementKey) {
          alert('Custom assignment requires a device name and measurement name.')
          return n
        }
        return { ...n, assignment: { mode: 'custom', deviceName, measurementKey } }
      }

      const deviceId = assignDeviceId.trim()
      const measurementKey = assignMeasurementKey.trim()
      if (!deviceId) {
        alert('Select a connected device.')
        return n
      }
      if (!measurementKey) {
        alert('Select a measurement to display.')
        return n
      }
      return { ...n, assignment: { mode: 'connected', deviceId, measurementKey } }
    })

    applyGraphEdit({ ...activeGraph, nodes: nextNodes, edges })
    closeAssign()
  }

  const clearAssign = () => {
    if (!assigningId) return
    const nodeId = assigningId
    const nextNodes = nodes.map((n: any) => {
      if (String(n.id) !== String(nodeId)) return n
      const copy = { ...n }
      delete (copy as any).assignment
      return copy
    })
    applyGraphEdit({ ...activeGraph, nodes: nextNodes, edges })
    closeAssign()
  }

  const autoArrange = () => {
    if (!buildMode) return
    const byId = new Map<string, any>(nodes.map((n: any) => [String(n.id), n]))
    const out = new Map<string, string[]>()
    const indeg = new Map<string, number>()
    for (const n of nodes) indeg.set(String(n.id), 0)
    for (const e of edges) {
      const f = String(e.from)
      const t = String(e.to)
      if (!byId.has(f) || !byId.has(t)) continue
      out.set(f, [...(out.get(f) ?? []), t])
      indeg.set(t, (indeg.get(t) ?? 0) + 1)
    }

    // Kahn-ish layering (works ok even if cycles exist)
    const level = new Map<string, number>()
    const q: string[] = []
    for (const [id, d] of indeg.entries()) {
      if (d === 0) q.push(id)
      level.set(id, 0)
    }
    while (q.length) {
      const id = q.shift()!
      const l = level.get(id) ?? 0
      for (const t of out.get(id) ?? []) {
        level.set(t, Math.max(level.get(t) ?? 0, l + 1))
        indeg.set(t, (indeg.get(t) ?? 0) - 1)
        if ((indeg.get(t) ?? 0) === 0) q.push(t)
      }
    }
    // If cycles: relax a few times
    for (let i = 0; i < 6; i++) {
      for (const e of edges) {
        const f = String(e.from)
        const t = String(e.to)
        if (!byId.has(f) || !byId.has(t)) continue
        level.set(t, Math.max(level.get(t) ?? 0, (level.get(f) ?? 0) + 1))
      }
    }

    const groups = new Map<number, string[]>()
    for (const n of nodes) {
      const id = String(n.id)
      const l = level.get(id) ?? 0
      groups.set(l, [...(groups.get(l) ?? []), id])
    }
    const levels = [...groups.keys()].sort((a, b) => a - b)
    for (const l of levels) groups.get(l)!.sort()

    const xStep = 260
    const yStep = 200
    const baseX = 80
    const baseY = 120

    const nextNodes = nodes.map((n: any) => {
      const id = String(n.id)
      const l = level.get(id) ?? 0
      const idx = (groups.get(l) ?? []).indexOf(id)
      return { ...n, x: baseX + l * xStep, y: baseY + idx * yStep }
    })

    applyGraphEdit({ ...activeGraph, nodes: nextNodes, edges })
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

  const manualDescriptor = manualId ? (descriptors as any)?.[manualId] : null
  const manualSpecs = manualDescriptor?.specs ?? {}
  const manualMetrics = manualDescriptor?.metrics ?? {}

  const fmt = (v: any) => {
    if (v === null || v === undefined) return '—'
    if (typeof v === 'string') return v
    if (typeof v === 'number' || typeof v === 'boolean') return String(v)
    try { return JSON.stringify(v) } catch { return String(v) }
  }

return (
  <>
  <PanZoomContainer
    contentWidth={viewWidth}
    contentHeight={viewHeight}
    buildMode={buildMode}
    enableMiniMap={showMiniMap}
    miniMapContent={miniMapContent}
    onViewStateChange={(s) => {
      viewStateRef.current = s
      setViewReady(Boolean(s?.containerSize?.width) && Boolean(s?.containerSize?.height))
    }}
    containerProps={{
      tabIndex: 0,
      role: 'region',
      'aria-label': 'Schematic canvas',
      className: 'schematic-focus-ring',
      onMouseDownCapture: (e) => {
        // Ensure keybindings only fire when the schematic has focus.
        const el = e.currentTarget as HTMLDivElement
        if (document.activeElement !== el) el.focus()
      },
      onKeyDown: (e) => {
        if (!buildMode) return

        const t = e.target as HTMLElement | null
        if (t) {
          const tag = t.tagName
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable) return
        }

        const mod = e.ctrlKey || e.metaKey
        if (!mod) return

        const key = String(e.key || '').toLowerCase()
        const redoCombo = key === 'y' || (key === 'z' && e.shiftKey)
        const undoCombo = key === 'z' && !e.shiftKey
        if (!redoCombo && !undoCombo) return

        e.preventDefault()
        e.stopPropagation()

        if (undoCombo) {
          undo()
        } else {
          redo()
        }
      },
    }}
    overlay={buildMode ? (
      <div style={{ position: 'absolute', left: 10, top: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          disabled={!viewReady}
          title={viewReady ? 'Add a new device to the current view' : 'Schematic is still initializing'}
          onClick={(e) => {
            e.stopPropagation()
            addDevice((e as any).shiftKey)
          }}
        >
          + Device
        </button>
        <button
          disabled={undoLen === 0}
          title={undoLen ? 'Undo last edit' : 'Nothing to undo'}
          onClick={(e) => {
            e.stopPropagation()
            undo()
          }}
        >
          Undo
        </button>
        <button
          disabled={redoLen === 0}
          title={redoLen ? 'Redo last undone edit' : 'Nothing to redo'}
          onClick={(e) => {
            e.stopPropagation()
            redo()
          }}
        >
          Redo
        </button>
        <div style={{ fontSize: 12, opacity: 0.8 }}>Build Mode: add/delete devices</div>


        {assigningId ? (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeAssign()
            }}
          >
            <div style={{ width: 520, maxWidth: 'calc(100vw - 32px)', background: '#0b1526', border: '1px solid rgba(90,170,255,0.25)', borderRadius: 10, padding: 14, textAlign: 'left' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontWeight: 700 }}>Assign measurement</div>
                <button onClick={(e) => { e.stopPropagation(); closeAssign() }}>Close</button>
              </div>

              <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
                <div style={{ width: 120, opacity: 0.9 }}>Source</div>
                <select value={assignMode} onChange={(e) => setAssignMode(e.target.value as any)} style={{ flex: 1 }}>
                  <option value="connected">Connected device</option>
                  <option value="custom">Custom (future device)</option>
                </select>
              </div>

              {assignMode === 'connected' ? (
                <>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
                    <div style={{ width: 120, opacity: 0.9 }}>Device</div>
                    <select value={assignDeviceId} onChange={(e) => { setAssignDeviceId(e.target.value); setAssignMeasurementKey('') }} style={{ flex: 1 }}>
                      {connectedDeviceIds.length ? connectedDeviceIds.map(id => (
                        <option key={id} value={id}>{id}</option>
                      )) : (
                        <option value="">(no connected devices)</option>
                      )}
                    </select>
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
                    <div style={{ width: 120, opacity: 0.9 }}>Measurement</div>
                    {(() => {
                      const ms = (assignDeviceId && (devices as any)?.[assignDeviceId]?.measurements)
                        ? Object.keys((devices as any)[assignDeviceId].measurements ?? {}).sort()
                        : []
                      if (!ms.length) {
                        return (
                          <input
                            placeholder="measurement name (e.g. temperature)"
                            value={assignMeasurementKey}
                            onChange={(e) => setAssignMeasurementKey(e.target.value)}
                            style={{ flex: 1 }}
                          />
                        )
                      }
                      return (
                        <select value={assignMeasurementKey} onChange={(e) => setAssignMeasurementKey(e.target.value)} style={{ flex: 1 }}>
                          <option value="">(select)</option>
                          {ms.map(k => <option key={k} value={k}>{k}</option>)}
                        </select>
                      )
                    })()}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
                    <div style={{ width: 120, opacity: 0.9 }}>Device name</div>
                    <input
                      placeholder="future backend device id"
                      value={assignCustomDeviceName}
                      onChange={(e) => setAssignCustomDeviceName(e.target.value)}
                      style={{ flex: 1 }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
                    <div style={{ width: 120, opacity: 0.9 }}>Measurement</div>
                    <input
                      placeholder="measurement name (e.g. pressure)"
                      value={assignMeasurementKey}
                      onChange={(e) => setAssignMeasurementKey(e.target.value)}
                      style={{ flex: 1 }}
                    />
                  </div>
                </>
              )}

              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
                <button onClick={(e) => { e.stopPropagation(); clearAssign() }} style={{ background: 'rgba(255,80,80,0.12)', border: '1px solid rgba(255,80,80,0.25)' }}>Clear</button>
                <button onClick={(e) => { e.stopPropagation(); closeAssign() }}>Cancel</button>
                <button onClick={(e) => { e.stopPropagation(); saveAssign() }} style={{ background: 'rgba(90,170,255,0.18)', border: '1px solid rgba(90,170,255,0.35)' }}>Save</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    ) : null}
    contextMenuItems={buildMode ? [
      { label: '↔ Auto-arrange', onClick: autoArrange },
    ] : undefined}
    style={{
      width: '100%',
      height: '70vh',
      overflow: 'hidden',
      background: '#071028',
      borderRadius: 8,
    }}
  >
    <svg
      ref={svgRef}
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
          return (
            <Wire
              key={i}
              from={from}
              to={to}
              buildMode={buildMode}
              onMouseDown={(ev) => {
                if (buildMode) {
                  ev.stopPropagation()
                }
              }}
            />
          )
        })}

        {/* live link preview */}
        {buildMode && linkDrag ? (() => {
          const fromNode = nodes.find((n:any) => String(n.id) === linkDrag.fromId)
          if (!fromNode) return null
          const x1 = fromNode.x
          const y1 = fromNode.y
          const x2 = linkDrag.to.x
          const y2 = linkDrag.to.y
          const midx = (x1 + x2) / 2
          const path = `M ${x1} ${y1} C ${midx} ${y1} ${midx} ${y2} ${x2} ${y2}`
          return (
            <path
              d={path}
              stroke="#ffcc33"
              strokeWidth={3}
              fill="none"
              strokeOpacity={0.9}
              strokeDasharray="6 6"
              pointerEvents="none"
            />
          )
        })() : null}

        {/* nodes */}
        {nodes.map((n:any) => {
          const assignment = (n as any).assignment
          const assignedFrom = assignment?.mode === 'connected' ? String(assignment.deviceId ?? '') : assignment?.mode === 'custom' ? String(assignment.deviceName ?? '') : ''
          const measurementKey = String(assignment?.measurementKey ?? '')

          const baseStatus = (devices as any)?.[String(n.id)]
          const assignedStatus = (assignment?.mode === 'connected' && assignedFrom) ? (devices as any)?.[assignedFrom] : baseStatus

          const status = (measurementKey && assignedStatus) ? {
            ...assignedStatus,
            measurements: { [measurementKey]: (assignedStatus as any)?.measurements?.[measurementKey] },
          } : assignedStatus
          const isSelected = selected === n.id
          const size = getNodeSize(n.id)
          const x = n.x - size.width/2
          const y = n.y - size.height/2

          const schemaForType = (activeSchema as any)?.[n.type]

          return (
            <foreignObject key={n.id} x={x} y={y} width={size.width} height={size.height}>
              <div
                data-panzoom-no-pan="true"
                style={{ width:'100%', height:'100%', position:'relative', boxSizing:'border-box' }}
                onMouseDown={(e) => {
                  if (!buildMode) return
                  if (e.target instanceof HTMLElement && e.target.closest('[data-schematic-ui="true"]')) return
                  e.stopPropagation()

                  const w = toWorld((e as any).clientX, (e as any).clientY)
                  if (!w) return

                  const src = nodes.find((x: any) => x.id === n.id)
                  if (!src) return

                  draggingRef.current = {
                    id: n.id,
                    startWorld: w,
                    startNode: { x: src.x, y: src.y },
                    moved: false,
                    baseGraph: activeGraph,
                  }

                  const onMove = (ev: MouseEvent) => {
                    const dr = draggingRef.current
                    if (!dr || dr.id !== n.id) return
                    const cw = toWorld(ev.clientX, ev.clientY)
                    if (!cw) return
                    const dx = cw.x - dr.startWorld.x
                    const dy = cw.y - dr.startWorld.y
                    if (Math.abs(dx) + Math.abs(dy) > 2 && !dr.moved) {
                      dr.moved = true
                      pushUndo(dr.baseGraph ?? activeGraph)
                    }
                    setNodePos(dr.id, dr.startNode.x + dx, dr.startNode.y + dy)
                  }
                  const onUp = () => {
                    window.removeEventListener('mousemove', onMove)
                    window.removeEventListener('mouseup', onUp)
                    draggingRef.current = null
                  }
                  window.addEventListener('mousemove', onMove)
                  window.addEventListener('mouseup', onUp)
                }}
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
                    <div style={{ display:'flex', gap:6 }} data-schematic-ui="true">
                      <button onClick={(e)=>{ e.stopPropagation(); onOpenDialog?.(n.id) }}>Inspect</button>
                      <button onClick={(e)=>{ e.stopPropagation(); openManual(String(n.id)) }}>Man</button>
                      {buildMode && (
                        <>
                          <button
                            onClick={(e)=>{
                              e.stopPropagation();
                              openAssign(String(n.id))
                            }}
                          >
                            Assign
                          </button>
                          <button
                            onClick={(e)=>{
                              e.stopPropagation();
                              deleteDevice(n.id)
                            }}
                            style={{ background: 'rgba(255,80,80,0.15)', border: '1px solid rgba(255,80,80,0.35)' }}
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </div>

                    {buildMode && (
                      <div
                        data-schematic-ui="true"
                        title="Drag to connect a wire"
                        onMouseDown={(e) => startLinkDrag(String(n.id), e)}
                        style={{
                          position: 'absolute',
                          right: -10,
                          top: 32,
                          width: 18,
                          height: 18,
                          borderRadius: 999,
                          background: '#0b2a18',
                          border: '1px solid rgba(200,255,200,0.35)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'crosshair',
                          color: 'rgba(220,255,220,0.9)',
                          fontSize: 12,
                          userSelect: 'none',
                        }}
                      >
                        +
                      </div>
                    )}
                  </div>
                )}

                <ComponentNode
                  id={n.id}
                  label={n.label ?? n.id}
                  type={n.type}
                  status={status}
                  schema={schemaForType}
                  buildMode={buildMode}
                  width={size.width}
                  height={size.height}
                  onResize={(w:number,h:number)=> updateNodeSize(n.id, w, h)}
                  spacing={spacing}
                  assignedFrom={assignedFrom}
                  primaryMeasurementKey={measurementKey}
                />
              </div>
            </foreignObject>
          )
        })}
      </g>
    </svg>
  </PanZoomContainer>
  {manualId ? (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeManual()
      }}
    >
      <div style={{ width: 720, maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 32px)', overflow: 'auto', background: '#0b1526', border: '1px solid rgba(90,170,255,0.25)', borderRadius: 10, padding: 14, textAlign: 'left' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontWeight: 800 }}>Manual • {manualId}</div>
          <button onClick={(e) => { e.stopPropagation(); closeManual() }}>Close</button>
        </div>

        {!manualDescriptor ? (
          <div style={{ color: 'rgba(230,238,248,0.8)' }}>
            No descriptor available yet for this device. Connect the backend and wait for discovery.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: 8, marginBottom: 12 }}>
              <div style={{ opacity: 0.8 }}>Type</div><div>{fmt(manualDescriptor.type)}</div>
              <div style={{ opacity: 0.8 }}>Status</div><div>{fmt(manualDescriptor.status)}</div>
              <div style={{ opacity: 0.8 }}>Manufacturer</div><div>{fmt((manualSpecs as any).manufacturer)}</div>
              <div style={{ opacity: 0.8 }}>Manual / Datasheet</div>
              <div>
                {typeof (manualSpecs as any).datasheet_url === 'string' && (manualSpecs as any).datasheet_url ? (
                  <a href={(manualSpecs as any).datasheet_url} target="_blank" rel="noreferrer" style={{ color: '#9ec7ff' }}>
                    {(manualSpecs as any).datasheet_url}
                  </a>
                ) : (
                  <span style={{ opacity: 0.85 }}>—</span>
                )}
              </div>
            </div>

            <div style={{ fontWeight: 700, marginBottom: 6 }}>Specs</div>
            <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
              {Object.keys(manualSpecs).length ? (
                Object.keys(manualSpecs).sort().map(k => (
                  <div key={k} style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 10, padding: '6px 10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ opacity: 0.85 }}>{k}</div>
                    <div style={{ color: 'rgba(230,238,248,0.95)', overflowWrap: 'anywhere' }}>{fmt((manualSpecs as any)[k])}</div>
                  </div>
                ))
              ) : (
                <div style={{ padding: 10, opacity: 0.8 }}>No specs provided.</div>
              )}
            </div>

            <div style={{ fontWeight: 700, marginBottom: 6 }}>Metrics</div>
            <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, overflow: 'hidden' }}>
              {Object.keys(manualMetrics).length ? (
                Object.keys(manualMetrics).sort().map(k => {
                  const m = (manualMetrics as any)[k] ?? {}
                  const meta = [
                    m.kind ? `kind=${m.kind}` : null,
                    m.unit ? `unit=${m.unit}` : null,
                    m.backend_unit ? `backend_unit=${m.backend_unit}` : null,
                    typeof m.precision === 'number' ? `precision=${m.precision}` : null,
                    typeof m.min === 'number' ? `min=${m.min}` : null,
                    typeof m.max === 'number' ? `max=${m.max}` : null,
                  ].filter(Boolean).join(' • ')
                  return (
                    <div key={k} style={{ padding: '6px 10px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                        <div style={{ fontWeight: 650 }}>{k}</div>
                        <div style={{ opacity: 0.75 }}>{meta || '—'}</div>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div style={{ padding: 10, opacity: 0.8 }}>No metrics provided.</div>
              )}
            </div>

            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', opacity: 0.9 }}>Raw descriptor JSON</summary>
              <pre style={{ marginTop: 8, background: '#01101a', padding: 10, borderRadius: 8, overflow: 'auto' }}>{JSON.stringify(manualDescriptor, null, 2)}</pre>
            </details>
          </>
        )}
      </div>
    </div>
  ) : null}
  </>
)
}