declare class BackendClient {
    ws: WebSocket | null;
    connected: boolean;
    messagesSent: number;
    messagesReceived: number;
    endpoint: string;
    private pendingRpc;
    setEndpoint(url: string): void;
    connect(): void;
    disconnect(): void;
    send(obj: any): boolean;
    rpc(method: string, params?: any, timeoutMs?: number): Promise<any>;
    stats(): {
        endpoint: string;
        connected: boolean;
        sent: number;
        received: number;
    };
}
declare const Backend: BackendClient;
export default Backend;
