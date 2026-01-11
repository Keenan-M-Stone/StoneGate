import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep this in sync with the frontend policy in frontend/src/api/compat.ts
const MIN_PROTOCOL = '1.0.0'

function parseSemver(v) {
  if (typeof v !== 'string') return null
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

function cmpSemver(a, b) {
  if (!a || !b) return null
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

export function checkProtocolCompatibility(protocolVersion) {
  const parsed = parseSemver(protocolVersion)
  const min = parseSemver(MIN_PROTOCOL)
  if (!parsed) {
    return {
      compatible: false,
      reason: 'missing_or_invalid_protocol_version',
      protocolVersion: protocolVersion ?? null,
      required: MIN_PROTOCOL,
    }
  }
  if (parsed.major !== min.major) {
    return {
      compatible: false,
      reason: `major_mismatch:${parsed.major}!=${min.major}`,
      protocolVersion,
      required: MIN_PROTOCOL,
    }
  }
  if (cmpSemver(parsed, min) < 0) {
    return {
      compatible: false,
      reason: `too_old:${protocolVersion}<${MIN_PROTOCOL}`,
      protocolVersion,
      required: MIN_PROTOCOL,
    }
  }
  return { compatible: true, reason: 'ok', protocolVersion, required: MIN_PROTOCOL }
}

function run(cmd, args, { allowFail = false } = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8' }).trim()
  } catch (e) {
    if (allowFail) return ''
    throw e
  }
}

function findRepoRoot() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  let cur = path.resolve(here, '..', '..')
  for (let i = 0; i < 8; i++) {
    const probe2 = path.join(cur, 'backend')
    if (existsSync(probe2)) return cur
    cur = path.dirname(cur)
  }
  return path.resolve(here, '..', '..')
}

