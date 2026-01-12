export const name = 'example-script'

export const transforms = [
  { id: 'identity', label: 'Identity' },
  { id: 'derivative', label: 'Derivative (Δy/Δt)' },
]

export function transform(ctx) {
  if (ctx.transformId === 'identity') {
    return {
      kind: 'time',
      points: ctx.points,
      xLabel: 'Time (ms)',
      yLabel: ctx.metric,
    }
  }

  const pts = []
  for (let i = 1; i < ctx.points.length; i++) {
    const a = ctx.points[i - 1]
    const b = ctx.points[i]
    const dt = (b.x - a.x) / 1000
    if (!(dt > 0)) continue
    pts.push({ x: b.x, y: (b.y - a.y) / dt })
  }

  return {
    kind: 'time',
    points: pts,
    xLabel: 'Time (ms)',
    yLabel: `${ctx.metric} (d/dt)`,
  }
}
