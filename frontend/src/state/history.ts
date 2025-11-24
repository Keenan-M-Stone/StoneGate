type Sample = { ts: number, measurements: Record<string, number | null> }

class HistoryStore {
  // per-device circular buffer of samples
  data: Map<string, Sample[]> = new Map()
  maxSamples = 2000

  addSample(deviceId: string, measurements: Record<string, number | null>, ts?: number){
    const t = ts ?? Date.now()
    const arr = this.data.get(deviceId) ?? []
    arr.push({ ts: t, measurements })
    if (arr.length > this.maxSamples) arr.splice(0, arr.length - this.maxSamples)
    this.data.set(deviceId, arr)
  }

  // return series of {ts, value} for a metric over the last `seconds` seconds, optionally offset by ms
  getSeries(deviceId: string, metric: string, seconds: number, offsetMs = 0){
    const now = Date.now() - offsetMs
    const start = now - seconds * 1000
    const arr = this.data.get(deviceId) ?? []
    const out: { ts:number, value: number | null }[] = []
    for (const s of arr){
      if (s.ts < start) continue
      if (s.ts > now) continue
      out.push({ ts: s.ts, value: s.measurements[metric] ?? null })
    }
    return out
  }

  // list metrics available for a device
  metricsFor(deviceId: string){
    const arr = this.data.get(deviceId) ?? []
    for (let i = arr.length-1; i>=0; --i){
      const keys = Object.keys(arr[i].measurements)
      if (keys.length) return keys
    }
    return [] as string[]
  }

  // return a snapshot of latest measurements (most recent sample)
  latest(deviceId: string){
    const arr = this.data.get(deviceId) ?? []
    return arr.length? arr[arr.length-1] : null
  }
}

const History = new HistoryStore()
export default History
