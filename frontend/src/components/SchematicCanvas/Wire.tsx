export default function Wire({ from, to }:{from:any, to:any}){
  const x1 = from.x
  const y1 = from.y
  const x2 = to.x
  const y2 = to.y
  const midx = (x1 + x2)/2
  const path = `M ${x1} ${y1} C ${midx} ${y1} ${midx} ${y2} ${x2} ${y2}`
  return (
    <path d={path} stroke="#88aaff" strokeWidth={2} fill="none" strokeOpacity={0.6} />
  )
}