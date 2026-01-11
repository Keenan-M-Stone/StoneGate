import { create } from 'zustand'
import type { DeviceStatus } from '../../../shared/protocol/MessageTypes'

export type ObservableMeta = {
  kind?: 'number' | 'integer' | 'boolean' | 'vector' | 'string'
  unit?: string
  backend_unit?: string
  min?: number
  max?: number
  soft_min?: number
  soft_max?: number
  precision?: number
}

export type DeviceDescriptor = {
  id: string
  type: string
  status?: string
  specs?: any
  metrics?: Record<string, ObservableMeta>
}

export type SchematicOverride = {
  graph: any
  schema: any
  meta?: any
}

type DeviceEntry = DeviceStatus & { label?: string }

interface DeviceState {
  devices: Record<string, DeviceEntry>
  descriptors: Record<string, DeviceDescriptor>
  schematicOverride: SchematicOverride | null
  upsertDevice: (d: DeviceStatus) => void
  upsertDescriptor: (d: DeviceDescriptor) => void
  setSchematicOverride: (o: SchematicOverride | null) => void
}

export const useDeviceStore = create<DeviceState>((set, _get) => ({
  devices: {},
  descriptors: {},
  schematicOverride: null,
  upsertDevice: (d) =>
    set(state => ({
      devices: {
        ...state.devices,
        [d.device_id]: { ...d, label: state.devices[d.device_id]?.label ?? d.device_id },
      },
    })),
  upsertDescriptor: (d) =>
    set(state => ({
      descriptors: {
        ...state.descriptors,
        [d.id]: d,
      },
    })),
  setSchematicOverride: (o) => set({ schematicOverride: o }),
}))

// helper for non-hook updates
export const useDeviceStoreRef = useDeviceStore