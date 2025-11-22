declare class BackendClient {
    ws: WebSocket | null;
    connected: boolean;
    messagesSent: number;
    messagesReceived: number;
    connect(): void;
    disconnect(): void;
    send(obj: any): boolean;
    stats(): {
        endpoint: string;
        connected: boolean;
        sent: number;
        received: number;
    };
}
declare const Backend: BackendClient;
export default Backend;
