export type Timestamp = number;
export interface Measurement {
    value: number;
    uncertainty?: number;
    unit?: string;
    ts?: Timestamp;
}
export interface DeviceStatus {
    device_id: string;
    state: 'unknown' | 'nominal' | 'warning' | 'fault';
    measurements: {
        [metric: string]: Measurement;
    };
}
export type StatusUpdateMessage = DeviceStatus;
export type QECRequest = {
    job_id?: string;
    code: 'surface' | 'repetition' | 'custom';
    measurements: Array<{
        qubit: number;
        basis: 'X' | 'Z';
        round: number;
        value: 0 | 1;
        ts?: number;
    }>;
    params?: Record<string, any>;
};
export type QECResult = {
    job_id: string;
    status: 'queued' | 'running' | 'done' | 'error';
    corrections?: Array<{
        qubit: number;
        round: number;
        correction: 0 | 1;
    }>;
    statistics?: Record<string, any>;
    raw_decision?: any;
};
export type QECStatus = {
    job_id: string;
    status: 'queued' | 'running' | 'done' | 'error';
    progress?: number;
};
