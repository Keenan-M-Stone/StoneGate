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

  return []
}

export function buildSetActionFromValues(desc: DeviceDescriptor | undefined, values: Record<string, any>) {
  const fields = getDeviceControlFields(desc)
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

  // Use { set: {metric: value} } shape; backend maps it.
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
    const action = buildSetActionFromValues(descriptor, values)
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
