import React from 'react'
import type { DeviceDescriptor } from '../state/store'

export type DeviceControlField = {
  key: string
  label: string
  kind: 'number' | 'integer' | 'boolean' | 'string'
  unit?: string
  min?: number
  max?: number
  step?: number
}

export function getDeviceControlFields(desc?: DeviceDescriptor): DeviceControlField[] {
  if (!desc) return []

  // Until the backend explicitly advertises writable controls, use conservative
  // per-device-type mappings.
  if (desc.type === 'laser_controller') {
    const phase = desc.metrics?.phase_rad
    const intensity = desc.metrics?.intensity
    return [
      {
        key: 'phase_rad',
        label: 'Phase',
        kind: (phase?.kind as any) ?? 'number',
        unit: phase?.unit,
        min: phase?.soft_min ?? phase?.min,
        max: phase?.soft_max ?? phase?.max,
        step: phase?.precision,
      },
      {
        key: 'intensity',
        label: 'Intensity',
        kind: (intensity?.kind as any) ?? 'number',
        unit: intensity?.unit,
        min: intensity?.soft_min ?? intensity?.min,
        max: intensity?.soft_max ?? intensity?.max,
        step: intensity?.precision,
      },
    ]
  }

  if (desc.type === 'ln2_cooling_controller') {
    const temp = desc.metrics?.temperature_K
    const flow = desc.metrics?.flow_rate_Lmin
    return [
      {
        key: 'temperature_K',
        label: 'Temperature Target',
        kind: (temp?.kind as any) ?? 'number',
        unit: temp?.unit,
        min: temp?.soft_min ?? temp?.min,
        max: temp?.soft_max ?? temp?.max,
        step: temp?.precision,
      },
      {
        key: 'flow_rate_Lmin',
        label: 'Flow Rate',
        kind: (flow?.kind as any) ?? 'number',
        unit: flow?.unit,
        min: flow?.soft_min ?? flow?.min,
        max: flow?.soft_max ?? flow?.max,
        step: flow?.precision,
      },
    ]
  }

  if (desc.type === 'pulse_sequencer') {
    return [
      { key: 'load_sequence', label: 'Load Sequence', kind: 'string' },
      { key: 'start', label: 'Start', kind: 'boolean' },
      { key: 'stop', label: 'Stop', kind: 'boolean' },
      { key: 'step', label: 'Step', kind: 'boolean' },
    ]
  }

  // Simulator QEC tooling (shared/protocol/ComponentSchema.json)
  if (desc.type === 'SyndromeStream') {
    return [
      { key: 'set_code_type', label: 'Code Type', kind: 'string' },
      { key: 'set_rate_hz', label: 'Rate (Hz)', kind: 'number', min: 0.1, max: 500, step: 0.1 },
      { key: 'start', label: 'Start', kind: 'boolean' },
      { key: 'stop', label: 'Stop', kind: 'boolean' },
    ]
  }

  if (desc.type === 'NoiseSpectrometer') {
    return [
      { key: 'set_band_hz', label: 'Band (Hz)', kind: 'number', min: 1, max: 1_000_000, step: 1 },
      { key: 'set_duration_s', label: 'Duration (s)', kind: 'number', min: 0.01, max: 120, step: 0.01 },
      { key: 'run_scan', label: 'Run Scan', kind: 'boolean' },
    ]
  }

  if (desc.type === 'ReadoutCalibrator') {
    return [
      { key: 'set_target_device', label: 'Target Device ID', kind: 'string' },
      { key: 'set_samples', label: 'Samples', kind: 'integer', min: 10, max: 100_000, step: 1 },
      { key: 'calibrate', label: 'Calibrate', kind: 'boolean' },
    ]
  }

  if (desc.type === 'FaultInjector') {
    return [
      { key: 'env_temperature_K', label: 'Env Temperature (K)', kind: 'number', min: 0, max: 500, step: 0.1 },
      { key: 'env_pressure_kPa', label: 'Env Pressure (kPa)', kind: 'number', min: 0, max: 300, step: 0.1 },
      { key: 'env_ambient_lux', label: 'Env Ambient (lux)', kind: 'number', min: 0, max: 1_000_000, step: 1 },
      { key: 'env_vibration_rms', label: 'Env Vibration (RMS)', kind: 'number', min: 0, max: 10, step: 1e-4 },
      { key: 'set_notes', label: 'Notes', kind: 'string' },
      { key: 'override_target_device', label: 'Override Target Device', kind: 'string' },
      { key: 'override_json', label: 'Override JSON (object)', kind: 'string' },
      { key: 'clear_overrides', label: 'Clear Overrides', kind: 'boolean' },
      { key: 'disable', label: 'Disable Injector', kind: 'boolean' },
    ]
  }

  if (desc.type === 'LeakageResetController') {
    return [
      { key: 'set_target_device', label: 'Target Device ID', kind: 'string' },
      { key: 'set_leakage_fraction', label: 'Leakage Fraction', kind: 'number', min: 0, max: 1, step: 0.001 },
      { key: 'attempt_reset', label: 'Attempt Reset', kind: 'boolean' },
    ]
  }

  if (desc.type === 'SurfaceCodeController') {
    return [
      { key: 'configure_distance', label: 'Code Distance', kind: 'integer', min: 3, max: 99, step: 2 },
      { key: 'run_cycles', label: 'Run Cycles', kind: 'integer', min: 1, max: 1_000_000, step: 1 },
      { key: 'stop', label: 'Stop', kind: 'boolean' },
    ]
  }

  if (desc.type === 'LatticeSurgeryController') {
    return [
      { key: 'set_operation', label: 'Operation', kind: 'string' },
      { key: 'run_demo', label: 'Run Demo', kind: 'boolean' },
    ]
  }

  return []
}

