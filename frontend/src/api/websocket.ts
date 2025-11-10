export type WSMessage = {topic: string; payload: any};

export class ServerWS {
  ws: WebSocket | null = null;
  onMessage: ((m: WSMessage) => void) | null = null;

  connect(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onmessage = (e) => {
      const data: WSMessage = JSON.parse(e.data);
      this.onMessage && this.onMessage(data);
    };
  }

  send(topic: string, payload: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({topic, payload}));
  }
}