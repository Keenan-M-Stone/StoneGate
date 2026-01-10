import React from 'react'
import Backend from '../api/backend'
import { useDeviceStore } from '../state/store'
import History from '../state/history'

const MACROS_KEY = 'stonegate_script_macros_v2'
const LAYOUT_KEY = 'stonegate_macro_wizard_layout_v1'

type RunStatus = 'idle' | 'running' | 'paused' | 'finished' | 'canceled' | 'error'
type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'canceled' | 'error'

type ConditionOp = '<' | '<=' | '>' | '>=' | '==' | '!='
type Condition = {
  device_id: string
  metric: string
  op: ConditionOp
  value: number
}

type StepBase = {
  id: string
  name: string
  enabled?: boolean
}

type DeviceActionStep = StepBase & {
  kind: 'deviceAction'
  device_id: string
  action: any
  safeClamp?: boolean
}

type WaitForStableStep = StepBase & {
  kind: 'waitForStable'
  device_id: string
  metric: string
  tolerance: number
  window_ms: number
  consecutive: number
  timeout_ms: number
}

type SleepStep = StepBase & {
  kind: 'sleep'
  ms: number
}

type RecordBlockStep = StepBase & {
  kind: 'record'
  params: any
  steps: Step[]
}

type WhileBlockStep = StepBase & {
  kind: 'while'
  condition: Condition
  max_iterations: number
  steps: Step[]
}

type IfElseBlockStep = StepBase & {
  kind: 'ifElse'
  condition: Condition
  thenSteps: Step[]
  elseSteps: Step[]
}

type Step = DeviceActionStep | WaitForStableStep | SleepStep | RecordBlockStep | WhileBlockStep | IfElseBlockStep

type ScriptMacro = {
  id: string
  name: string
  steps: Step[]
}

type Layout = { x: number; y: number; w: number; h: number }

type MenuItem = { label: string; onClick: () => void; disabled?: boolean }
type ContextMenuState = { x: number; y: number; items: MenuItem[] } | null

function newId() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = crypto
    if (c?.randomUUID) return c.randomUUID()
  } catch {}
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value, null, 2))
  } catch {}
}

function clamp(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return n
  return Math.min(hi, Math.max(lo, n))
}

function evalCondition(latest: number | null | undefined, op: ConditionOp, value: number) {
  if (latest === null || latest === undefined || !Number.isFinite(latest)) return false
  switch (op) {
    case '<':
      return latest < value
    case '<=':
      return latest <= value
    case '>':
      return latest > value
    case '>=':
      return latest >= value
    case '==':
      return latest === value
    case '!=':
      return latest !== value
  }
}

function stepDefault(kind: Step['kind']): Step {
  const id = newId()
  if (kind === 'deviceAction') {
    return { id, name: 'Device Action', kind, device_id: '', action: { zero: true }, safeClamp: true, enabled: true }
  }
  if (kind === 'waitForStable') {
    return { id, name: 'Wait For Stable', kind, device_id: '', metric: '', tolerance: 0.5, window_ms: 2000, consecutive: 3, timeout_ms: 60_000, enabled: true }
  }
  if (kind === 'sleep') {
    return { id, name: 'Sleep', kind, ms: 500, enabled: true }
  }
  if (kind === 'record') {
    return { id, name: 'Record', kind, params: {}, steps: [], enabled: true }
  }
  if (kind === 'while') {
    return { id, name: 'While', kind, condition: { device_id: '', metric: '', op: '<', value: 0 }, max_iterations: 1000, steps: [], enabled: true }
  }
  return { id, name: 'If / Else', kind: 'ifElse', condition: { device_id: '', metric: '', op: '<', value: 0 }, thenSteps: [], elseSteps: [], enabled: true }
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function updateStepById(steps: Step[], stepId: string, updater: (s: Step) => Step): Step[] {
  const out: Step[] = []
  for (const s of steps) {
    if (s.id === stepId) {
      out.push(updater(s))
      continue
    }
    if (s.kind === 'record') {
      out.push({ ...s, steps: updateStepById(s.steps, stepId, updater) })
      continue
    }
    if (s.kind === 'while') {
      out.push({ ...s, steps: updateStepById(s.steps, stepId, updater) })
      continue
    }
    if (s.kind === 'ifElse') {
      out.push({ ...s, thenSteps: updateStepById(s.thenSteps, stepId, updater), elseSteps: updateStepById(s.elseSteps, stepId, updater) })
      continue
    }
    out.push(s)
  }
  return out
}

function deleteStepById(steps: Step[], stepId: string): Step[] {
  const out: Step[] = []
  for (const s of steps) {
    if (s.id === stepId) continue
    if (s.kind === 'record') out.push({ ...s, steps: deleteStepById(s.steps, stepId) })
    else if (s.kind === 'while') out.push({ ...s, steps: deleteStepById(s.steps, stepId) })
    else if (s.kind === 'ifElse') out.push({ ...s, thenSteps: deleteStepById(s.thenSteps, stepId), elseSteps: deleteStepById(s.elseSteps, stepId) })
    else out.push(s)
  }
  return out
}

function insertAfterStepId(steps: Step[], afterId: string | null, newStep: Step): Step[] {
  if (!afterId) return [...steps, newStep]
  const out: Step[] = []
  for (const s of steps) {
    out.push(s)
    if (s.id === afterId) out.push(newStep)
    if (s.kind === 'record') {
      // no-op: insertion at this level
    }
  }
  // If not found at this level, recurse into blocks.
  const foundHere = steps.some(s => s.id === afterId)
  if (foundHere) return out
  return steps.map(s => {
    if (s.kind === 'record') return { ...s, steps: insertAfterStepId(s.steps, afterId, newStep) }
    if (s.kind === 'while') return { ...s, steps: insertAfterStepId(s.steps, afterId, newStep) }
    if (s.kind === 'ifElse') return { ...s, thenSteps: insertAfterStepId(s.thenSteps, afterId, newStep), elseSteps: insertAfterStepId(s.elseSteps, afterId, newStep) }
    return s
  })
}

function findStepById(steps: Step[], stepId: string): Step | null {
  for (const s of steps) {
    if (s.id === stepId) return s
    if (s.kind === 'record') {
      const t = findStepById(s.steps, stepId)
      if (t) return t
    }
    if (s.kind === 'while') {
      const t = findStepById(s.steps, stepId)
      if (t) return t
    }
    if (s.kind === 'ifElse') {
      const t1 = findStepById(s.thenSteps, stepId)
      if (t1) return t1
      const t2 = findStepById(s.elseSteps, stepId)
      if (t2) return t2
    }
  }
  return null
}

function flattenStepIds(steps: Step[], out: string[] = []) {
  for (const s of steps) {
    out.push(s.id)
    if (s.kind === 'record') flattenStepIds(s.steps, out)
    if (s.kind === 'while') flattenStepIds(s.steps, out)
    if (s.kind === 'ifElse') {
      flattenStepIds(s.thenSteps, out)
      flattenStepIds(s.elseSteps, out)
    }
  }
  return out
}

function tryParseJson(text: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) }
  }
}