function parseSsListeners() {
  const txt = run('ss', ['-ltnp'], { allowFail: true })
  const lines = txt.split(/\r?\n/)
  /** @type {Map<number, {ports:Set<number>, procs:Set<string>}>} */
  const byPid = new Map()

  for (const line of lines) {
    if (!line.startsWith('LISTEN')) continue

    const parts = line.trim().split(/\s+/)
    const local = parts[3] ?? ''
    const portStr = local.includes(':') ? local.split(':').slice(-1)[0] : ''
    const portMatch = portStr ? [portStr, portStr] : null
    const pidMatch = line.match(/pid=(\d+)/)
    const procMatch = line.match(/users:\(\(\"([^\"]+)\"/)
    if (!portMatch || !pidMatch) continue

    const port = Number(portMatch[1])
    const pid = Number(pidMatch[1])
    const proc = procMatch ? procMatch[1] : 'unknown'

    if (!byPid.has(pid)) byPid.set(pid, { ports: new Set(), procs: new Set() })
    byPid.get(pid).ports.add(port)
    byPid.get(pid).procs.add(proc)
  }

  return byPid
}

function getProcessInfo(pid) {
  const out = run('ps', ['-p', String(pid), '-o', 'pid=,comm=,args='], { allowFail: true })
  if (!out) return null
  const m = out.match(/^\s*(\d+)\s+(\S+)\s+([\s\S]+)$/)
  if (!m) return { pid, comm: 'unknown', args: out }
  return { pid: Number(m[1]), comm: m[2], args: m[3] }
}

function looksLikeFrontend(proc) {
  const a = proc.args
  if (proc.comm !== 'node' && proc.comm !== 'nodejs') return false
  return a.includes('vite') || a.includes('rolldown-vite') || (a.includes('pnpm') && a.includes(' dev') && a.includes('frontend'))
}

function classifyBackend(proc) {
  const args = proc.args
  if (args.includes('--sim')) return { subtype: 'sim', safe: true }
  return { subtype: 'real/unknown', safe: false }
}

function findToolboxClient(repoRoot) {
  const candidates = [
    path.join(repoRoot, 'tools', 'build', 'toolbox_ws_client'),
    path.join(repoRoot, 'tools', 'build', 'Release', 'toolbox_ws_client'),
  ]
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return null
}

function tryRpc(toolboxPath, wsUrl, method, params) {
  if (!toolboxPath) return null
  const args = [wsUrl, method]
  if (params !== undefined) args.push(JSON.stringify(params))
  const out = run(toolboxPath, args, { allowFail: true })
  if (!out) return null
  try {
    const parsed = JSON.parse(out)
    if (parsed && typeof parsed === 'object' && parsed.result && typeof parsed.result === 'object') {
      return parsed.result
    }
    return parsed
  } catch {
    return null
  }
}

function summarizeBackend(toolboxPath, port) {
  const wsUrl = `ws://localhost:${port}/status`
  const info = tryRpc(toolboxPath, wsUrl, 'backend.info')
  const list = tryRpc(toolboxPath, wsUrl, 'devices.list')

  let deviceCount = undefined
  let allSim = undefined
  const devices = list && typeof list === 'object' ? list.devices : undefined
  if (Array.isArray(devices)) {
    deviceCount = devices.length
    const simulatedFlags = devices
      .map((d) => (d && typeof d === 'object' ? d.simulated : undefined))
      .filter((v) => v !== undefined)
    if (simulatedFlags.length) allSim = simulatedFlags.every(Boolean)
  }

  return {
    wsUrl,
    build_time: info?.build_time,
    git_commit: info?.git_commit,
    protocol_version: info?.protocol_version,
    mode: info?.mode,
    capabilities: info?.capabilities,
    device_graph_path: info?.device_graph_path,
    graph_hash: info?.graph_hash,
    schema_hash: info?.schema_hash,
    compatibility: checkProtocolCompatibility(info?.protocol_version),
    port: info?.port ?? port,
    deviceCount,
    allSim,
  }
}

export function listInstances({ quiet = true, json = false } = {}) {
  const repoRoot = findRepoRoot()
  const toolboxPath = findToolboxClient(repoRoot)
  const listeners = parseSsListeners()

  /** @type {Array<any>} */
  const instances = []

  for (const [pid, l] of listeners.entries()) {
    const p = getProcessInfo(pid)
    if (!p) continue

    const ports = l.ports

    if (p.comm === 'StoneGate') {
      const cls = classifyBackend(p)
      const firstPort = Array.from(ports)[0]
      const extra = firstPort ? summarizeBackend(toolboxPath, firstPort) : {}

      let subtype = cls.subtype
      let safe = cls.safe
      if (extra.allSim === true) {
        subtype = 'sim'
        safe = true
      }

      instances.push({
        kind: 'backend',
        subtype,
        safeToShutdown: safe,
        pid,
        ports: Array.from(ports),
        cmd: p.args,
        ...extra,
      })
      continue
    }

    if (looksLikeFrontend(p)) {
      instances.push({
        kind: 'frontend',
        subtype: 'dev/preview',
        safeToShutdown: true,
        pid,
        ports: Array.from(ports),
        cmd: p.args,
      })
    }
  }

  instances.sort((a, b) => (a.kind + a.subtype + a.pid).localeCompare(b.kind + b.subtype + b.pid))

  if (json && !quiet) {
    process.stdout.write(JSON.stringify({ instances }, null, 2) + '\n')
  }

  return instances
}

export function killPids(pids, { forceUnsafe = false, safeOnly = false, dryRun = false } = {}) {
  const instances = listInstances({ quiet: true })
  const byPid = new Map(instances.map((x) => [x.pid, x]))

  /** @type {number[]} */
  const selected = []

  if (safeOnly) {
    for (const inst of instances) {
      if (inst.safeToShutdown) selected.push(inst.pid)
    }
  } else {
    for (const pid of pids) selected.push(pid)
  }

  const unique = Array.from(new Set(selected))
  if (!unique.length) {
    return { ok: false, error: 'No PIDs selected.', code: 2, selected: [] }
  }

  const blocked = []
  for (const pid of unique) {
    const inst = byPid.get(pid)
    if (!inst) continue
    if (!inst.safeToShutdown && !forceUnsafe) blocked.push(inst)
  }

  if (blocked.length) {
    return {
      ok: false,
      error: 'Refusing to kill potentially-unsafe instances (use forceUnsafe to override).',
      code: 3,
      selected: unique,
      blocked,
    }
  }

  if (dryRun) {
    return { ok: true, dryRun: true, selected: unique }
  }

  for (const pid of unique) {
    run('kill', ['-TERM', String(pid)], { allowFail: true })
  }

  run('sleep', ['0.4'], { allowFail: true })

  /** @type {number[]} */
  const killed = []
  /** @type {number[]} */
  const stillAlive = []

  for (const pid of unique) {
    const still = getProcessInfo(pid)
    if (!still) {
      killed.push(pid)
      continue
    }
    run('kill', ['-KILL', String(pid)], { allowFail: true })
    const after = getProcessInfo(pid)
    if (!after) killed.push(pid)
    else stillAlive.push(pid)
  }

  return { ok: true, selected: unique, killed, stillAlive }
}

export function pollBackendsOnce(wsUrls) {
  const repoRoot = findRepoRoot()
  const toolboxPath = findToolboxClient(repoRoot)
  if (!toolboxPath) {
    return { ok: false, error: 'tools/build/toolbox_ws_client not found' }
  }

  const ts = Date.now()
  const rows = []

  for (const wsUrl of wsUrls) {
    const polled = tryRpc(toolboxPath, wsUrl, 'devices.poll', {})
    const updates = polled && typeof polled === 'object' && Array.isArray(polled.updates) ? polled.updates : []

    const jobIds = new Set()
    const recordingIds = new Set()

    for (const u of updates) {
      const measurement = u && typeof u === 'object' ? u.measurement : undefined
      if (!measurement || typeof measurement !== 'object') continue

      const stack = [measurement]
      while (stack.length) {
        const cur = stack.pop()
        if (!cur || typeof cur !== 'object') continue
        if (Array.isArray(cur)) {
          for (const it of cur) stack.push(it)
          continue
        }
        for (const [k, v] of Object.entries(cur)) {
          if (k === 'job_id') jobIds.add(String(v))
          if (k === 'recording_id') recordingIds.add(String(v))
          if (v && typeof v === 'object') stack.push(v)
        }
      }
    }

    rows.push({
      ts_ms: ts,
      wsUrl,
      total_devices: updates.length,
      job_ids: Array.from(jobIds),
      recording_ids: Array.from(recordingIds),
    })
  }

  return { ok: true, ts_ms: ts, backends: rows }
}
