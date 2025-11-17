export type Timestamp = number // epoch ms


export interface Measurement {
    value: number
    uncertainty?: number
    unit?: string
    ts?: Timestamp
}


export interface DeviceStatus {
    device_id: string
    state: 'unknown' | 'nominal' | 'warning' | 'fault'
    measurements: { [metric: string]: Measurement }
}


export type StatusUpdateMessage = DeviceStatus