function downloadJson(filename: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function ContextMenu({ state, onClose }: { state: ContextMenuState; onClose: () => void }) {
  React.useEffect(() => {
    if (!state) return
    const onAny = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', onAny)
    window.addEventListener('scroll', onAny, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onAny)
      window.removeEventListener('scroll', onAny, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [state, onClose])

  if (!state) return null

  return (
    <div
      style={{
        position: 'fixed',
        left: state.x,
        top: state.y,
        zIndex: 1000,
        background: '#1a1a1a',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 8,
        padding: 6,
        minWidth: 180,
      }}
      onContextMenu={e => e.preventDefault()}
    >
      {state.items.map((it, idx) => (
        <button
          key={idx}
          disabled={!!it.disabled}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '0.4em 0.7em',
            margin: '2px 0',
            opacity: it.disabled ? 0.45 : 1,
          }}
          onClick={() => {
            if (it.disabled) return
            onClose()
            it.onClick()
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

export default function MacroEditor() {
  const devices = useDeviceStore(s => s.devices)
  const descriptors = useDeviceStore(s => s.descriptors)

  const [macros, setMacros] = React.useState<ScriptMacro[]>(() => loadJson<ScriptMacro[]>(MACROS_KEY, []))
  const [selectedMacroId, setSelectedMacroId] = React.useState<string>(() => (loadJson<ScriptMacro[]>(MACROS_KEY, [])[0]?.id ?? ''))
  const selectedMacro = React.useMemo(() => macros.find(m => m.id === selectedMacroId) ?? null, [macros, selectedMacroId])

  const [menu, setMenu] = React.useState<ContextMenuState>(null)
  const [selectedStepId, setSelectedStepId] = React.useState<string>('')
  const [bottomTab, setBottomTab] = React.useState<'json' | 'errors'>('json')

  const [runStatus, setRunStatus] = React.useState<RunStatus>('idle')
  const [currentStepId, setCurrentStepId] = React.useState<string>('')
  const [stepStatus, setStepStatus] = React.useState<Record<string, StepStatus>>({})
  const [log, setLog] = React.useState<string[]>([])
  const [validationErrors, setValidationErrors] = React.useState<string[]>([])

  const pauseRef = React.useRef(false)
  const cancelRef = React.useRef(false)
  const skipRef = React.useRef(false)
  const cancelBlockRef = React.useRef(false)

  const activeRecordingIdsRef = React.useRef<string[]>([])

  const [layout, setLayout] = React.useState<Layout>(() => loadJson<Layout>(LAYOUT_KEY, { x: 12, y: 120, w: 520, h: 640 }))
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<{ startX: number; startY: number; startLeft: number; startTop: number; dragging: boolean } | null>(null)

  React.useEffect(() => {
    saveJson(MACROS_KEY, macros)
  }, [macros])

  React.useEffect(() => {
    saveJson(LAYOUT_KEY, layout)
  }, [layout])

  React.useEffect(() => {
    const el = panelRef.current
    if (!el) return
    let raf = 0
    const ro = new ResizeObserver(entries => {
      const ent = entries[0]
      if (!ent) return
      const cr = ent.contentRect
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setLayout(prev => {
          const next = { ...prev, w: Math.round(cr.width), h: Math.round(cr.height) }
          if (next.w === prev.w && next.h === prev.h) return prev
          return next
        })
      })
    })
    ro.observe(el)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  const appendLog = React.useCallback((line: string) => {
    setLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`])
  }, [])

  const canEditStep = React.useCallback(
    (stepId: string) => {
      if (runStatus !== 'running' && runStatus !== 'paused') return true
      if (stepId === currentStepId) return false
      const st = stepStatus[stepId]
      if (!st) return true
      if (st === 'done' || st === 'error' || st === 'skipped' || st === 'canceled' || st === 'running') return false
      return true
    },
    [runStatus, currentStepId, stepStatus]
  )

  const revalidate = React.useCallback(() => {
    const errs: string[] = []
    const m = selectedMacro
    if (!m) {
      setValidationErrors([])
      return
    }

    const visit = (steps: Step[], prefix: string) => {
      for (const s of steps) {
        const name = `${prefix}${s.name || s.kind}`
        if (s.enabled === false) continue
        if (s.kind === 'deviceAction') {
          if (!s.device_id) errs.push(`${name}: missing device_id`)
          if (s.device_id && !descriptors[s.device_id] && !devices[s.device_id]) errs.push(`${name}: unknown device_id '${s.device_id}'`)
        }
        if (s.kind === 'waitForStable') {
          if (!s.device_id) errs.push(`${name}: missing device_id`)
          if (!s.metric) errs.push(`${name}: missing metric`)
        }
        if (s.kind === 'record') visit(s.steps, `${name} / `)
        if (s.kind === 'while') visit(s.steps, `${name} / `)
        if (s.kind === 'ifElse') {
          visit(s.thenSteps, `${name} / then / `)
          visit(s.elseSteps, `${name} / else / `)
        }
      }
    }

    visit(m.steps, '')
    setValidationErrors(errs)
    appendLog(errs.length ? `Revalidate: ${errs.length} issue(s)` : 'Revalidate: OK')
  }, [appendLog, descriptors, devices, selectedMacro])

  const ensureSelectedMacro = React.useCallback(() => {
    if (selectedMacro) return selectedMacro
    if (!macros.length) return null
    setSelectedMacroId(macros[0].id)
    return macros[0]
  }, [macros, selectedMacro])

  const newMacro = () => {
    const m: ScriptMacro = { id: newId(), name: `Macro ${macros.length + 1}`, steps: [] }
    setMacros(prev => [m, ...prev])
    setSelectedMacroId(m.id)
    setSelectedStepId('')
  }

  const deleteMacro = () => {
    if (!selectedMacro) return
    if (!confirm(`Delete macro '${selectedMacro.name}'?`)) return
    setMacros(prev => prev.filter(m => m.id !== selectedMacro.id))
    setSelectedMacroId('')
    setSelectedStepId('')
  }

  const updateMacro = (updater: (m: ScriptMacro) => ScriptMacro) => {
    if (!selectedMacro) return
    setMacros(prev => prev.map(m => (m.id === selectedMacro.id ? updater(m) : m)))
  }

  const setStep = (stepId: string, patch: Partial<Step>) => {
    updateMacro(m => ({ ...m, steps: updateStepById(m.steps, stepId, s => ({ ...s, ...patch } as Step)) }))
  }

  const addStepAtEnd = (kind: Step['kind']) => {
    updateMacro(m => ({ ...m, steps: [...m.steps, stepDefault(kind)] }))
  }

  const insertAfter = (afterId: string, kind: Step['kind']) => {
    updateMacro(m => ({ ...m, steps: insertAfterStepId(m.steps, afterId, stepDefault(kind)) }))
  }

  const deleteStep = (stepId: string) => {
    updateMacro(m => ({ ...m, steps: deleteStepById(m.steps, stepId) }))
    setStepStatus(prev => {
      const next = { ...prev }
      delete next[stepId]
      return next
    })
    if (selectedStepId === stepId) setSelectedStepId('')
  }

  const formatStepTitle = (s: Step) => {
    switch (s.kind) {
      case 'deviceAction':
        return `${s.name} (${s.device_id || 'device'})`
      case 'waitForStable':
        return `${s.name} (${s.device_id || 'device'}:${s.metric || 'metric'})`
      case 'sleep':
        return `${s.name} (${s.ms}ms)`
      case 'record':
        return `${s.name} (block)`
      case 'while':
        return `${s.name} (block)`
      case 'ifElse':
        return `${s.name} (block)`
    }
  }

  const colorForStatus = (st: StepStatus | undefined) => {
    if (!st || st === 'pending') return 'inherit'
    if (st === 'running') return '#d4c25a'
    if (st === 'done') return '#6ad46a'
    if (st === 'skipped') return '#9aa0a6'
    if (st === 'canceled') return '#9aa0a6'
    return '#ff6b6b'
  }

  const maybeClampAction = (deviceId: string, action: any) => {
    const d = descriptors[deviceId]
    if (!d?.metrics || !action || typeof action !== 'object') return action

    const metrics = d.metrics
    const tryClampField = (field: string, v: number) => {
      const stripped = field.replace(/^set_/, '').replace(/^target_/, '')
      const candidates = Object.keys(metrics)
      let best: string | null = null
      for (const k of candidates) {
        if (k === field || k === stripped) best = k
        else if (k.includes(stripped) || stripped.includes(k)) best = best ?? k
        else if (field.includes(k)) best = best ?? k
      }
      if (!best) {
        if (candidates.length === 1) best = candidates[0]
        else return v
      }
      const meta = metrics[best]
      const lo = meta.soft_min ?? meta.min
      const hi = meta.soft_max ?? meta.max
      if (typeof lo === 'number' && typeof hi === 'number') return clamp(v, lo, hi)
      return v
    }

    const out: any = Array.isArray(action) ? [...action] : { ...action }
    for (const k of Object.keys(out)) {
      const v = out[k]
      if (typeof v === 'number') out[k] = tryClampField(k, v)
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        const inner: any = { ...v }
        for (const kk of Object.keys(inner)) {
          const vv = inner[kk]
          if (typeof vv === 'number') inner[kk] = tryClampField(kk, vv)
        }
        out[k] = inner
      }
    }
    return out
  }

  const stopAllRecordings = React.useCallback(async () => {
    const ids = [...activeRecordingIdsRef.current]
    activeRecordingIdsRef.current = []
    for (const rid of ids) {
      try {
        await Backend.rpc('record.stop', { recording_id: rid }, 20_000)
        appendLog(`record.stop OK (${rid})`)
      } catch (e: any) {
        appendLog(`record.stop failed (${rid}): ${String(e?.message || e)}`)
      }
    }
  }, [appendLog])

  const waitWhilePaused = React.useCallback(async () => {
    while (pauseRef.current) {
      await new Promise(r => setTimeout(r, 100))
    }
  }, [])

  const run = React.useCallback(async () => {
    const m = ensureSelectedMacro()
    if (!m) return

    revalidate()
    if (validationErrors.length) {
      appendLog('Run blocked: validation errors')
      setBottomTab('errors')
      return
    }

    cancelRef.current = false
    skipRef.current = false
    cancelBlockRef.current = false
    pauseRef.current = false
    activeRecordingIdsRef.current = []

    const allIds = flattenStepIds(m.steps)
    const status0: Record<string, StepStatus> = {}
    for (const id of allIds) status0[id] = 'pending'
    setStepStatus(status0)
    setRunStatus('running')
    setCurrentStepId('')
    appendLog(`Run started: ${m.name}`)

    type Frame =
      | { type: 'root'; steps: Step[]; i: number }
      | { type: 'record'; stepId: string; steps: Step[]; i: number; recording_id: string | null; params: any }
      | { type: 'while'; stepId: string; steps: Step[]; i: number; cond: Condition; iterations: number; max_iterations: number }
      | { type: 'ifThen'; stepId: string; steps: Step[]; i: number }
      | { type: 'ifElse'; stepId: string; steps: Step[]; i: number }

    const stack: Frame[] = [{ type: 'root', steps: deepClone(m.steps), i: 0 }]

    const setStatusFor = (id: string, st: StepStatus) => {
      setStepStatus(prev => ({ ...prev, [id]: st }))
    }

    const cancelRemainingInFrame = (frame: Frame) => {
      for (let j = frame.i; j < frame.steps.length; j++) {
        const sid = frame.steps[j]?.id
        if (sid) setStatusFor(sid, 'canceled')
      }
    }

    const getLatest = (deviceId: string, metric: string) => {
      const d = useDeviceStore.getState().devices[deviceId]
      const v = d?.measurements?.[metric]?.value
      return typeof v === 'number' ? v : null
    }

    try {
      while (stack.length) {
        if (cancelRef.current) throw new Error('run-canceled')
        await waitWhilePaused()

        const frame = stack[stack.length - 1]

        if (cancelBlockRef.current && frame.type !== 'root') {
          cancelBlockRef.current = false
          cancelRemainingInFrame(frame)
          if (frame.type === 'record' && frame.recording_id) {
            try {
              await Backend.rpc('record.stop', { recording_id: frame.recording_id }, 20_000)
              appendLog(`record.stop OK (${frame.recording_id})`)
            } catch (e: any) {
              appendLog(`record.stop failed (${frame.recording_id}): ${String(e?.message || e)}`)
            }
          }
          stack.pop()
          continue
        }

        if (frame.i >= frame.steps.length) {
          // frame completed
          if (frame.type === 'record' && frame.recording_id) {
            try {
              await Backend.rpc('record.stop', { recording_id: frame.recording_id }, 20_000)
              appendLog(`record.stop OK (${frame.recording_id})`)
            } catch (e: any) {
              appendLog(`record.stop failed (${frame.recording_id}): ${String(e?.message || e)}`)
            }
          }

          if (frame.type === 'while') {
            const latest = getLatest(frame.cond.device_id, frame.cond.metric)
            const ok = evalCondition(latest, frame.cond.op, frame.cond.value)
            if (ok && frame.iterations + 1 < frame.max_iterations) {
              frame.iterations += 1
              frame.i = 0
              continue
            }
          }

          stack.pop()
          continue
        }

        const s = frame.steps[frame.i]
        frame.i += 1
        if (!s || s.enabled === false) {
          if (s?.id) setStatusFor(s.id, 'skipped')
          continue
        }

        if (skipRef.current) {
          skipRef.current = false
          setStatusFor(s.id, 'skipped')
          continue
        }

        setCurrentStepId(s.id)
        setStatusFor(s.id, 'running')
        setSelectedStepId(s.id)

        if (s.kind === 'deviceAction') {
          const device_id = s.device_id
          const action = s.safeClamp ? maybeClampAction(device_id, s.action) : s.action
          await Backend.rpc('device.action', { device_id, action }, 20_000)
          appendLog(`device.action OK (${device_id})`)
          setStatusFor(s.id, 'done')
        } else if (s.kind === 'sleep') {
          await new Promise(r => setTimeout(r, Math.max(0, s.ms)))
          setStatusFor(s.id, 'done')
        } else if (s.kind === 'waitForStable') {
          const deadline = Date.now() + Math.max(0, s.timeout_ms)
          let okCount = 0
          while (Date.now() < deadline) {
            if (cancelRef.current) throw new Error('run-canceled')
            await waitWhilePaused()

            const series = History.getSeries(s.device_id, s.metric, Math.max(0.2, s.window_ms / 1000))
            const values = series.map(p => p.value).filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
            if (values.length >= 2) {
              const min = Math.min(...values)
              const max = Math.max(...values)
              const stable = Math.abs(max - min) <= s.tolerance
              if (stable) okCount += 1
              else okCount = 0
              if (okCount >= s.consecutive) break
            } else {
              okCount = 0
            }
            await new Promise(r => setTimeout(r, Math.min(500, s.window_ms)))
          }
          setStatusFor(s.id, 'done')
        } else if (s.kind === 'record') {
          const resp = await Backend.rpc('record.start', s.params ?? {}, 20_000)
          const recording_id = String(resp?.recording_id || '')
          if (recording_id) activeRecordingIdsRef.current.push(recording_id)
          appendLog(`record.start OK (${recording_id || 'unknown'})`)
          setStatusFor(s.id, 'done')
          stack.push({ type: 'record', stepId: s.id, steps: deepClone(s.steps), i: 0, recording_id: recording_id || null, params: s.params ?? {} })
        } else if (s.kind === 'while') {
          const latest = getLatest(s.condition.device_id, s.condition.metric)
          const ok = evalCondition(latest, s.condition.op, s.condition.value)
          setStatusFor(s.id, 'done')
          if (ok) stack.push({ type: 'while', stepId: s.id, steps: deepClone(s.steps), i: 0, cond: s.condition, iterations: 0, max_iterations: Math.max(1, s.max_iterations) })
        } else if (s.kind === 'ifElse') {
          const latest = getLatest(s.condition.device_id, s.condition.metric)
          const ok = evalCondition(latest, s.condition.op, s.condition.value)
          setStatusFor(s.id, 'done')
          stack.push({ type: ok ? 'ifThen' : 'ifElse', stepId: s.id, steps: deepClone(ok ? s.thenSteps : s.elseSteps), i: 0 })
        }
      }

      setCurrentStepId('')
      setRunStatus('finished')
      appendLog('Run finished')
    } catch (e: any) {
      if (String(e?.message || e) === 'run-canceled') {
        appendLog('Run canceled')
        setRunStatus('canceled')
      } else {
        appendLog(`Run error: ${String(e?.message || e)}`)
        setRunStatus('error')
      }
      setBottomTab('errors')
      setCurrentStepId('')
      await stopAllRecordings()
    }
  }, [appendLog, ensureSelectedMacro, revalidate, stopAllRecordings, validationErrors.length, waitWhilePaused, maybeClampAction])

  const pause = () => {
    if (runStatus !== 'running') return
    pauseRef.current = true
    setRunStatus('paused')
    appendLog('Paused')
  }

  const resume = () => {
    if (runStatus !== 'paused') return
    pauseRef.current = false
    setRunStatus('running')
    appendLog('Resumed')
  }

  const cancel = async () => {
    if (runStatus !== 'running' && runStatus !== 'paused') return
    cancelRef.current = true
    pauseRef.current = false
    await stopAllRecordings()
  }

  const skipStep = () => {
    if (runStatus !== 'running' && runStatus !== 'paused') return
    skipRef.current = true
    appendLog('Skip step requested')
  }

  const cancelBlock = () => {
    if (runStatus !== 'running' && runStatus !== 'paused') return
    cancelBlockRef.current = true
    appendLog('Cancel block requested')
  }

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button,select,input,textarea')) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, startLeft: layout.x, startTop: layout.y, dragging: true }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onHeaderPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d?.dragging) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    setLayout(prev => ({ ...prev, x: Math.max(0, d.startLeft + dx), y: Math.max(0, d.startTop + dy) }))
  }

  const onHeaderPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    d.dragging = false
    dragRef.current = null
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch {}
  }

  const openScriptMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Add Device Action', onClick: () => addStepAtEnd('deviceAction') },
        { label: 'Add Wait For Stable', onClick: () => addStepAtEnd('waitForStable') },
        { label: 'Add Sleep', onClick: () => addStepAtEnd('sleep') },
        { label: 'Add Record Block', onClick: () => addStepAtEnd('record') },
        { label: 'Add While Block', onClick: () => addStepAtEnd('while') },
        { label: 'Add If/Else Block', onClick: () => addStepAtEnd('ifElse') },
        { label: 'Revalidate', onClick: revalidate },
      ],
    })
  }

  const openStepMenu = (e: React.MouseEvent, step: Step) => {
    e.preventDefault()
    setSelectedStepId(step.id)
    const editable = canEditStep(step.id)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Configure (JSON)', onClick: () => setBottomTab('json') },
        { label: 'Insert After: Device Action', onClick: () => insertAfter(step.id, 'deviceAction'), disabled: !editable },
        { label: 'Insert After: Wait For Stable', onClick: () => insertAfter(step.id, 'waitForStable'), disabled: !editable },
        { label: 'Insert After: Sleep', onClick: () => insertAfter(step.id, 'sleep'), disabled: !editable },
        { label: 'Insert After: Record Block', onClick: () => insertAfter(step.id, 'record'), disabled: !editable },
        { label: 'Insert After: While Block', onClick: () => insertAfter(step.id, 'while'), disabled: !editable },
        { label: 'Insert After: If/Else Block', onClick: () => insertAfter(step.id, 'ifElse'), disabled: !editable },
        { label: 'Delete', onClick: () => deleteStep(step.id), disabled: !editable },
      ],
    })
  }

  const selectedStep = React.useMemo(() => (selectedMacro ? findStepById(selectedMacro.steps, selectedStepId) : null), [selectedMacro, selectedStepId])
  const [jsonText, setJsonText] = React.useState('')
  const [jsonError, setJsonError] = React.useState<string>('')

  React.useEffect(() => {
    if (!selectedStep) {
      setJsonText('')
      setJsonError('')
      return
    }
    setJsonText(JSON.stringify(selectedStep, null, 2))
    setJsonError('')
  }, [selectedStepId])

  const applyJsonEdit = () => {
    if (!selectedMacro || !selectedStep) return
    if (!canEditStep(selectedStep.id)) {
      setJsonError('This step is locked while running.')
      return
    }
    const parsed = tryParseJson(jsonText)
    if (!parsed.ok) {
      setJsonError(parsed.error)
      return
    }
    const v = parsed.value
    if (!v || typeof v !== 'object' || typeof v.id !== 'string' || v.id !== selectedStep.id || typeof v.kind !== 'string') {
      setJsonError('Invalid step JSON (id/kind mismatch).')
      return
    }
    updateMacro(m => ({ ...m, steps: updateStepById(m.steps, selectedStep.id, _ => v as Step) }))
    setJsonError('')
    appendLog('Step updated')
    revalidate()
  }

  const exportMacros = () => downloadJson('stonegate-macros.json', macros)
  const exportSelectedMacro = () => {
    if (!selectedMacro) return
    downloadJson(`${selectedMacro.name.replace(/[^a-z0-9_-]+/gi, '_')}.json`, selectedMacro)
  }

  const importFileInputRef = React.useRef<HTMLInputElement | null>(null)
  const onImportFile = async (file: File) => {
    const text = await file.text()
    const parsed = tryParseJson(text)
    if (!parsed.ok) {
      appendLog(`Import failed: ${parsed.error}`)
      setBottomTab('errors')
      return
    }
    const v = parsed.value
    let incoming: ScriptMacro[] = []
    if (Array.isArray(v)) incoming = v
    else if (v && typeof v === 'object' && typeof v.id === 'string' && Array.isArray((v as any).steps)) incoming = [v as ScriptMacro]
    else {
      appendLog('Import failed: JSON must be a macro or an array of macros')
      setBottomTab('errors')
      return
    }

    // normalize
    incoming = incoming.map(m => ({ id: typeof m.id === 'string' ? m.id : newId(), name: String(m.name || 'Imported Macro'), steps: Array.isArray(m.steps) ? (m.steps as Step[]) : [] }))
    setMacros(prev => {
      const byId = new Map(prev.map(m => [m.id, m]))
      for (const m of incoming) byId.set(m.id, m)
      return Array.from(byId.values())
    })
    setSelectedMacroId(incoming[0]?.id ?? selectedMacroId)
    appendLog(`Imported ${incoming.length} macro(s)`) 
  }

  const loadBundled = async () => {
    try {
      const r = await fetch('/macros.json')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const v = await r.json()
      if (!Array.isArray(v)) throw new Error('macros.json is not an array')
      const incoming = (v as any[]).map((m: any) => ({ id: typeof m.id === 'string' ? m.id : newId(), name: String(m.name || 'Bundled Macro'), steps: Array.isArray(m.steps) ? (m.steps as Step[]) : [] }))
      setMacros(prev => {
        const byId = new Map(prev.map(m => [m.id, m]))
        for (const m of incoming) byId.set(m.id, m)
        return Array.from(byId.values())
      })
      appendLog(`Loaded ${incoming.length} bundled macro(s)`) 
    } catch (e: any) {
      appendLog(`Load bundled failed: ${String(e?.message || e)}`)
      setBottomTab('errors')
    }
  }

  const renderSteps = (steps: Step[], indent: number) => {
    return steps.map(s => {
      const st = stepStatus[s.id]
      const isSelected = selectedStepId === s.id
      const locked = !canEditStep(s.id)
      return (
        <div key={s.id} style={{ marginLeft: indent * 14 }}>
          <div
            onClick={() => setSelectedStepId(s.id)}
            onContextMenu={e => openStepMenu(e, s)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 6px',
              borderRadius: 6,
              cursor: 'default',
              background: isSelected ? 'rgba(255,255,255,0.08)' : 'transparent',
              opacity: s.enabled === false ? 0.5 : 1,
              border: isSelected ? '1px solid rgba(255,255,255,0.16)' : '1px solid transparent',
            }}
            title={locked ? 'Locked while running' : 'Right-click for actions'}
          >
            <span style={{ color: colorForStatus(st), minWidth: 12 }}>{st === 'running' ? '▶' : st === 'done' ? '✓' : st === 'error' ? '!' : st === 'skipped' ? '↷' : st === 'canceled' ? '×' : ''}</span>
            <span style={{ flex: 1, color: colorForStatus(st) }}>{formatStepTitle(s)}</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: locked ? 0.5 : 1 }} title={locked ? 'Locked while running' : 'Enable/disable'}>
              <input
                type="checkbox"
                checked={s.enabled !== false}
                disabled={locked}
                onChange={e => setStep(s.id, { enabled: e.target.checked } as any)}
              />
              on
            </label>
          </div>

          {s.kind === 'record' && (
            <div style={{ marginTop: 2 }}>{renderSteps(s.steps, indent + 1)}</div>
          )}
          {s.kind === 'while' && (
            <div style={{ marginTop: 2 }}>{renderSteps(s.steps, indent + 1)}</div>
          )}
          {s.kind === 'ifElse' && (
            <div style={{ marginTop: 2 }}>
              <div style={{ marginLeft: (indent + 1) * 14, opacity: 0.8, fontSize: 12 }}>then</div>
              {renderSteps(s.thenSteps, indent + 1)}
              <div style={{ marginLeft: (indent + 1) * 14, opacity: 0.8, fontSize: 12, marginTop: 4 }}>else</div>
              {renderSteps(s.elseSteps, indent + 1)}
            </div>
          )}
        </div>
      )
    })
  }

  return (
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        left: layout.x,
        top: layout.y,
        width: layout.w,
        height: layout.h,
        background: '#041018',
        color: 'rgba(255,255,255,0.9)',
        border: '1px solid rgba(255,255,255,0.18)',
        borderRadius: 10,
        zIndex: 90,
        display: 'flex',
        flexDirection: 'column',
        resize: 'both',
        overflow: 'hidden',
      }}
      onContextMenu={openScriptMenu}
    >
      <div
        style={{
          padding: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          borderBottom: '1px solid rgba(255,255,255,0.12)',
          userSelect: 'none',
          cursor: 'grab',
        }}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <strong style={{ flex: 1 }}>Macro Wizard</strong>
          <button title="Run" onClick={run} disabled={!selectedMacro || runStatus === 'running' || runStatus === 'paused'} style={{ padding: '0.3em 0.6em' }}>
            ▶
          </button>
          <button title="Pause" onClick={pause} disabled={runStatus !== 'running'} style={{ padding: '0.3em 0.6em' }}>
            ⏸
          </button>
          <button title="Resume" onClick={resume} disabled={runStatus !== 'paused'} style={{ padding: '0.3em 0.6em' }}>
            ⏵
          </button>
          <button title="Cancel script" onClick={cancel} disabled={runStatus !== 'running' && runStatus !== 'paused'} style={{ padding: '0.3em 0.6em' }}>
            ⏹
          </button>
          <button title="Skip step" onClick={skipStep} disabled={runStatus !== 'running' && runStatus !== 'paused'} style={{ padding: '0.3em 0.6em' }}>
            ⏭
          </button>
          <button title="Cancel block" onClick={cancelBlock} disabled={runStatus !== 'running' && runStatus !== 'paused'} style={{ padding: '0.3em 0.6em' }}>
            ⤫
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={newMacro} style={{ padding: '0.3em 0.7em' }}>New</button>
          <button onClick={deleteMacro} disabled={!selectedMacro} style={{ padding: '0.3em 0.7em' }}>Delete</button>
          <select value={selectedMacroId} onChange={e => setSelectedMacroId(e.target.value)} style={{ flex: 1, minWidth: 140 }}>
            <option value="">-- select macro --</option>
            {macros.map(m => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input
            value={selectedMacro?.name ?? ''}
            disabled={!selectedMacro}
            onChange={e => updateMacro(m => ({ ...m, name: e.target.value }))}
            placeholder="Name"
            style={{ flex: 1, minWidth: 140 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={revalidate} disabled={!selectedMacro} style={{ padding: '0.3em 0.7em' }}>Revalidate</button>
          <button onClick={exportSelectedMacro} disabled={!selectedMacro} style={{ padding: '0.3em 0.7em' }}>Export macro</button>
          <button onClick={exportMacros} disabled={!macros.length} style={{ padding: '0.3em 0.7em' }}>Export all</button>
          <button onClick={() => importFileInputRef.current?.click()} style={{ padding: '0.3em 0.7em' }}>Import</button>
          <button onClick={loadBundled} style={{ padding: '0.3em 0.7em' }}>Load bundled</button>
          <input
            ref={importFileInputRef}
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) onImportFile(f)
              e.currentTarget.value = ''
            }}
          />
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: 8, overflow: 'auto' }}>
          {!selectedMacro ? (
            <div style={{ opacity: 0.75 }}>Create or select a macro. Right-click to add steps.</div>
          ) : selectedMacro.steps.length === 0 ? (
            <div style={{ opacity: 0.75 }}>No steps. Right-click to add.</div>
          ) : (
            <div>{renderSteps(selectedMacro.steps, 0)}</div>
          )}

          {validationErrors.length > 0 && (
            <div style={{ marginTop: 10, color: '#ff6b6b', fontSize: 12 }}>
              <strong>Validation</strong>
              {validationErrors.slice(0, 10).map((e, i) => (
                <div key={i}>{e}</div>
              ))}
              {validationErrors.length > 10 && <div>... ({validationErrors.length - 10} more)</div>}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', padding: 8, height: 190, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setBottomTab('json')} style={{ padding: '0.25em 0.6em', opacity: bottomTab === 'json' ? 1 : 0.7 }}>JSON</button>
            <button onClick={() => setBottomTab('errors')} style={{ padding: '0.25em 0.6em', opacity: bottomTab === 'errors' ? 1 : 0.7 }}>Errors</button>
            <div style={{ flex: 1, opacity: 0.75, fontSize: 12 }}>Status: {runStatus}{currentStepId ? ` • step ${currentStepId}` : ''}</div>
          </div>

          {bottomTab === 'json' ? (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflow: 'hidden' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ flex: 1, opacity: 0.75, fontSize: 12 }}>{selectedStep ? `Editing: ${selectedStep.name}` : 'Select a step to edit.'}</div>
                <button onClick={applyJsonEdit} disabled={!selectedStep} style={{ padding: '0.25em 0.6em' }}>Apply</button>
              </div>
              {jsonError && <div style={{ color: '#ff6b6b', fontSize: 12 }}>{jsonError}</div>}
              <textarea
                value={jsonText}
                onChange={e => setJsonText(e.target.value)}
                style={{
                  width: '100%',
                  flex: 1,
                  resize: 'none',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                  fontSize: 12,
                }}
              />
            </div>
          ) : (
            <div style={{ marginTop: 6, flex: 1, overflow: 'auto', fontSize: 12 }}>
              {log.length === 0 ? (
                <div style={{ opacity: 0.75 }}>No errors/log yet.</div>
              ) : (
                log.slice(-200).map((l, i) => <div key={i}>{l}</div>)
              )}
            </div>
          )}
        </div>
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </div>
  )
}
