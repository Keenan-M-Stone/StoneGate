import type { DeviceStatus } from '../../../shared/protocol/MessageTypes';
type DeviceEntry = DeviceStatus & {
    label?: string;
};
interface DeviceState {
    devices: Record<string, DeviceEntry>;
    upsertDevice: (d: DeviceStatus) => void;
}
export declare const useDeviceStore: import("zustand").UseBoundStore<import("zustand").StoreApi<DeviceState>>;
export declare const useDeviceStoreRef: import("zustand").UseBoundStore<import("zustand").StoreApi<DeviceState>>;
export {};