function isQecToolDeviceType(t: string | undefined) {
  return (
    t === 'SyndromeStream' ||
    t === 'NoiseSpectrometer' ||
    t === 'ReadoutCalibrator' ||
    t === 'FaultInjector' ||
    t === 'LeakageResetController' ||
    t === 'SurfaceCodeController' ||
    t === 'LatticeSurgeryController'
  )
}

export function buildActionFromValues(desc: DeviceDescriptor | undefined, values: Record<string, any>) {
  const fields = getDeviceControlFields(desc)
  const deviceType = desc?.type

  // Special builders for composite action payloads.
  if (deviceType === 'FaultInjector') {
    const action: Record<string, any> = {}

    const env: Record<string, number> = {}
    const tK = values.env_temperature_K
    const pK = values.env_pressure_kPa
    const lux = values.env_ambient_lux
    const vib = values.env_vibration_rms
    for (const [k, v] of [
      ['temperature_K', tK],
      ['pressure_kPa', pK],
      ['ambient_lux', lux],
      ['vibration_rms', vib],
    ] as const) {
      if (v === undefined || v === null || v === '') continue
      const n = typeof v === 'number' ? v : Number(v)
      if (Number.isFinite(n)) env[k] = n
    }
    if (Object.keys(env).length) action.set_env = env

    const notes = values.set_notes
    if (notes !== undefined && notes !== null && String(notes).trim() !== '') action.set_notes = String(notes)

    if (values.clear_overrides) action.clear_overrides = true
    if (values.disable) action.disable = true

    const target = values.override_target_device
    const overrideJson = values.override_json
    if (
      target !== undefined &&
      target !== null &&
      String(target).trim() !== '' &&
      overrideJson !== undefined &&
      overrideJson !== null &&
      String(overrideJson).trim() !== ''
    ) {
      try {
        const parsed = JSON.parse(String(overrideJson))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          action.override_device = { device_id: String(target).trim(), override: parsed }
        }
      } catch {
        // ignore invalid JSON
      }
    }

    return action
  }

  if (deviceType === 'SurfaceCodeController') {
    const action: Record<string, any> = {}
    const d = values.configure_distance
    if (d !== undefined && d !== null && d !== '') {
      const n = typeof d === 'number' ? d : Number(d)
      if (Number.isFinite(n)) action.configure = { distance: Math.trunc(n) }
    }
    const cycles = values.run_cycles
    if (cycles !== undefined && cycles !== null && cycles !== '') {
      const n = typeof cycles === 'number' ? cycles : Number(cycles)
      if (Number.isFinite(n)) action.run_cycles = { cycles: Math.trunc(n) }
    }
    if (values.stop) action.stop = true
    return action
  }

  // QEC tools use raw action keys (no {set:{...}} wrapper), so the backend receives
  // e.g. { start:true } rather than { set: { start:true } }.
  if (isQecToolDeviceType(deviceType)) {
    const action: Record<string, any> = {}

    for (const f of fields) {
      const v = values[f.key]
      if (v === undefined || v === null || v === '') continue
      if (f.kind === 'boolean') {
        if (!!v) action[f.key] = true
        continue
      }
      if (f.kind === 'number' || f.kind === 'integer') {
        const n = typeof v === 'number' ? v : Number(v)
        if (Number.isFinite(n)) action[f.key] = f.kind === 'integer' ? Math.trunc(n) : n
        continue
      }
      action[f.key] = String(v)
    }

    return action
  }

  // Default: Use { set: {metric: value} } shape; backend maps it.
  const out: Record<string, any> = {}
  for (const f of fields) {
    const v = values[f.key]
    if (v === undefined || v === null || v === '') continue
    if (f.kind === 'number' || f.kind === 'integer') {
      const n = typeof v === 'number' ? v : Number(v)
      if (Number.isFinite(n)) out[f.key] = n
    } else if (f.kind === 'boolean') {
      out[f.key] = !!v
    } else {
      out[f.key] = String(v)
    }
  }
  return { set: out }
}

