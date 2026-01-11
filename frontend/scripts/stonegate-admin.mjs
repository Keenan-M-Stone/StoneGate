#!/usr/bin/env node

import { killPids, listInstances, pollBackendsOnce } from './stonegate-admin-lib.mjs'

function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) {
      out._.push(a)
      continue
    }
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      out[key] = next
      i++
    } else {
      out[key] = true
    }
  }
  return out
}

function pad(s, n) {
  const str = String(s)
  return str.length >= n ? str : str + ' '.repeat(n - str.length)
}

function printInstances(instances) {
  if (!instances.length) {
    console.log('No StoneGate frontend/backend listeners found.')
    return
  }

  console.log(
    pad('KIND', 10) + pad('SUBTYPE', 14) + pad('SAFE', 6) + pad('PID', 8) + pad('PORTS', 10) + 'DETAIL'
  )

  for (const inst of instances) {
    const safe = inst.safeToShutdown ? 'yes' : 'NO'
    const ports = inst.ports?.length ? inst.ports.join(',') : ''
    const detail =
      inst.kind === 'backend'
        ? `${inst.wsUrl ?? ''} devices=${inst.deviceCount ?? '?'} commit=${inst.git_commit ?? '?'} protocol=${inst.protocol_version ?? '?'} compat=${inst.compatibility?.compatible ? 'OK' : 'NO'}`
        : ''
    console.log(
      pad(inst.kind, 10) +
        pad(inst.subtype, 14) +
        pad(safe, 6) +
        pad(String(inst.pid), 8) +
        pad(ports, 10) +
        detail
    )
  }
}

function watchBackendsCli({ wsUrls, intervalSec = 1.0, once = false, json = false } = {}) {
  const tick = () => {
    const res = pollBackendsOnce(wsUrls)
    if (!res || res.ok === false) {
      console.error(res?.error ?? 'pollBackendsOnce failed')
      process.exitCode = 2
      return false
    }
    if (json) {
      process.stdout.write(JSON.stringify(res) + '\n')
      return true
    }
    for (const r of res.backends) {
      const jobs = r.job_ids?.length ? ` job_ids=${r.job_ids.join(',')}` : ''
      const recs = r.recording_ids?.length ? ` recording_ids=${r.recording_ids.join(',')}` : ''
      console.log(`${new Date(r.ts_ms).toISOString()} ws=${r.wsUrl} devices=${r.total_devices}${jobs}${recs}`)
    }
    return true
  }

  if (!tick()) return
  if (once) return

  const sleepMs = Math.max(50, Math.floor(intervalSec * 1000))
  setInterval(tick, sleepMs)
}

function help() {
  console.log(`stonegate-admin: list and safely shutdown StoneGate instances\n\nUsage:\n  node scripts/stonegate-admin.mjs list [--json]\n  node scripts/stonegate-admin.mjs kill --pid <pid[,pid...]> [--force] [--dry-run]\n  node scripts/stonegate-admin.mjs kill --safe [--dry-run]\n  node scripts/stonegate-admin.mjs watch [--ws <ws://.../status>] [--interval <sec>] [--once] [--json] [--all]\n\nNotes:\n- By default, only instances that look like StoneGate frontend dev servers or StoneGate simulators are considered safe.\n- Non-sim backends are treated as potentially hardware-backed and require --force to kill.\n- watch polls devices via RPC and surfaces any job_id / recording_id fields if present in measurements.\n`)
}

function main() {
  const args = parseArgs(process.argv)
  const cmd = args._[0] ?? 'list'

  if (cmd === 'list' || cmd === 'ps') {
    const instances = listInstances({ quiet: !!args.json, json: !!args.json })
    if (args.json) return
    printInstances(instances)
    return
  }

  if (cmd === 'watch') {
    const intervalSec = args.interval ? Number(args.interval) : 1.0
    const once = !!args.once
    const json = !!args.json

    /** @type {string[]} */
    let wsUrls = []
    if (args.ws) {
      wsUrls = [String(args.ws)]
    } else {
      const all = listInstances({ quiet: true })
      const backends = all.filter((x) => x.kind === 'backend')
      const selected = args.all ? backends : backends.filter((x) => x.safeToShutdown)
      wsUrls = selected.map((x) => x.wsUrl).filter(Boolean)
    }

    if (!wsUrls.length) {
      console.error('No backend WS URLs selected. Use --ws ws://localhost:PORT/status or start a backend.')
      process.exitCode = 2
      return
    }

    if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
      console.error('Invalid --interval; expected a positive number of seconds.')
      process.exitCode = 2
      return
    }

    watchBackendsCli({ wsUrls, intervalSec, once, json })
    return
  }

  if (cmd === 'kill' || cmd === 'stop' || cmd === 'shutdown') {
    const safeOnly = !!args.safe
    const dryRun = !!args['dry-run']
    const forceUnsafe = !!args.force
    const pidArg = args.pid

    let pids = []
    if (pidArg) {
      pids = String(pidArg)
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
    }

    if (!safeOnly && !pids.length) {
      console.error('Missing --pid or use --safe')
      help()
      process.exitCode = 2
      return
    }

    const res = killPids(pids, { forceUnsafe, safeOnly, dryRun })
    if (!res.ok) {
      console.error(res.error)
      if (Array.isArray(res.blocked) && res.blocked.length) {
        for (const b of res.blocked) {
          console.error(`- pid=${b.pid} kind=${b.kind} subtype=${b.subtype} ports=${(b.ports || []).join(',')}`)
        }
      }
      process.exitCode = res.code ?? 2
      return
    }
    console.log('Selected PIDs:', (res.selected || []).join(', '))
    if (res.dryRun) {
      console.log('Dry-run: not sending signals.')
      return
    }
    if (res.stillAlive?.length) {
      console.log('Still alive after SIGKILL:', res.stillAlive.join(', '))
    }
    return
  }

  help()
  process.exitCode = 2
}

main()
