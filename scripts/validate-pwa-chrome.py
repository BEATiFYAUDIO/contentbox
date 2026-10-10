#!/usr/bin/env python3
"""Validate the installed dashboard as a live Chrome app over CDP."""

import argparse
import base64
import hashlib
import json
import os
import socket
import struct
import time
import urllib.request
from urllib.parse import urlparse


def receive_exact(sock: socket.socket, length: int) -> bytes:
    data = b""
    while len(data) < length:
        chunk = sock.recv(length - len(data))
        if not chunk:
            raise RuntimeError("Chrome closed the DevTools WebSocket")
        data += chunk
    return data


def send_frame(sock: socket.socket, payload: bytes, opcode: int = 1) -> None:
    mask = os.urandom(4)
    length = len(payload)
    header = bytearray([0x80 | opcode])
    if length < 126:
        header.append(0x80 | length)
    elif length < 65536:
        header.append(0x80 | 126)
        header.extend(struct.pack("!H", length))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack("!Q", length))
    header.extend(mask)
    masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
    sock.sendall(bytes(header) + masked)


def receive_frame(sock: socket.socket) -> tuple[int, bytes]:
    first, second = receive_exact(sock, 2)
    opcode = first & 0x0F
    length = second & 0x7F
    if length == 126:
        length = struct.unpack("!H", receive_exact(sock, 2))[0]
    elif length == 127:
        length = struct.unpack("!Q", receive_exact(sock, 8))[0]
    mask = receive_exact(sock, 4) if second & 0x80 else b""
    payload = receive_exact(sock, length)
    if mask:
        payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
    return opcode, payload


def websocket_request_target(url: str) -> str:
    parsed = urlparse(url)
    return parsed.path + (f"?{parsed.query}" if parsed.query else "")


def connect_websocket(url: str) -> socket.socket:
    parsed = urlparse(url)
    sock = socket.create_connection((parsed.hostname, parsed.port or 80), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    target = websocket_request_target(url)
    request = (
        f"GET {target} HTTP/1.1\r\n"
        f"Host: {parsed.netloc}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Origin: http://{parsed.hostname}:{parsed.port or 80}\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    sock.sendall(request.encode())
    response = b""
    while b"\r\n\r\n" not in response:
        response += sock.recv(4096)
    headers = response.decode("latin-1").split("\r\n")
    if " 101 " not in headers[0]:
        raise RuntimeError(f"Chrome WebSocket upgrade failed: {headers[0]}")
    expected = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
    if not any(line.lower() == f"sec-websocket-accept: {expected}".lower() for line in headers[1:]):
        raise RuntimeError("Chrome WebSocket handshake returned the wrong accept key")
    return sock


def find_page(debug_port: int, expected_origin: str) -> dict:
    deadline = time.monotonic() + 30
    endpoint = f"http://127.0.0.1:{debug_port}/json"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(endpoint, timeout=2) as response:
                pages = json.load(response)
            for page in pages:
                if page.get("type") == "page" and str(page.get("url", "")).startswith(expected_origin):
                    return page
        except Exception:
            pass
        time.sleep(0.5)
    raise RuntimeError("Chrome did not expose the Certifyd dashboard page")


def evaluate(sock: socket.socket, expression: str) -> dict:
    request_id = 1
    send_frame(sock, json.dumps({
        "id": request_id,
        "method": "Runtime.evaluate",
        "params": {"expression": expression, "awaitPromise": True, "returnByValue": True},
    }).encode())
    while True:
        opcode, payload = receive_frame(sock)
        if opcode == 9:
            send_frame(sock, payload, opcode=10)
            continue
        if opcode != 1:
            continue
        message = json.loads(payload)
        if message.get("id") == request_id:
            if "error" in message or "exceptionDetails" in message.get("result", {}):
                raise RuntimeError(f"Chrome evaluation failed: {message}")
            return message["result"]["result"].get("value")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", required=True)
    parser.add_argument("--debug-port", type=int, required=True)
    args = parser.parse_args()
    origin = args.origin.rstrip("/")
    page = find_page(args.debug_port, origin)
    sock = connect_websocket(page["webSocketDebuggerUrl"])
    expression = r"""
(async () => {
  const waitUntil = async (predicate, label) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  await waitUntil(() => document.readyState === 'complete', 'document load');
  await waitUntil(() => navigator.serviceWorker && navigator.serviceWorker.getRegistration('/'), 'service worker registration');
  const registration = await navigator.serviceWorker.ready;
  await waitUntil(() => registration.active?.state === 'activated', 'active service worker');
  const manifestResponse = await fetch('/manifest.json', { cache: 'no-store' });
  const manifest = await manifestResponse.json();
  const healthResponse = await fetch('/health', { cache: 'no-store' });
  const htmlResponse = await fetch('/', { cache: 'no-store' });
  const workerResponse = await fetch('/service-worker.js', { cache: 'no-store' });
  const cacheNames = await caches.keys();
  return {
    location: location.origin,
    secureContext: isSecureContext,
    displayStandalone: matchMedia('(display-mode: standalone)').matches,
    manifestDisplay: manifest.display,
    manifestStartUrl: manifest.start_url,
    manifestScope: manifest.scope,
    workerActive: registration.active?.state === 'activated',
    cacheNames,
    healthStatus: healthResponse.status,
    htmlCacheControl: htmlResponse.headers.get('cache-control'),
    manifestCacheControl: manifestResponse.headers.get('cache-control'),
    workerCacheControl: workerResponse.headers.get('cache-control'),
  };
})()
"""
    try:
        result = evaluate(sock, expression)
    finally:
        sock.close()
    expected = {
        "location": origin,
        "secureContext": True,
        "displayStandalone": True,
        "manifestDisplay": "standalone",
        "manifestStartUrl": "/",
        "manifestScope": "/",
        "workerActive": True,
        "cacheNames": [],
        "healthStatus": 200,
        "htmlCacheControl": "no-store",
        "manifestCacheControl": "no-store",
        "workerCacheControl": "no-store",
    }
    if result != expected:
        raise RuntimeError(f"Chrome PWA validation mismatch\nexpected={expected}\nactual={result}")
    print(json.dumps(result, indent=2, sort_keys=True))
    print("Chrome PWA standalone/live-runtime validation=PASS")


if __name__ == "__main__":
    main()