export default function DeviceActionDialog({
  title,
  deviceId,
  descriptor,
  initial,
  onClose,
  onApply,
}: {
  title: string
  deviceId: string
  descriptor?: DeviceDescriptor
  initial?: Record<string, any>
  onClose: () => void
  onApply: (action: any) => void
}) {
  const fields = React.useMemo(() => getDeviceControlFields(descriptor), [descriptor])
  const [values, setValues] = React.useState<Record<string, any>>(() => ({ ...(initial ?? {}) }))

  const apply = () => {
    const action = buildActionFromValues(descriptor, values)
    onApply(action)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
      }}
      onMouseDown={onClose}
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
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose}>Close</button>
        </div>

        <div style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>Device: {deviceId}</div>

        {fields.length === 0 ? (
          <div style={{ marginTop: 10, opacity: 0.85 }}>
            No writable controls are defined for this device type yet.
          </div>
        ) : (
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {fields.map(f => (
              <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <strong style={{ fontSize: 13 }}>{f.label}</strong>
                  {f.unit && <span style={{ opacity: 0.75, fontSize: 12 }}>{f.unit}</span>}
                </div>

                {f.kind === 'boolean' ? (
                  <input
                    type="checkbox"
                    checked={!!values[f.key]}
                    onChange={e => setValues(prev => ({ ...prev, [f.key]: e.target.checked }))}
                  />
                ) : (
                  <input
                    type={f.kind === 'string' ? 'text' : 'number'}
                    value={values[f.key] ?? ''}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    onChange={e => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                  />
                )}

                <div style={{ opacity: 0.7, fontSize: 12 }}>
                  {f.kind !== 'string' && (f.min !== undefined || f.max !== undefined) ? (
                    <span>
                      {f.min !== undefined ? `min ${f.min}` : ''}
                      {f.min !== undefined && f.max !== undefined ? ' · ' : ''}
                      {f.max !== undefined ? `max ${f.max}` : ''}
                    </span>
                  ) : (
                    <span>&nbsp;</span>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button onClick={onClose}>Cancel</button>
          <button onClick={apply} disabled={fields.length === 0}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
