import React from 'react'
import Backend from '../api/backend'
import { useDeviceStore } from '../state/store'
import History from '../state/history'
import DeviceActionDialog from './DeviceActionDialog'

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
  renderAs?: 'ui' | 'json' | 'python' | 'cpp' | 'sql'
  defaults?: {
    safeState?: {
      targets: Record<string, Record<string, any>>
    }
  }
  steps: Step[]
}

type ValidationError = { stepId: string; message: string }
type LogEntry = { ts: string; line: string; stepId?: string }

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

function clampLayoutToViewport(l: Layout, margin = 12): Layout {
  const vw = Math.max(320, window.innerWidth || 0)
  const vh = Math.max(240, window.innerHeight || 0)

  const maxW = Math.max(320, vw - margin * 2)
  const maxH = Math.max(240, vh - margin * 2)

  const w = clamp(l.w, 320, maxW)
  const h = clamp(l.h, 240, maxH)

  const x = clamp(l.x, 0, Math.max(0, vw - w))
  const y = clamp(l.y, 0, Math.max(0, vh - h))

  return { x, y, w, h }
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

function tryParseNotebookAsMacroFromCode(nb: any): ScriptMacro | null {
  if (!nb || typeof nb !== 'object' || !Array.isArray(nb.cells)) return null

  const codeLines: string[] = []
  for (const c of nb.cells) {
    if (!c || typeof c !== 'object') continue
    if (c.cell_type !== 'code') continue
    const src = c.source
    if (Array.isArray(src)) codeLines.push(...src.map((x: any) => String(x)).join('').split(/\r?\n/))
    else if (typeof src === 'string') codeLines.push(...src.split(/\r?\n/))
  }

  const constStrings = new Map<string, string>()
  const constNumbers = new Map<string, number>()
  for (const raw of codeLines) {
    const line = raw.trim()
    const mStr = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*['"]([^'"]+)['"]\s*$/)
    if (mStr) {
      constStrings.set(mStr[1], mStr[2])
      continue
    }
    const mNum = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([-+]?[0-9]*\.?[0-9]+)\s*$/)
    if (mNum) {
      constNumbers.set(mNum[1], Number(mNum[2]))
    }
  }

  const substituteFStringVars = (s: string) =>
    s.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name) => {
      if (constNumbers.has(name)) return String(constNumbers.get(name))
      if (constStrings.has(name)) return JSON.stringify(constStrings.get(name))
      return _m
    })

  const parseJsonLoads = (line: string): any | null => {
    const m = line.match(/json\.loads\(\s*r(f)?\"\"\"([\s\S]*?)\"\"\"\s*\)/)
    if (!m) return null
    const raw = substituteFStringVars(m[2])
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  }

  const parsePythonDictLiteral = (line: string): any | null => {
    const idx = line.indexOf('{')
    if (idx < 0) return null
    const cand = line.slice(idx)
    // Very small best-effort conversion. Only intended for simple literals.
    const jsonish = cand
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/\bNone\b/g, 'null')
      .replace(/'/g, '"')
    try {
      return JSON.parse(jsonish)
    } catch {
      return null
    }
  }

  const resolveDeviceId = (expr: string): string | null => {
    const e = expr.trim()
    const mLit = e.match(/^['"]([^'"]+)['"]$/)
    if (mLit) return mLit[1]
    if (constStrings.has(e)) return constStrings.get(e) ?? null
    return null
  }

  const steps: Step[] = []
  let pendingName: string | null = null

  for (let i = 0; i < codeLines.length; i++) {
    const raw = codeLines[i]
    const line = raw.trim()
    if (!line) continue

    const mMarker = line.match(/^#\s*###>\s*"([^"]+)"\s*<###/)
    if (mMarker) {
      pendingName = mMarker[1]
      continue
    }

    // await sg.device_action(...)
    const mAct = line.match(/^await\s+sg\.device_action\(\s*([^,]+)\s*,\s*(.+)\)\s*$/)
    if (mAct) {
      const deviceId = resolveDeviceId(mAct[1])
      const action = parseJsonLoads(line) ?? parsePythonDictLiteral(mAct[2])
      if (deviceId && action) {
        steps.push({
          id: newId(),
          name: pendingName ?? `Device Action: ${deviceId}`,
          kind: 'deviceAction',
          device_id: deviceId,
          action,
          safeClamp: true,
          enabled: true,
        })
        pendingName = null
        continue
      }
    }

    // await sg.wait_for_stable(device_id=..., metric=..., ...)
    const mWaitKw = line.match(
      /^await\s+sg\.wait_for_stable\(\s*device_id\s*=\s*([^,]+)\s*,\s*metric\s*=\s*['"]([^'"]+)['"]\s*,\s*tolerance\s*=\s*([0-9.eE+-]+)\s*,\s*window_s\s*=\s*([0-9.eE+-]+)\s*,\s*consecutive\s*=\s*([0-9]+)\s*,\s*timeout_s\s*=\s*([0-9.eE+-]+)\s*\)\s*$/
    )
    if (mWaitKw) {
      const deviceId = resolveDeviceId(mWaitKw[1])
      if (deviceId) {
        steps.push({
          id: newId(),
          name: pendingName ?? `Wait For Stable: ${deviceId}:${mWaitKw[2]}`,
          kind: 'waitForStable',
          device_id: deviceId,
          metric: mWaitKw[2],
          tolerance: Number(mWaitKw[3]),
          window_ms: Number(mWaitKw[4]) * 1000,
          consecutive: Number(mWaitKw[5]),
          timeout_ms: Number(mWaitKw[6]) * 1000,
          enabled: true,
        })
        pendingName = null
        continue
      }
    }

    // await sg.wait_for_stable(<device>, '<metric>', tolerance=..., window_s=..., consecutive=..., timeout_s=...)
    const mWaitPos = line.match(
      /^await\s+sg\.wait_for_stable\(\s*([^,]+)\s*,\s*['"]([^'"]+)['"]\s*,\s*tolerance\s*=\s*([0-9.eE+-]+)\s*,\s*window_s\s*=\s*([0-9.eE+-]+)\s*,\s*consecutive\s*=\s*([0-9]+)\s*,\s*timeout_s\s*=\s*([0-9.eE+-]+)\s*\)\s*$/
    )
    if (mWaitPos) {
      const deviceId = resolveDeviceId(mWaitPos[1])
      if (deviceId) {
        steps.push({
          id: newId(),
          name: pendingName ?? `Wait For Stable: ${deviceId}:${mWaitPos[2]}`,
          kind: 'waitForStable',
          device_id: deviceId,
          metric: mWaitPos[2],
          tolerance: Number(mWaitPos[3]),
          window_ms: Number(mWaitPos[4]) * 1000,
          consecutive: Number(mWaitPos[5]),
          timeout_ms: Number(mWaitPos[6]) * 1000,
          enabled: true,
        })
        pendingName = null
        continue
      }
    }

    // await asyncio.sleep(x)
    const mSleep = line.match(/^await\s+asyncio\.sleep\(\s*([0-9.eE+-]+)\s*\)\s*$/)
    if (mSleep) {
      steps.push({
        id: newId(),
        name: pendingName ?? 'Sleep',
        kind: 'sleep',
        ms: Number(mSleep[1]) * 1000,
        enabled: true,
      })
      pendingName = null
      continue
    }
  }

  if (!steps.length) return null

  const name = typeof nb?.metadata?.title === 'string' ? nb.metadata.title : 'Imported Notebook'
  return {
    id: newId(),
    name,
    renderAs: 'ui',
    defaults: { safeState: { targets: {} } },
    steps,
  }
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
      onMouseDown={e => e.stopPropagation()}
      onPointerDown={e => e.stopPropagation()}
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

  const allDeviceIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const k of Object.keys(descriptors)) ids.add(k)
    for (const k of Object.keys(devices)) ids.add(k)
    return Array.from(ids).sort()
  }, [descriptors, devices])

  const [macros, setMacros] = React.useState<ScriptMacro[]>(() => loadJson<ScriptMacro[]>(MACROS_KEY, []))
  const [selectedMacroId, setSelectedMacroId] = React.useState<string>(() => (loadJson<ScriptMacro[]>(MACROS_KEY, [])[0]?.id ?? ''))
  const selectedMacro = React.useMemo(() => macros.find(m => m.id === selectedMacroId) ?? null, [macros, selectedMacroId])

  const [menu, setMenu] = React.useState<ContextMenuState>(null)
  const [selectedStepId, setSelectedStepId] = React.useState<string>('')
  const [bottomTab, setBottomTab] = React.useState<'preview' | 'errors'>('preview')

  const [runStatus, setRunStatus] = React.useState<RunStatus>('idle')
  const [currentStepId, setCurrentStepId] = React.useState<string>('')
  const [stepStatus, setStepStatus] = React.useState<Record<string, StepStatus>>({})
  const [log, setLog] = React.useState<LogEntry[]>([])
  const [validationErrors, setValidationErrors] = React.useState<ValidationError[]>([])

  const pauseRef = React.useRef(false)
  const cancelRef = React.useRef(false)
  const skipRef = React.useRef(false)
  const cancelBlockRef = React.useRef(false)

  const activeRecordingIdsRef = React.useRef<string[]>([])

  const [layout, setLayout] = React.useState<Layout>(() => loadJson<Layout>(LAYOUT_KEY, { x: 12, y: 120, w: 520, h: 640 }))
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const dragRef = React.useRef<{ startX: number; startY: number; startLeft: number; startTop: number; dragging: boolean } | null>(null)

  React.useEffect(() => {
    // Ensure the panel is always reachable on-screen.
    setLayout(prev => clampLayoutToViewport(prev))
    const onResize = () => setLayout(prev => clampLayoutToViewport(prev))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

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
          const next = clampLayoutToViewport({ ...prev, w: Math.round(cr.width), h: Math.round(cr.height) })
          if (next.x === prev.x && next.y === prev.y && next.w === prev.w && next.h === prev.h) return prev
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

  const appendLog = React.useCallback((line: string, stepId?: string) => {
    const ts = new Date().toLocaleTimeString()
    setLog(prev => [...prev, { ts, line: `[${ts}] ${line}`, stepId }])
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
    const errs: ValidationError[] = []
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
          if (!s.device_id) errs.push({ stepId: s.id, message: `${name}: missing device_id` })
          if (s.device_id && !descriptors[s.device_id] && !devices[s.device_id]) errs.push({ stepId: s.id, message: `${name}: unknown device_id '${s.device_id}'` })
        }
        if (s.kind === 'waitForStable') {
          if (!s.device_id) errs.push({ stepId: s.id, message: `${name}: missing device_id` })
          if (!s.metric) errs.push({ stepId: s.id, message: `${name}: missing metric` })
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
    const m: ScriptMacro = { id: newId(), name: `Macro ${macros.length + 1}`, renderAs: 'ui', defaults: { safeState: { targets: {} } }, steps: [] }
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

  const macroRenderAs: NonNullable<ScriptMacro['renderAs']> = (selectedMacro?.renderAs ?? 'ui')
  const setRenderAs = (v: NonNullable<ScriptMacro['renderAs']>) => {
    if (!selectedMacro) return
    updateMacro(m => ({ ...m, renderAs: v }))
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

  type BlockInsertTarget = 'steps' | 'thenSteps' | 'elseSteps'
  const appendIntoBlock = (blockStepId: string, target: BlockInsertTarget, kind: Step['kind']) => {
    updateMacro(m => ({
      ...m,
      steps: updateStepById(m.steps, blockStepId, s => {
        const child = stepDefault(kind)
        if ((s.kind === 'record' || s.kind === 'while') && target === 'steps') {
          return { ...s, steps: [...s.steps, child] }
        }
        if (s.kind === 'ifElse') {
          if (target === 'thenSteps') return { ...s, thenSteps: [...s.thenSteps, child] }
          if (target === 'elseSteps') return { ...s, elseSteps: [...s.elseSteps, child] }
        }
        return s
      }),
    }))
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

  const applySafeState = React.useCallback(
    async (m: ScriptMacro, reason: 'finish' | 'cancel' | 'error') => {
      const targets = m.defaults?.safeState?.targets ?? {}
      const deviceIds = Object.keys(targets)
      if (deviceIds.length === 0) return

      appendLog(`Applying Safe State (${reason})`)
      await stopAllRecordings()

      const getLatest = (deviceId: string, metric: string) => {
        const d = useDeviceStore.getState().devices[deviceId]
        const v = d?.measurements?.[metric]?.value
        return typeof v === 'number' ? v : null
      }

      for (const device_id of deviceIds) {
        const setMap = targets[device_id] ?? {}
        const keys = Object.keys(setMap)
        if (keys.length === 0) continue

        try {
          await Backend.rpc('device.action', { device_id, action: { set: setMap } }, 20_000)
          appendLog(`safeState device.action OK (${device_id})`)
        } catch (e: any) {
          appendLog(`safeState device.action failed (${device_id}): ${String(e?.message || e)}`)
          continue
        }

        // Wait for targets to be reached (best-effort).
        for (const metric of keys) {
          const target = setMap[metric]
          if (typeof target !== 'number' || !Number.isFinite(target)) continue

          const meta = descriptors[device_id]?.metrics?.[metric]
          const tol = Math.max(1e-6, typeof meta?.precision === 'number' ? meta.precision : 0)
          const deadline = Date.now() + 60_000
          let okCount = 0
          while (Date.now() < deadline) {
            const latest = getLatest(device_id, metric)
            if (latest !== null && Number.isFinite(latest)) {
              const ok = Math.abs(latest - target) <= tol
              okCount = ok ? okCount + 1 : 0
              if (okCount >= 3) break
            } else {
              okCount = 0
            }
            await new Promise(r => setTimeout(r, 250))
          }
        }
      }
    },
    [appendLog, descriptors, stopAllRecordings]
  )

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
              appendLog(`record.stop OK (${frame.recording_id})`, frame.stepId)
            } catch (e: any) {
              appendLog(`record.stop failed (${frame.recording_id}): ${String(e?.message || e)}`, frame.stepId)
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
              appendLog(`record.stop OK (${frame.recording_id})`, frame.stepId)
            } catch (e: any) {
              appendLog(`record.stop failed (${frame.recording_id}): ${String(e?.message || e)}`, frame.stepId)
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
          appendLog(`device.action OK (${device_id})`, s.id)
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
          appendLog(`record.start OK (${recording_id || 'unknown'})`, s.id)
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

      try {
        await applySafeState(m, 'finish')
      } catch (e: any) {
        appendLog(`Safe State error: ${String(e?.message || e)}`)
      }
    } catch (e: any) {
      if (String(e?.message || e) === 'run-canceled') {
        appendLog('Run canceled')
        setRunStatus('canceled')

        try {
          await applySafeState(m, 'cancel')
        } catch (ee: any) {
          appendLog(`Safe State error: ${String(ee?.message || ee)}`)
        }
      } else {
        appendLog(`Run error: ${String(e?.message || e)}`)
        setRunStatus('error')

        try {
          await applySafeState(m, 'error')
        } catch (ee: any) {
          appendLog(`Safe State error: ${String(ee?.message || ee)}`)
        }
      }
      setBottomTab('errors')
      setCurrentStepId('')
      await stopAllRecordings()
    }
  }, [appendLog, applySafeState, ensureSelectedMacro, revalidate, stopAllRecordings, validationErrors.length, waitWhilePaused, maybeClampAction])

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
    setLayout(prev => clampLayoutToViewport({ ...prev, x: d.startLeft + dx, y: d.startTop + dy }))
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

  const openSettingsMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    const modes: Array<{ key: NonNullable<ScriptMacro['renderAs']>; label: string }> = [
      { key: 'ui', label: 'UI' },
      { key: 'json', label: 'JSON' },
      { key: 'python', label: 'Python' },
      { key: 'cpp', label: 'C++' },
      { key: 'sql', label: 'SQL' },
    ]
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        ...modes.map(m => ({
          label: `${macroRenderAs === m.key ? '✓ ' : ''}Render As: ${m.label}`,
          onClick: () => setRenderAs(m.key),
          disabled: !selectedMacro,
        })),
        { label: 'Defaults: Safe State…', onClick: () => setShowSafeStateDialog(true), disabled: !selectedMacro },
      ],
    })
  }

  const openStepMenu = (e: React.MouseEvent, step: Step) => {
    e.preventDefault()
    setSelectedStepId(step.id)
    const editable = canEditStep(step.id)
    const addInsideItems: Array<{ label: string; onClick: () => void; disabled?: boolean }> = []

    if (step.kind === 'record' || step.kind === 'while') {
      const prefix = step.kind === 'record' ? 'Add Inside Record: ' : 'Add Inside While: '
      addInsideItems.push(
        { label: `${prefix}Device Action`, onClick: () => appendIntoBlock(step.id, 'steps', 'deviceAction'), disabled: !editable },
        { label: `${prefix}Wait For Stable`, onClick: () => appendIntoBlock(step.id, 'steps', 'waitForStable'), disabled: !editable },
        { label: `${prefix}Sleep`, onClick: () => appendIntoBlock(step.id, 'steps', 'sleep'), disabled: !editable },
        { label: `${prefix}Record Block`, onClick: () => appendIntoBlock(step.id, 'steps', 'record'), disabled: !editable },
        { label: `${prefix}While Block`, onClick: () => appendIntoBlock(step.id, 'steps', 'while'), disabled: !editable },
        { label: `${prefix}If/Else Block`, onClick: () => appendIntoBlock(step.id, 'steps', 'ifElse'), disabled: !editable }
      )
    }

    if (step.kind === 'ifElse') {
      addInsideItems.push(
        { label: `Add Inside THEN: Device Action`, onClick: () => appendIntoBlock(step.id, 'thenSteps', 'deviceAction'), disabled: !editable },
        { label: `Add Inside THEN: Wait For Stable`, onClick: () => appendIntoBlock(step.id, 'thenSteps', 'waitForStable'), disabled: !editable },
        { label: `Add Inside THEN: Sleep`, onClick: () => appendIntoBlock(step.id, 'thenSteps', 'sleep'), disabled: !editable },
        { label: `Add Inside THEN: Record Block`, onClick: () => appendIntoBlock(step.id, 'thenSteps', 'record'), disabled: !editable },
        { label: `Add Inside THEN: While Block`, onClick: () => appendIntoBlock(step.id, 'thenSteps', 'while'), disabled: !editable },
        { label: `Add Inside THEN: If/Else Block`, onClick: () => appendIntoBlock(step.id, 'thenSteps', 'ifElse'), disabled: !editable },
        { label: `Add Inside ELSE: Device Action`, onClick: () => appendIntoBlock(step.id, 'elseSteps', 'deviceAction'), disabled: !editable },
        { label: `Add Inside ELSE: Wait For Stable`, onClick: () => appendIntoBlock(step.id, 'elseSteps', 'waitForStable'), disabled: !editable },
        { label: `Add Inside ELSE: Sleep`, onClick: () => appendIntoBlock(step.id, 'elseSteps', 'sleep'), disabled: !editable },
        { label: `Add Inside ELSE: Record Block`, onClick: () => appendIntoBlock(step.id, 'elseSteps', 'record'), disabled: !editable },
        { label: `Add Inside ELSE: While Block`, onClick: () => appendIntoBlock(step.id, 'elseSteps', 'while'), disabled: !editable },
        { label: `Add Inside ELSE: If/Else Block`, onClick: () => appendIntoBlock(step.id, 'elseSteps', 'ifElse'), disabled: !editable }
      )
    }

    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Preview / Configure', onClick: () => setBottomTab('preview') },
        { label: 'Insert After: Device Action', onClick: () => insertAfter(step.id, 'deviceAction'), disabled: !editable },
        { label: 'Insert After: Wait For Stable', onClick: () => insertAfter(step.id, 'waitForStable'), disabled: !editable },
        { label: 'Insert After: Sleep', onClick: () => insertAfter(step.id, 'sleep'), disabled: !editable },
        { label: 'Insert After: Record Block', onClick: () => insertAfter(step.id, 'record'), disabled: !editable },
        { label: 'Insert After: While Block', onClick: () => insertAfter(step.id, 'while'), disabled: !editable },
        { label: 'Insert After: If/Else Block', onClick: () => insertAfter(step.id, 'ifElse'), disabled: !editable },
        ...addInsideItems,
        { label: 'Delete', onClick: () => deleteStep(step.id), disabled: !editable },
      ],
    })
  }

  const selectedStep = React.useMemo(() => (selectedMacro ? findStepById(selectedMacro.steps, selectedStepId) : null), [selectedMacro, selectedStepId])
  const [jsonText, setJsonText] = React.useState('')
  const [jsonError, setJsonError] = React.useState<string>('')

  const [showSafeStateDialog, setShowSafeStateDialog] = React.useState(false)

  type ExportChoice = 'selected-json' | 'all-json' | 'python' | 'cpp' | 'notebook'
  const [showExportDialog, setShowExportDialog] = React.useState(false)
  const [exportChoice, setExportChoice] = React.useState<ExportChoice>('python')
  const [exportDialogStatus, setExportDialogStatus] = React.useState<string>('')

  const exportChoiceStorageKey = 'stonegate_macro_export_choice'

  const setExportChoicePersisted = (choice: ExportChoice) => {
    setExportChoice(choice)
    try {
      localStorage.setItem(exportChoiceStorageKey, choice)
    } catch {
      // ignore
    }
  }

  const copyTextToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.left = '-9999px'
        ta.style.top = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
      } catch {
        return false
      }
    }
  }

  const [uiDeviceActionDialog, setUiDeviceActionDialog] = React.useState<
    | null
    | { mode: 'step'; stepId: string; deviceId: string }
    | { mode: 'safeState'; deviceId: string }
  >(null)

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

  function downloadText(filename: string, text: string, mime = 'text/plain') {
    const blob = new Blob([text], { type: mime })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportMacros = () => downloadJson('stonegate-macros.json', macros)
  const exportSelectedMacro = () => {
    if (!selectedMacro) return
    downloadJson(`${selectedMacro.name.replace(/[^a-z0-9_-]+/gi, '_')}.json`, selectedMacro)
  }

  const openExportDialog = () => {
    if (!selectedMacro && macros.length === 0) return
    setExportDialogStatus('')
    try {
      const saved = localStorage.getItem(exportChoiceStorageKey) as ExportChoice | null
      const allowed: ExportChoice[] = ['selected-json', 'all-json', 'python', 'cpp', 'notebook']
      if (saved && allowed.includes(saved)) setExportChoice(saved)
    } catch {
      // ignore
    }
    if (!selectedMacro && exportChoice !== 'all-json') setExportChoice('all-json')
    setShowExportDialog(true)
  }

  const renderFullMacroText = React.useCallback(
    (m: ScriptMacro, as: NonNullable<ScriptMacro['renderAs']>) => {
      if (as === 'json' || as === 'ui') return JSON.stringify(m, null, 2)

      const safeTargets = m.defaults?.safeState?.targets ?? {}

      const pad = (n: number) => ' '.repeat(Math.max(0, n))
      const escPy = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      const escCpp = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

      const pyJsonLoadsExpr = (obj: unknown, pretty = false) => {
        let jsonText = JSON.stringify(obj, null, pretty ? 2 : 0)
        if (jsonText == null) jsonText = 'null'
        jsonText = jsonText.replace(/"""/g, '\\"""')
        return `json.loads(r"""${jsonText}""")`
      }

      const renderStepsPython = (steps: Step[], indent: number, activeRecVar: string): string[] => {
        const out: string[] = []
        for (const s of steps) {
          if (s.enabled === false) {
            out.push(`${pad(indent)}# (disabled) ${escPy(s.name || s.kind)}`)
            continue
          }
          if (s.kind === 'deviceAction') {
            const deviceId = s.device_id || ''
            const actionObj = s.action ?? {}
            out.push(`${pad(indent)}# ###> "${escPy(s.name)}" <###`)
            out.push(`${pad(indent)}await sg.device_action("${escPy(deviceId)}", ${pyJsonLoadsExpr(actionObj)})`)
            continue
          }
          if (s.kind === 'sleep') {
            out.push(`${pad(indent)}# ###> "${escPy(s.name)}" <###`)
            out.push(`${pad(indent)}await asyncio.sleep(${Math.max(0, s.ms) / 1000})`)
            continue
          }
          if (s.kind === 'waitForStable') {
            out.push(`${pad(indent)}# ###> "${escPy(s.name)}" <###`)
            out.push(
              `${pad(indent)}await sg.wait_for_stable(` +
                `device_id="${escPy(s.device_id)}", metric="${escPy(s.metric)}", ` +
                `tolerance=${s.tolerance}, window_s=${Math.max(0.2, s.window_ms / 1000)}, consecutive=${Math.max(1, s.consecutive)}, timeout_s=${Math.max(0, s.timeout_ms / 1000)}` +
                `)`
            )
            continue
          }
          if (s.kind === 'record') {
            const ridVar = `rid_${s.id.replace(/[^a-zA-Z0-9_]/g, '_')}`
            out.push(`${pad(indent)}# ###> "${escPy(s.name)}" <### (record block)`)
            out.push(`${pad(indent)}${ridVar} = await sg.record_start(${pyJsonLoadsExpr(s.params ?? {})})`)
            out.push(`${pad(indent)}${activeRecVar}.add(${ridVar})`)
            out.push(`${pad(indent)}try:`)
            out.push(...renderStepsPython(s.steps, indent + 2, activeRecVar))
            out.push(`${pad(indent)}finally:`)
            out.push(`${pad(indent + 2)}await sg.record_stop(${ridVar})`)
            out.push(`${pad(indent + 2)}${activeRecVar}.discard(${ridVar})`)
            continue
          }
          if (s.kind === 'while') {
            const maxIt = Math.max(1, s.max_iterations)
            out.push(`${pad(indent)}# ###> "${escPy(s.name)}" <### (while block)`)
            out.push(`${pad(indent)}for _i in range(${maxIt}):`)
            out.push(`${pad(indent + 2)}latest = await sg.get_latest_number("${escPy(s.condition.device_id)}", "${escPy(s.condition.metric)}")`)
            out.push(`${pad(indent + 2)}if not sg.eval_condition(latest, "${escPy(s.condition.op)}", ${s.condition.value}):`)
            out.push(`${pad(indent + 4)}break`)
            out.push(...renderStepsPython(s.steps, indent + 2, activeRecVar))
            continue
          }
          if (s.kind === 'ifElse') {
            out.push(`${pad(indent)}# ###> "${escPy(s.name)}" <### (if/else block)`)
            out.push(`${pad(indent)}latest = await sg.get_latest_number("${escPy(s.condition.device_id)}", "${escPy(s.condition.metric)}")`)
            out.push(`${pad(indent)}if sg.eval_condition(latest, "${escPy(s.condition.op)}", ${s.condition.value}):`)
            out.push(...renderStepsPython(s.thenSteps, indent + 2, activeRecVar))
            out.push(`${pad(indent)}else:`)
            out.push(...renderStepsPython(s.elseSteps, indent + 2, activeRecVar))
            continue
          }
        }
        if (out.length === 0) out.push(`${pad(indent)}pass`)
        return out
      }

      if (as === 'python') {
        const lines: string[] = []
        lines.push(`# Rendered as PYTHON`)
        lines.push(`# Macro: ${m.name}`)
        lines.push(`# Copy/paste runnable script.`)
        lines.push(`# Depends on: stonegate_api.py (this repo) + pip install websockets`)
        lines.push('')
        lines.push('import asyncio')
        lines.push('import json')
        lines.push('import stonegate_api as sg')
        lines.push('')
        lines.push("sg.WS_URL = 'ws://localhost:8080/status'")
        lines.push(`SAFE_TARGETS = ${pyJsonLoadsExpr(safeTargets, true)}`)
        lines.push('')
        lines.push('async def run_macro() -> None:')
        lines.push('    active_recording_ids: set[str] = set()')
        lines.push('    try:')
        lines.push(...renderStepsPython(m.steps, 8, 'active_recording_ids'))
        lines.push('    finally:')
        lines.push('        await sg.apply_safe_state(active_recording_ids, SAFE_TARGETS)')
        lines.push('')
        lines.push('if __name__ == "__main__":')
        lines.push('    asyncio.run(run_macro())')
        return lines.join('\n')
      }

      if (as === 'cpp') {
        const lines: string[] = []
        lines.push('// Rendered as C++')
        lines.push(`// Macro: ${m.name}`)
        lines.push('// Copy/paste runnable example using the repo helper: stonegate_api.hpp')
        lines.push('// Dependencies for stonegate_api.hpp: Boost + nlohmann::json')
        lines.push('')
        lines.push('#include "stonegate_api.hpp"')
        lines.push('')
        lines.push('#include <chrono>')
        lines.push('#include <iostream>')
        lines.push('#include <string>')
        lines.push('#include <thread>')
        lines.push('#include <unordered_set>')
        lines.push('')
        lines.push('using json = stonegate::json;')
        lines.push('')
        lines.push('static void sleep_ms(int ms) { std::this_thread::sleep_for(std::chrono::milliseconds(std::max(0, ms))); }')
        lines.push('')

        const renderStepsCpp = (steps: Step[], indent: number, activeRecVar: string): string[] => {
          const out: string[] = []
          for (const s of steps) {
            if (s.enabled === false) {
              out.push(`${pad(indent)}// (disabled) ${escCpp(s.name || s.kind)}`)
              continue
            }
            if (s.kind === 'deviceAction') {
              out.push(`${pad(indent)}// ###> "${escCpp(s.name)}" <###`)
              out.push(`${pad(indent)}client.device_action("${escCpp(s.device_id || '')}", json::parse(R"JSON(${JSON.stringify(s.action ?? {})})JSON"));`)
              continue
            }
            if (s.kind === 'sleep') {
              out.push(`${pad(indent)}// ###> "${escCpp(s.name)}" <###`)
              out.push(`${pad(indent)}sleep_ms(${Math.max(0, s.ms)});`)
              continue
            }
            if (s.kind === 'waitForStable') {
              out.push(`${pad(indent)}// ###> "${escCpp(s.name)}" <###`)
              out.push(
                `${pad(indent)}client.wait_for_stable(` +
                  `"${escCpp(s.device_id)}", "${escCpp(s.metric)}", ` +
                  `${s.tolerance}, ${Math.max(0.2, s.window_ms / 1000)}, ${Math.max(1, s.consecutive)}, ${Math.max(0, s.timeout_ms) / 1000}` +
                  `);`
              )
              continue
            }
            if (s.kind === 'record') {
              const ridVar = `rid_${s.id.replace(/[^a-zA-Z0-9_]/g, '_')}`
              out.push(`${pad(indent)}// ###> "${escCpp(s.name)}" <### (record block)`)
              out.push(`${pad(indent)}std::string ${ridVar} = client.record_start(json::parse(R"JSON(${JSON.stringify(s.params ?? {})})JSON"));`)
              out.push(`${pad(indent)}${activeRecVar}.insert(${ridVar});`)
              out.push(`${pad(indent)}try {`)
              out.push(...renderStepsCpp(s.steps, indent + 2, activeRecVar))
              out.push(`${pad(indent)}} catch (...) {`)
              out.push(`${pad(indent + 2)}client.record_stop(${ridVar}); ${activeRecVar}.erase(${ridVar}); throw;`)
              out.push(`${pad(indent)}}`)
              out.push(`${pad(indent)}client.record_stop(${ridVar});`)
              out.push(`${pad(indent)}${activeRecVar}.erase(${ridVar});`)
              continue
            }
            if (s.kind === 'while') {
              const maxIt = Math.max(1, s.max_iterations)
              out.push(`${pad(indent)}// ###> "${escCpp(s.name)}" <### (while block)`)
              out.push(`${pad(indent)}for (int i = 0; i < ${maxIt}; ++i) {`)
              out.push(`${pad(indent + 2)}double latest = client.get_latest_number("${escCpp(s.condition.device_id)}", "${escCpp(s.condition.metric)}");`)
              out.push(`${pad(indent + 2)}if (!stonegate::Client::eval_condition(latest, "${escCpp(s.condition.op)}", ${s.condition.value})) break;`)
              out.push(...renderStepsCpp(s.steps, indent + 2, activeRecVar))
              out.push(`${pad(indent)}}`)
              continue
            }
            if (s.kind === 'ifElse') {
              out.push(`${pad(indent)}// ###> "${escCpp(s.name)}" <### (if/else block)`)
              out.push(`${pad(indent)}{`)
              out.push(`${pad(indent + 2)}double latest = client.get_latest_number("${escCpp(s.condition.device_id)}", "${escCpp(s.condition.metric)}");`)
              out.push(`${pad(indent + 2)}if (stonegate::Client::eval_condition(latest, "${escCpp(s.condition.op)}", ${s.condition.value})) {`)
              out.push(...renderStepsCpp(s.thenSteps, indent + 4, activeRecVar))
              out.push(`${pad(indent + 2)}} else {`)
              out.push(...renderStepsCpp(s.elseSteps, indent + 4, activeRecVar))
              out.push(`${pad(indent + 2)}}`)
              out.push(`${pad(indent)}}`)
              continue
            }
          }
          if (out.length === 0) out.push(`${pad(indent)};`)
          return out
        }

        lines.push('int main() {')
        lines.push('  stonegate::Client client("ws://localhost:8080/status");')
        lines.push('  std::unordered_set<std::string> active_recording_ids;')
        lines.push(`  const json safe_targets = json::parse(R"JSON(${JSON.stringify(safeTargets, null, 2)})JSON");`)
        lines.push('  try {')
        lines.push(...renderStepsCpp(m.steps, 4, 'active_recording_ids'))
        lines.push('  } catch (const std::exception& e) {')
        lines.push('    std::cerr << "Macro error: " << e.what() << std::endl;')
        lines.push('  }')
        lines.push('  try { stonegate::apply_safe_state(client, active_recording_ids, safe_targets); } catch (...) {}')
        lines.push('  return 0;')
        lines.push('}')
        return lines.join('\n')
      }

      // SQL: plan/log representation
      const lines: string[] = []
      lines.push(`-- Rendered as SQL (plan/log representation; does not execute API calls)`)
      lines.push(`-- Macro: ${m.name}`)
      lines.push('')
      lines.push('CREATE TABLE IF NOT EXISTS stonegate_macro_steps (')
      lines.push('  macro_name TEXT,')
      lines.push('  step_id TEXT,')
      lines.push('  step_kind TEXT,')
      lines.push('  step_name TEXT,')
      lines.push('  device_id TEXT,')
      lines.push('  action_json TEXT,')
      lines.push('  parent_step_id TEXT')
      lines.push(');')
      lines.push('')
      const emit = (steps: Step[], parent: string | null) => {
        for (const s of steps) {
          lines.push(
            `INSERT INTO stonegate_macro_steps (macro_name, step_id, step_kind, step_name, device_id, action_json, parent_step_id) VALUES (` +
              `'${m.name.replace(/'/g, "''")}', '${s.id}', '${s.kind}', '${(s.name || '').replace(/'/g, "''")}', ` +
              `'${(s as any).device_id ?? ''}', '${JSON.stringify((s as any).action ?? {}).replace(/'/g, "''")}', ${parent ? `'${parent}'` : 'NULL'});`
          )
          if (s.kind === 'record') emit(s.steps, s.id)
          if (s.kind === 'while') emit(s.steps, s.id)
          if (s.kind === 'ifElse') {
            emit(s.thenSteps, s.id)
            emit(s.elseSteps, s.id)
          }
        }
      }
      emit(m.steps, null)
      return lines.join('\n')
    },
    []
  )

  const exportFullPython = () => {
    if (!selectedMacro) return
    const text = renderFullMacroText(selectedMacro, 'python')
    downloadText(`${selectedMacro.name.replace(/[^a-z0-9_-]+/gi, '_')}.py`, text, 'text/x-python')
  }

  const exportFullCpp = () => {
    if (!selectedMacro) return
    const text = renderFullMacroText(selectedMacro, 'cpp')
    downloadText(`${selectedMacro.name.replace(/[^a-z0-9_-]+/gi, '_')}.cpp`, text, 'text/x-c++src')
  }

  const exportNotebook = () => {
    if (!selectedMacro) return
    const py = renderFullMacroText(selectedMacro, 'python')
    const nb = {
      cells: [
        {
          cell_type: 'markdown',
          metadata: { language: 'markdown' },
          source: [`# ${selectedMacro.name}\n`, '', 'This notebook was exported from StoneGate Macro Wizard.\n'],
        },
        {
          cell_type: 'code',
          metadata: { language: 'python' },
          execution_count: null,
          outputs: [],
          source: py.split('\n').map(l => l + '\n'),
        },
      ],
      metadata: {
        language_info: { name: 'python' },
        stonegate: { macros: [selectedMacro] },
      },
      nbformat: 4,
      nbformat_minor: 5,
    }
    downloadText(`${selectedMacro.name.replace(/[^a-z0-9_-]+/gi, '_')}.ipynb`, JSON.stringify(nb, null, 2), 'application/x-ipynb+json')
  }

  const renderPreviewText = React.useMemo(() => {
    if (!selectedMacro) return ''
    if (!selectedStep) return 'Select a step to preview the equivalent API calls for that step.'

    const s = selectedStep
    const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const pad = (n: number) => ' '.repeat(Math.max(0, n))

    const jsonText0 = (obj: unknown, pretty = false) => {
      let t = JSON.stringify(obj, null, pretty ? 2 : 0)
      if (t == null) t = 'null'
      t = t.replace(/"""/g, '\\"""')
      return t
    }

    const renderPythonStep = (step: Step, indent = 0): string[] => {
      const lines: string[] = []
      lines.push(`${pad(indent)}# ###> "${esc(step.name || step.kind)}" <###`)
      if (step.enabled === false) {
        lines.push(`${pad(indent)}# (disabled)`)
        return lines
      }
      if (step.kind === 'deviceAction') {
        lines.push(`${pad(indent)}action = json.loads(r"""${jsonText0(step.action ?? {}, true)}""")`)
        lines.push(`${pad(indent)}await sg.device_action("${esc(step.device_id || '')}", action)`) 
        return lines
      }
      if (step.kind === 'sleep') {
        lines.push(`${pad(indent)}await asyncio.sleep(${Math.max(0, step.ms) / 1000})`)
        return lines
      }
      if (step.kind === 'waitForStable') {
        lines.push(
          `${pad(indent)}await sg.wait_for_stable(` +
            `device_id="${esc(step.device_id)}", metric="${esc(step.metric)}", ` +
            `tolerance=${step.tolerance}, window_s=${Math.max(0.2, step.window_ms / 1000)}, consecutive=${Math.max(1, step.consecutive)}, timeout_s=${Math.max(0, step.timeout_ms) / 1000}` +
            `)`
        )
        return lines
      }
      if (step.kind === 'record') {
        lines.push(`${pad(indent)}params = json.loads(r"""${jsonText0(step.params ?? {}, true)}""")`)
        lines.push(`${pad(indent)}recording_id = await sg.record_start(params)`)
        lines.push(`${pad(indent)}try:`)
        for (const inner of step.steps) lines.push(...renderPythonStep(inner, indent + 2))
        lines.push(`${pad(indent)}finally:`)
        lines.push(`${pad(indent + 2)}await sg.record_stop(recording_id)`)
        return lines
      }
      if (step.kind === 'while') {
        lines.push(`${pad(indent)}# Condition: ${esc(step.condition.device_id)}.${esc(step.condition.metric)} ${step.condition.op} ${step.condition.value}`)
        lines.push(`${pad(indent)}for _i in range(${Math.max(1, step.max_iterations)}):`)
        lines.push(`${pad(indent + 2)}latest = await sg.get_latest_number("${esc(step.condition.device_id)}", "${esc(step.condition.metric)}")`)
        lines.push(`${pad(indent + 2)}if not sg.eval_condition(latest, "${esc(step.condition.op)}", ${step.condition.value}):`)
        lines.push(`${pad(indent + 4)}break`)
        for (const inner of step.steps) lines.push(...renderPythonStep(inner, indent + 2))
        return lines
      }
      if (step.kind === 'ifElse') {
        lines.push(`${pad(indent)}# Condition: ${esc(step.condition.device_id)}.${esc(step.condition.metric)} ${step.condition.op} ${step.condition.value}`)
        lines.push(`${pad(indent)}latest = await sg.get_latest_number("${esc(step.condition.device_id)}", "${esc(step.condition.metric)}")`)
        lines.push(`${pad(indent)}if sg.eval_condition(latest, "${esc(step.condition.op)}", ${step.condition.value}):`)
        for (const inner of step.thenSteps) lines.push(...renderPythonStep(inner, indent + 2))
        lines.push(`${pad(indent)}else:`)
        for (const inner of step.elseSteps) lines.push(...renderPythonStep(inner, indent + 2))
        return lines
      }
      return lines
    }

    const renderCppStep = (step: Step, indent = 0): string[] => {
      const lines: string[] = []
      lines.push(`${pad(indent)}// ###> "${esc(step.name || step.kind)}" <###`)
      if (step.enabled === false) {
        lines.push(`${pad(indent)}// (disabled)`)
        return lines
      }
      if (step.kind === 'deviceAction') {
        lines.push(`${pad(indent)}auto action = stonegate::json::parse(R"JSON(${JSON.stringify(step.action ?? {})})JSON");`)
        lines.push(`${pad(indent)}client.device_action("${esc(step.device_id || '')}", action);`)
        return lines
      }
      if (step.kind === 'sleep') {
        lines.push(`${pad(indent)}std::this_thread::sleep_for(std::chrono::milliseconds(${Math.max(0, step.ms)}));`)
        return lines
      }
      if (step.kind === 'record') {
        lines.push(`${pad(indent)}auto params = stonegate::json::parse(R"JSON(${JSON.stringify(step.params ?? {})})JSON");`)
        lines.push(`${pad(indent)}std::string recording_id = client.record_start(params);`)
        lines.push(`${pad(indent)}try {`)
        for (const inner of step.steps) lines.push(...renderCppStep(inner, indent + 2))
        lines.push(`${pad(indent)}} catch (...) {`)
        lines.push(`${pad(indent + 2)}client.record_stop(recording_id);`)
        lines.push(`${pad(indent + 2)}throw;`)
        lines.push(`${pad(indent)}}`)
        lines.push(`${pad(indent)}client.record_stop(recording_id);`)
        return lines
      }
      if (step.kind === 'waitForStable') {
        lines.push(
          `${pad(indent)}client.wait_for_stable(` +
            `"${esc(step.device_id)}", "${esc(step.metric)}", ` +
            `${step.tolerance}, ${Math.max(0.2, step.window_ms / 1000)}, ${Math.max(1, step.consecutive)}, ${Math.max(0, step.timeout_ms) / 1000}` +
            `);`
        )
        return lines
      }
      if (step.kind === 'while') {
        lines.push(`${pad(indent)}// Condition: ${esc(step.condition.device_id)}.${esc(step.condition.metric)} ${step.condition.op} ${step.condition.value}`)
        lines.push(`${pad(indent)}for (int i = 0; i < ${Math.max(1, step.max_iterations)}; ++i) {`)
        lines.push(`${pad(indent + 2)}double latest = client.get_latest_number("${esc(step.condition.device_id)}", "${esc(step.condition.metric)}");`)
        lines.push(`${pad(indent + 2)}if (!stonegate::Client::eval_condition(latest, "${esc(step.condition.op)}", ${step.condition.value})) break;`)
        for (const inner of step.steps) lines.push(...renderCppStep(inner, indent + 2))
        lines.push(`${pad(indent)}}`)
        return lines
      }
      if (step.kind === 'ifElse') {
        lines.push(`${pad(indent)}// Condition: ${esc(step.condition.device_id)}.${esc(step.condition.metric)} ${step.condition.op} ${step.condition.value}`)
        lines.push(`${pad(indent)}double latest = client.get_latest_number("${esc(step.condition.device_id)}", "${esc(step.condition.metric)}");`)
        lines.push(`${pad(indent)}if (stonegate::Client::eval_condition(latest, "${esc(step.condition.op)}", ${step.condition.value})) {`)
        for (const inner of step.thenSteps) lines.push(...renderCppStep(inner, indent + 2))
        lines.push(`${pad(indent)}} else {`)
        for (const inner of step.elseSteps) lines.push(...renderCppStep(inner, indent + 2))
        lines.push(`${pad(indent)}}`)
        return lines
      }
      return lines
    }

    if (macroRenderAs === 'json' || macroRenderAs === 'ui') return JSON.stringify(s, null, 2)
    if (macroRenderAs === 'python') {
      return (
        ['import asyncio', 'import json', 'import stonegate_api as sg', '', "sg.WS_URL = 'ws://localhost:8080/status'", '', '# In an async context:', '']
          .concat(renderPythonStep(s))
          .join('\n')
      )
    }
    if (macroRenderAs === 'cpp') {
      return (
        [
          '#include "stonegate_api.hpp"',
          '#include <chrono>',
          '#include <string>',
          '#include <thread>',
          '',
          'stonegate::Client client("ws://localhost:8080/status");',
          '',
        ]
          .concat(renderCppStep(s))
          .join('\n')
      )
    }
    if (macroRenderAs === 'sql') {
      return (
        `-- Step-only SQL plan\n` +
        `-- Macro: ${selectedMacro.name}\n` +
        `-- Step: ${s.name} (${s.kind})\n\n` +
        `INSERT INTO stonegate_macro_steps (macro_name, step_id, step_kind, step_name, device_id, action_json, parent_step_id) VALUES (` +
        `'${selectedMacro.name.replace(/'/g, "''")}', '${s.id}', '${s.kind}', '${(s.name || '').replace(/'/g, "''")}', ` +
        `'${(s as any).device_id ?? ''}', '${JSON.stringify((s as any).action ?? {}).replace(/'/g, "''")}', NULL);`
      )
    }
    return JSON.stringify(s, null, 2)
  }, [macroRenderAs, selectedMacro, selectedStep])

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

    // Allow importing Jupyter notebooks by embedding macros in notebook metadata.
    // Expected shape:
    // { metadata: { stonegate: { macro: {..} } } } OR { metadata: { stonegate: { macros: [..] } } }
    if (v && typeof v === 'object' && Array.isArray((v as any).cells)) {
      const nbStonegate = (v as any).metadata?.stonegate
      if (Array.isArray(nbStonegate?.macros)) incoming = nbStonegate.macros
      else if (nbStonegate?.macro && typeof nbStonegate.macro === 'object') incoming = [nbStonegate.macro]
      else {
        const inferred = tryParseNotebookAsMacroFromCode(v)
        if (inferred) incoming = [inferred]
        else {
          appendLog('Import failed: notebook missing metadata.stonegate.macro(s) and no recognizable stonegate_api calls were found')
          setBottomTab('errors')
          return
        }
      }
    }

    if (!incoming.length) {
      if (Array.isArray(v)) incoming = v
      else if (v && typeof v === 'object' && typeof v.id === 'string' && Array.isArray((v as any).steps)) incoming = [v as ScriptMacro]
      else {
        appendLog('Import failed: JSON must be a macro or an array of macros')
        setBottomTab('errors')
        return
      }
    }

    // normalize
    incoming = incoming.map(m => ({
      id: typeof m.id === 'string' ? m.id : newId(),
      name: String(m.name || 'Imported Macro'),
      renderAs: (m as any).renderAs ?? 'ui',
      defaults: (m as any).defaults ?? { safeState: { targets: {} } },
      steps: Array.isArray(m.steps) ? (m.steps as Step[]) : [],
    }))
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
      const incoming = (v as any[]).map((m: any) => ({
        id: typeof m.id === 'string' ? m.id : newId(),
        name: String(m.name || 'Bundled Macro'),
        renderAs: m.renderAs ?? 'ui',
        defaults: m.defaults ?? { safeState: { targets: {} } },
        steps: Array.isArray(m.steps) ? (m.steps as Step[]) : [],
      }))
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
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'calc(100vh - 24px)',
        minWidth: 320,
        minHeight: 240,
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
          <button title="Settings" onClick={openSettingsMenu} style={{ padding: '0.3em 0.6em' }}>
            ⚙
          </button>
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
          <button onClick={openExportDialog} disabled={!selectedMacro && !macros.length} style={{ padding: '0.3em 0.7em' }}>Export…</button>
          <button onClick={() => importFileInputRef.current?.click()} style={{ padding: '0.3em 0.7em' }}>Import</button>
          <button onClick={loadBundled} style={{ padding: '0.3em 0.7em' }}>Load bundled</button>
          <input
            ref={importFileInputRef}
            type="file"
            accept=".json,.ipynb,application/json,application/x-ipynb+json"
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
                <div key={i}>{e.message}</div>
              ))}
              {validationErrors.length > 10 && <div>... ({validationErrors.length - 10} more)</div>}
            </div>
          )}
        </div>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', padding: 8, height: 190, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => setBottomTab('preview')} style={{ padding: '0.25em 0.6em', opacity: bottomTab === 'preview' ? 1 : 0.7 }}>Preview</button>
            <button onClick={() => setBottomTab('errors')} style={{ padding: '0.25em 0.6em', opacity: bottomTab === 'errors' ? 1 : 0.7 }}>Errors</button>
            <div style={{ flex: 1, opacity: 0.75, fontSize: 12 }}>Status: {runStatus}{currentStepId ? ` • step ${currentStepId}` : ''}</div>
            {selectedMacro && <div style={{ opacity: 0.75, fontSize: 12 }}>Render: {macroRenderAs.toUpperCase()}</div>}
          </div>

          {bottomTab === 'preview' ? (
            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflow: 'hidden' }}>
              {macroRenderAs === 'json' ? (
                <>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div style={{ flex: 1, opacity: 0.75, fontSize: 12 }}>{selectedStep ? `Editing step JSON: ${selectedStep.name}` : 'Select a step to edit.'}</div>
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
                </>
              ) : macroRenderAs === 'ui' ? (
                <div style={{ flex: 1, overflow: 'auto' }}>
                  {!selectedStep ? (
                    <div style={{ opacity: 0.75, fontSize: 12 }}>Select a step to configure.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <strong style={{ flex: 1 }}>{selectedStep.name}</strong>
                        <div style={{ opacity: 0.75, fontSize: 12 }}>{selectedStep.kind}</div>
                      </div>

                      {selectedStep.kind === 'deviceAction' && (
                        <>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ fontSize: 12, opacity: 0.8 }}>Device</div>
                            <select
                              value={selectedStep.device_id}
                              disabled={!canEditStep(selectedStep.id)}
                              onChange={e => setStep(selectedStep.id, { device_id: e.target.value } as any)}
                            >
                              <option value="">-- select device --</option>
                              {allDeviceIds.map(id => (
                                <option key={id} value={id}>
                                  {id}
                                </option>
                              ))}
                            </select>
                          </label>

                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button
                              disabled={!canEditStep(selectedStep.id) || !selectedStep.device_id}
                              onClick={() => setUiDeviceActionDialog({ mode: 'step', stepId: selectedStep.id, deviceId: selectedStep.device_id })}
                            >
                              Set…
                            </button>

                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: canEditStep(selectedStep.id) ? 1 : 0.6 }}>
                              <input
                                type="checkbox"
                                checked={selectedStep.safeClamp !== false}
                                disabled={!canEditStep(selectedStep.id)}
                                onChange={e => setStep(selectedStep.id, { safeClamp: e.target.checked } as any)}
                              />
                              Clamp to descriptor bounds
                            </label>
                          </div>

                          <div style={{ fontSize: 12, opacity: 0.8 }}>
                            Current action: {JSON.stringify(selectedStep.action ?? {}, null, 0)}
                          </div>
                        </>
                      )}

                      {selectedStep.kind === 'sleep' && (
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <div style={{ fontSize: 12, opacity: 0.8 }}>Milliseconds</div>
                          <input
                            type="number"
                            value={selectedStep.ms}
                            disabled={!canEditStep(selectedStep.id)}
                            onChange={e => setStep(selectedStep.id, { ms: Number(e.target.value) } as any)}
                          />
                        </label>
                      )}

                      {selectedStep.kind === 'waitForStable' && (
                        <>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ fontSize: 12, opacity: 0.8 }}>Device</div>
                            <select
                              value={selectedStep.device_id}
                              disabled={!canEditStep(selectedStep.id)}
                              onChange={e => {
                                const nextId = e.target.value
                                setStep(selectedStep.id, { device_id: nextId, metric: '' } as any)
                              }}
                            >
                              <option value="">-- select device --</option>
                              {allDeviceIds.map(id => (
                                <option key={id} value={id}>
                                  {id}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ fontSize: 12, opacity: 0.8 }}>Metric</div>
                            <select
                              value={selectedStep.metric}
                              disabled={!canEditStep(selectedStep.id) || !selectedStep.device_id}
                              onChange={e => setStep(selectedStep.id, { metric: e.target.value } as any)}
                            >
                              <option value="">-- select metric --</option>
                              {Object.keys(descriptors[selectedStep.device_id]?.metrics ?? {}).map(mk => (
                                <option key={mk} value={mk}>
                                  {mk}
                                </option>
                              ))}
                            </select>
                          </label>

                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              <div style={{ fontSize: 12, opacity: 0.8 }}>Tolerance</div>
                              <input type="number" value={selectedStep.tolerance} disabled={!canEditStep(selectedStep.id)} onChange={e => setStep(selectedStep.id, { tolerance: Number(e.target.value) } as any)} />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              <div style={{ fontSize: 12, opacity: 0.8 }}>Window (ms)</div>
                              <input type="number" value={selectedStep.window_ms} disabled={!canEditStep(selectedStep.id)} onChange={e => setStep(selectedStep.id, { window_ms: Number(e.target.value) } as any)} />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              <div style={{ fontSize: 12, opacity: 0.8 }}>Consecutive</div>
                              <input type="number" value={selectedStep.consecutive} disabled={!canEditStep(selectedStep.id)} onChange={e => setStep(selectedStep.id, { consecutive: Number(e.target.value) } as any)} />
                            </label>
                            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              <div style={{ fontSize: 12, opacity: 0.8 }}>Timeout (ms)</div>
                              <input type="number" value={selectedStep.timeout_ms} disabled={!canEditStep(selectedStep.id)} onChange={e => setStep(selectedStep.id, { timeout_ms: Number(e.target.value) } as any)} />
                            </label>
                          </div>
                        </>
                      )}

                      {(selectedStep.kind === 'record' || selectedStep.kind === 'while' || selectedStep.kind === 'ifElse') && (
                        <div style={{ opacity: 0.75, fontSize: 12 }}>
                          Block step configuration is currently easiest in Render As: JSON.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <textarea
                  readOnly
                  value={renderPreviewText}
                  style={{
                    width: '100%',
                    flex: 1,
                    resize: 'none',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    fontSize: 12,
                    opacity: 0.95,
                  }}
                />
              )}
            </div>
          ) : (
            <div style={{ marginTop: 6, flex: 1, overflow: 'auto', fontSize: 12 }}>
              {(() => {
                const stepId = selectedStep?.id
                const ve = stepId ? validationErrors.filter(e => e.stepId === stepId) : validationErrors
                const rows = stepId
                  ? log.filter(l => l.stepId === stepId || (!l.stepId && l.line.startsWith('Run error:')))
                  : log

                if (stepId && ve.length === 0 && rows.length === 0) {
                  return <div style={{ opacity: 0.75 }}>No errors/log for selected step.</div>
                }

                if (!stepId && ve.length === 0 && rows.length === 0) {
                  return <div style={{ opacity: 0.75 }}>No errors/log yet.</div>
                }

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {ve.length > 0 && (
                      <div style={{ color: '#ff6b6b' }}>
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>Validation</div>
                        {ve.slice(0, 50).map((e, i) => (
                          <div key={i}>{e.message}</div>
                        ))}
                        {ve.length > 50 && <div>... ({ve.length - 50} more)</div>}
                      </div>
                    )}

                    <div>
                      {rows.slice(-200).map((l, i) => (
                        <div key={i}>
                          <span style={{ opacity: 0.7 }}>[{l.ts}]</span> {l.line}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />

      {showExportDialog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
          }}
          onMouseDown={() => setShowExportDialog(false)}
        >
          <div
            style={{
              width: 'min(640px, 92vw)',
              maxHeight: '80vh',
              overflow: 'auto',
              background: '#071827',
              color: '#e6eef8',
              borderRadius: 10,
              padding: 12,
              border: '1px solid rgba(255,255,255,0.18)',
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <h3 style={{ margin: 0 }}>Export</h3>
              <button onClick={() => setShowExportDialog(false)}>Cancel</button>
            </div>

            <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>
              {selectedMacro ? `Macro: ${selectedMacro.name}` : 'No macro selected.'}
            </div>

            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {selectedMacro && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="radio" name="export" checked={exportChoice === 'selected-json'} onChange={() => setExportChoicePersisted('selected-json')} />
                  <span>Selected macro (JSON)</span>
                </label>
              )}
              {macros.length > 0 && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="radio" name="export" checked={exportChoice === 'all-json'} onChange={() => setExportChoicePersisted('all-json')} />
                  <span>All macros (JSON)</span>
                </label>
              )}
              {selectedMacro && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="radio" name="export" checked={exportChoice === 'python'} onChange={() => setExportChoicePersisted('python')} />
                  <span>Python (.py)</span>
                </label>
              )}
              {selectedMacro && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="radio" name="export" checked={exportChoice === 'cpp'} onChange={() => setExportChoicePersisted('cpp')} />
                  <span>C++ (.cpp)</span>
                </label>
              )}
              {selectedMacro && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="radio" name="export" checked={exportChoice === 'notebook'} onChange={() => setExportChoicePersisted('notebook')} />
                  <span>Jupyter notebook (.ipynb)</span>
                </label>
              )}
            </div>

            {exportDialogStatus && <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>{exportDialogStatus}</div>}

            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {(exportChoice === 'python' || exportChoice === 'cpp') && selectedMacro && (
                <button
                  onClick={async () => {
                    if (!selectedMacro) return
                    const text = renderFullMacroText(selectedMacro, exportChoice === 'python' ? 'python' : 'cpp')
                    const ok = await copyTextToClipboard(text)
                    setExportDialogStatus(ok ? 'Copied to clipboard.' : 'Copy failed.')
                  }}
                >
                  Copy
                </button>
              )}
              <button onClick={() => setShowExportDialog(false)}>Cancel</button>
              <button
                onClick={() => {
                  if (exportChoice === 'all-json') exportMacros()
                  else if (exportChoice === 'selected-json') exportSelectedMacro()
                  else if (exportChoice === 'python') exportFullPython()
                  else if (exportChoice === 'cpp') exportFullCpp()
                  else if (exportChoice === 'notebook') exportNotebook()
                  setShowExportDialog(false)
                }}
                disabled={
                  (exportChoice === 'all-json' && macros.length === 0) ||
                  (exportChoice !== 'all-json' && !selectedMacro)
                }
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {showSafeStateDialog && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 1100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
          }}
          onMouseDown={() => setShowSafeStateDialog(false)}
        >
          <div
            style={{
              width: 'min(720px, 92vw)',
              maxHeight: '80vh',
              overflow: 'auto',
              background: '#071827',
              color: '#e6eef8',
              borderRadius: 10,
              padding: 12,
              border: '1px solid rgba(255,255,255,0.18)',
            }}
            onMouseDown={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <h3 style={{ margin: 0 }}>Defaults: Safe State</h3>
              <button onClick={() => setShowSafeStateDialog(false)}>Close</button>
            </div>

            {!selectedMacro ? (
              <div style={{ marginTop: 10, opacity: 0.85, fontSize: 12 }}>Select a macro first.</div>
            ) : (
              <>
                <div style={{ marginTop: 8, opacity: 0.85, fontSize: 12 }}>
                  Safe State runs automatically on completion or cancel. It stops active recordings, applies the targets below, then waits (best-effort) for targets to be reached.
                </div>

                <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    value=""
                    onChange={e => {
                      const deviceId = e.target.value
                      if (!deviceId) return
                      updateMacro(m => {
                        const prev = m.defaults?.safeState?.targets ?? {}
                        if (prev[deviceId]) return m
                        return { ...m, defaults: { ...(m.defaults ?? {}), safeState: { targets: { ...prev, [deviceId]: {} } } } }
                      })
                    }}
                  >
                    <option value="">+ Add device…</option>
                    {allDeviceIds.map(id => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {Object.entries(selectedMacro.defaults?.safeState?.targets ?? {}).length === 0 ? (
                    <div style={{ opacity: 0.75, fontSize: 12 }}>No safe targets configured.</div>
                  ) : (
                    Object.entries(selectedMacro.defaults?.safeState?.targets ?? {}).map(([deviceId, values]) => (
                      <div key={deviceId} style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <strong style={{ flex: 1 }}>{deviceId}</strong>
                          <button onClick={() => setUiDeviceActionDialog({ mode: 'safeState', deviceId })}>Edit…</button>
                          <button
                            onClick={() =>
                              updateMacro(m => {
                                const prev = m.defaults?.safeState?.targets ?? {}
                                const next = { ...prev }
                                delete next[deviceId]
                                return { ...m, defaults: { ...(m.defaults ?? {}), safeState: { targets: next } } }
                              })
                            }
                          >
                            Remove
                          </button>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
                          {Object.keys(values ?? {}).length === 0 ? 'No fields set.' : JSON.stringify(values)}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {uiDeviceActionDialog && (
        <DeviceActionDialog
          title={uiDeviceActionDialog.mode === 'safeState' ? 'Safe State: Set Parameters' : 'Step: Set Parameters'}
          deviceId={uiDeviceActionDialog.deviceId}
          descriptor={descriptors[uiDeviceActionDialog.deviceId]}
          initial={
            uiDeviceActionDialog.mode === 'safeState'
              ? (selectedMacro?.defaults?.safeState?.targets?.[uiDeviceActionDialog.deviceId] ?? {})
              : (() => {
                  const s = selectedMacro ? findStepById(selectedMacro.steps, uiDeviceActionDialog.stepId) : null
                  const setMap = (s && (s as any).action && typeof (s as any).action === 'object' ? (s as any).action.set : null) as any
                  return setMap && typeof setMap === 'object' ? setMap : {}
                })()
          }
          onClose={() => setUiDeviceActionDialog(null)}
          onApply={action => {
            if (!selectedMacro) {
              setUiDeviceActionDialog(null)
              return
            }
            if (uiDeviceActionDialog.mode === 'safeState') {
              const setMap = action?.set && typeof action.set === 'object' ? action.set : {}
              updateMacro(m => {
                const prev = m.defaults?.safeState?.targets ?? {}
                return { ...m, defaults: { ...(m.defaults ?? {}), safeState: { targets: { ...prev, [uiDeviceActionDialog.deviceId]: setMap } } } }
              })
            } else {
              if (!canEditStep(uiDeviceActionDialog.stepId)) {
                appendLog('Step is locked while running')
                setUiDeviceActionDialog(null)
                return
              }
              updateMacro(m => ({
                ...m,
                steps: updateStepById(m.steps, uiDeviceActionDialog.stepId, s => ({
                  ...s,
                  kind: 'deviceAction',
                  device_id: uiDeviceActionDialog.deviceId,
                  action,
                }))
              }))
              appendLog('Step updated')
              revalidate()
            }
            setUiDeviceActionDialog(null)
          }}
        />
      )}
    </div>
  )
}
