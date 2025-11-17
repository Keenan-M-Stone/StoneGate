export function fmtMeasurement(m:any){
  if (!m) return '—'
  const v = (typeof m.value === 'number') ? m.value.toFixed(3) : m.value
  if (m.uncertainty !== undefined) return `${v} ± ${m.uncertainty}`
  return v
}