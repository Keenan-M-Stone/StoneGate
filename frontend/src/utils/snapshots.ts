import Backend from '../api/backend'
import { useDeviceStore } from '../state/store'

import localGraph from '../../../shared/protocol/DeviceGraph.json'
import localSchema from '../../../shared/protocol/ComponentSchema.json'

const SNAPSHOT_KEY = 'stonegate_snapshots_v1'

export type SnapshotV1 = {
  format: 'stonegate.snapshot'
  version: 1
  name: string
  created_ts_ms: number
  backend: {
    endpoint?: string
    info?: any
  }
  schematic: {
    source: 'backend' | 'local'
    graph: any
    schema: any
    meta?: any
  }
  devices: {
    list?: any
    poll?: any
  }
}

export type SnapshotSaveMode = { overwrite: boolean; autoRename: boolean }

function sanitizeBaseName(name: string) {
  return (name || '').trim().replace(/\s+/g, '_')
}

export function autoSnapshotName(base: string) {
  const ts = new Date()
  const pad2 = (n: number) => String(n).padStart(2, '0')
  return `${sanitizeBaseName(base) || 'snapshot'}_${ts.getFullYear()}${pad2(ts.getMonth() + 1)}${pad2(ts.getDate())}_${pad2(ts.getHours())}${pad2(ts.getMinutes())}${pad2(ts.getSeconds())}`
}

function loadSnapshotDb(): Record<string, SnapshotV1> {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, SnapshotV1>
  } catch {
    return {}
  }
}

function saveSnapshotDb(db: Record<string, SnapshotV1>) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(db))
  } catch {
    // ignore
  }
}

export function listSnapshotNames(): string[] {
  const db = loadSnapshotDb()
  return Object.keys(db).sort()
}

export function getSnapshot(name: string): SnapshotV1 | null {
  const db = loadSnapshotDb()
  return db[name] ?? null
}

export function putSnapshot(name: string, snap: SnapshotV1, mode: SnapshotSaveMode): { ok: true; name: string } | { ok: false; error: string } {
  const db = loadSnapshotDb()
  const exists = !!db[name]
  if (exists && !mode.overwrite) {
    if (!mode.autoRename) return { ok: false, error: 'snapshot name already exists (enable overwrite or auto-rename)' }
    let i = 1
    while (i < 10_000) {
      const candidate = `${name}_${String(i).padStart(3, '0')}`
      if (!db[candidate]) {
        db[candidate] = { ...snap, name: candidate }
        saveSnapshotDb(db)
        return { ok: true, name: candidate }
      }
      i++
    }
    return { ok: false, error: 'failed to auto-rename snapshot (too many conflicts)' }
  }

  db[name] = snap
  saveSnapshotDb(db)
  return { ok: true, name }
}

export async function captureSnapshotNow(nameBase: string): Promise<SnapshotV1> {
  const stats = Backend.stats()
  const info = await Backend.rpc('backend.info', {}, 6000)
  const list = await Backend.rpc('devices.list', {}, 8000)
  const poll = await Backend.rpc('devices.poll', {}, 8000)

  const schematicOverride = useDeviceStore.getState().schematicOverride
  const source = schematicOverride ? 'backend' : 'local'
  const graph = schematicOverride?.graph ?? (localGraph as any)
  const schema = schematicOverride?.schema ?? (localSchema as any)

  const snap: SnapshotV1 = {
    format: 'stonegate.snapshot',
    version: 1,
    name: sanitizeBaseName(nameBase) || autoSnapshotName('snapshot'),
    created_ts_ms: Date.now(),
    backend: {
      endpoint: stats.endpoint,
      info,
    },
    schematic: {
      source,
      graph,
      schema,
      meta: schematicOverride?.meta,
    },
    devices: {
      list,
      poll,
    },
  }

  return snap
}

export function downloadSnapshotJson(snap: SnapshotV1, filename?: string) {
  const bytes = JSON.stringify(snap, null, 2)
  const blob = new Blob([bytes], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || `${snap.name}.snapshot.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 250)
}

export async function loadSnapshotFromFile(file: File): Promise<SnapshotV1> {
  const text = await file.text()
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object') throw new Error('invalid snapshot json')
  if (parsed.format !== 'stonegate.snapshot') throw new Error('not a stonegate.snapshot file')
  if (parsed.version !== 1) throw new Error(`unsupported snapshot version: ${parsed.version}`)
  return parsed as SnapshotV1
}
