import type { DeviceStatus } from '../../../shared/protocol/MessageTypes';
export type ObservableMeta = {
    kind?: 'number' | 'integer' | 'boolean' | 'vector' | 'string';
    unit?: string;
    backend_unit?: string;
    min?: number;
    max?: number;
    soft_min?: number;
    soft_max?: number;
    precision?: number;
};
export type DeviceDescriptor = {
    id: string;
    type: string;
    status?: string;
    specs?: any;
    metrics?: Record<string, ObservableMeta>;
};
type DeviceEntry = DeviceStatus & {
    label?: string;
};
interface DeviceState {
    devices: Record<string, DeviceEntry>;
    descriptors: Record<string, DeviceDescriptor>;
    upsertDevice: (d: DeviceStatus) => void;
    upsertDescriptor: (d: DeviceDescriptor) => void;
}
export declare const useDeviceStore: import("zustand").UseBoundStore<import("zustand").StoreApi<DeviceState>>;
export declare const useDeviceStoreRef: import("zustand").UseBoundStore<import("zustand").StoreApi<DeviceState>>;
export {};
