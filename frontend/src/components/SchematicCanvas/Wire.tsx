export default function Wire({ from, to, buildMode=false, onMouseDown }:{from:any, to:any, buildMode?: boolean, onMouseDown?: (e: React.MouseEvent) => void }){
  const x1 = from.x
  const y1 = from.y
  const x2 = to.x
  const y2 = to.y
  const midx = (x1 + x2)/2
  const path = `M ${x1} ${y1} C ${midx} ${y1} ${midx} ${y2} ${x2} ${y2}`
  return (
    <g>
      {/* wider invisible hit area so wires are easy to grab in build mode */}
      <path
        d={path}
        stroke="transparent"
        strokeWidth={16}
        fill="none"
        style={{ pointerEvents: 'stroke' }}
        onMouseDown={(e) => {
          if (buildMode) e.stopPropagation()
          onMouseDown?.(e)
        }}
      />
      <path d={path} stroke="#88aaff" strokeWidth={2} fill="none" strokeOpacity={0.6} />
    </g>
  )
}