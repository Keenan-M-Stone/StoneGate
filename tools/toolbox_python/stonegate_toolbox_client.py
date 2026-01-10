import argparse
import asyncio
import json
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Optional, List

import websockets


@dataclass
class RpcError(Exception):
    code: str
    message: str
    details: Any = None

    def __str__(self) -> str:
        base = f"{self.code}: {self.message}"
        if self.details is not None:
            return f"{base} ({self.details})"
        return base


class StoneGateToolboxClient:
    def __init__(self, ws_url: str):
        self.ws_url = ws_url
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._pending: Dict[str, asyncio.Future] = {}
        self._reader_task: Optional[asyncio.Task] = None

    async def connect(self) -> None:
        if self._ws is not None:
            return
        self._ws = await websockets.connect(self.ws_url)
        self._reader_task = asyncio.create_task(self._reader())

    async def close(self) -> None:
        if self._reader_task is not None:
            self._reader_task.cancel()
            self._reader_task = None
        if self._ws is not None:
            await self._ws.close()
            self._ws = None

    async def _reader(self) -> None:
        assert self._ws is not None
        async for raw in self._ws:
            try:
                msg = json.loads(raw)
            except Exception:
                continue

            if msg.get("type") != "rpc_result":
                continue

            rid = msg.get("id")
            if not rid:
                continue

            fut = self._pending.pop(rid, None)
            if fut is None or fut.done():
                continue
            fut.set_result(msg)

    async def call(self, method: str, params: Optional[Dict[str, Any]] = None, timeout_s: float = 10.0) -> Any:
        await self.connect()
        assert self._ws is not None

        rid = uuid.uuid4().hex
        req = {
            "type": "rpc",
            "id": rid,
            "method": method,
            "params": params or {},
        }

        loop = asyncio.get_running_loop()
        fut: asyncio.Future = loop.create_future()
        self._pending[rid] = fut

        await self._ws.send(json.dumps(req))

        try:
            resp = await asyncio.wait_for(fut, timeout=timeout_s)
        finally:
            self._pending.pop(rid, None)

        if not isinstance(resp, dict) or not resp.get("ok"):
            err = (resp or {}).get("error") or {}
            raise RpcError(
                code=str(err.get("code") or "error"),
                message=str(err.get("message") or "RPC failed"),
                details=err.get("details"),
            )
        return resp.get("result")


def load_recording_jsonl(path: str) -> Dict[str, Any]:
    """Load a StoneGate recording JSONL file.

    Returns a dict:
      {"header": {...}, "samples": [{...}, ...], "footer": {...}|None}
    """
    header: Optional[Dict[str, Any]] = None
    footer: Optional[Dict[str, Any]] = None
    samples: List[Dict[str, Any]] = []

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except Exception:
                continue
            t = obj.get("type")
            if t == "stonegate_recording" and header is None:
                header = obj
            elif t == "sample":
                samples.append(obj)
            elif t == "stop":
                footer = obj

    return {"header": header, "samples": samples, "footer": footer}


def _json_arg(s: str) -> Any:
    try:
        return json.loads(s)
    except Exception as e:
        raise argparse.ArgumentTypeError(f"Invalid JSON: {e}")


async def _run_cli(args: argparse.Namespace) -> int:
    client = StoneGateToolboxClient(args.ws)
    try:
        if args.cmd == "devices.list":
            out = await client.call("devices.list")
            print(json.dumps(out, indent=2))
            return 0

        if args.cmd == "devices.poll":
            out = await client.call("devices.poll")
            print(json.dumps(out, indent=2))
            return 0

        if args.cmd == "device.action":
            params = {"device_id": args.device_id, "action": args.action}
            out = await client.call("device.action", params)
            print(json.dumps(out, indent=2))
            return 0

        if args.cmd == "qec.decode":
            out = await client.call("qec.decode", args.params)
            print(json.dumps(out, indent=2))
            return 0

        if args.cmd == "record.start":
            out = await client.call(
                "record.start",
                {
                    "streams": args.streams,
                    "script_name": args.script_name or "",
                    "operator": args.operator or "",
                    "file_base": args.file_base or "recording",
                },
                timeout_s=args.timeout_s,
            )
            print(json.dumps(out, indent=2))
            return 0

        if args.cmd == "record.stop":
            out = await client.call("record.stop", {"recording_id": args.recording_id}, timeout_s=args.timeout_s)
            print(json.dumps(out, indent=2))
            return 0

        if args.cmd == "record.load":
            out = load_recording_jsonl(args.path)
            print(json.dumps(out, indent=2))
            return 0

        raise RpcError("bad_request", f"Unknown command: {args.cmd}")
    except RpcError as e:
        print(f"ERROR: {e}")
        return 2
    finally:
        await client.close()


def main() -> None:
    p = argparse.ArgumentParser(description="StoneGate toolbox RPC client")
    p.add_argument("--ws", default="ws://localhost:8080/status", help="WebSocket URL (default: ws://localhost:8080/status)")

    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("devices.list", help="List device descriptors")
    sub.add_parser("devices.poll", help="Poll all device measurements")

    act = sub.add_parser("device.action", help="Send a JSON action to a device")
    act.add_argument("device_id")
    act.add_argument("action", type=_json_arg, help='JSON object (example: {"set_flow_rate": 2.5})')

    qec = sub.add_parser("qec.decode", help="Run toy QEC decode (majority vote)")
    qec.add_argument("params", type=_json_arg, help="JSON object following QECRequest-ish shape")

    rec_start = sub.add_parser("record.start", help="Start a backend recorder session")
    rec_start.add_argument(
        "streams",
        type=_json_arg,
        help='JSON array of streams: [{"device_id":"dev","metrics":[...],"rate_hz":2.0}, ...] (metrics may be [])',
    )
    rec_start.add_argument("--script-name", default="", help="Script/macro name (stored in metadata)")
    rec_start.add_argument("--operator", default="", help="Operator name (stored in metadata)")
    rec_start.add_argument("--file-base", default="recording", help="Base filename (sanitized by backend)")
    rec_start.add_argument("--timeout-s", type=float, default=10.0, help="RPC timeout seconds")

    rec_stop = sub.add_parser("record.stop", help="Stop a backend recorder session")
    rec_stop.add_argument("recording_id")
    rec_stop.add_argument("--timeout-s", type=float, default=10.0, help="RPC timeout seconds")

    rec_load = sub.add_parser("record.load", help="Load a StoneGate recording JSONL file")
    rec_load.add_argument("path")

    args = p.parse_args()
    raise SystemExit(asyncio.run(_run_cli(args)))


if __name__ == "__main__":
    main()
