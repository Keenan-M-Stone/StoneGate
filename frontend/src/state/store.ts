import { create } from 'zustand'
import type { DeviceStatus } from '../../../shared/protocol/MessageTypes'

type DeviceEntry = DeviceStatus & { label?: string }

interface DeviceState {
  devices: Record<string, DeviceEntry>
  upsertDevice: (d: DeviceStatus) => void
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: {},
  upsertDevice: (d) => set(state => ({ devices: { ...state.devices, [d.device_id]: { ...d, label: state.devices[d.device_id]?.label ?? d.device_id } } }))
}))

// helper for non-hook updates
export const useDeviceStoreRef = useDeviceStore