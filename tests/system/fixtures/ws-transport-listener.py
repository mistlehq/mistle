import base64
import hashlib
import socket
import struct
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer


port = int(sys.argv[1])
marker = sys.argv[2] if len(sys.argv) > 2 else "ws-transport-listener"


def encode_frame(opcode: int, payload: bytes, final: bool = True) -> bytes:
    if len(payload) >= 65536:
        raise ValueError("large websocket payloads are not supported in this fixture")

    first_byte = (0x80 if final else 0x00) | opcode
    if len(payload) < 126:
        return bytes([first_byte, len(payload)]) + payload

    return bytes([first_byte, 126]) + struct.pack(">H", len(payload)) + payload


def recv_exact(sock: socket.socket, length: int) -> bytes:
    chunks = []
    remaining = length
    while remaining > 0:
        chunk = sock.recv(remaining)
        if not chunk:
            raise ConnectionError("unexpected websocket EOF")
        chunks.append(chunk)
        remaining -= len(chunk)

    return b"".join(chunks)


def recv_frame(sock: socket.socket) -> tuple[int, bytes]:
    header = recv_exact(sock, 2)
    first_byte, second_byte = header[0], header[1]
    opcode = first_byte & 0x0F
    masked = (second_byte & 0x80) != 0
    if not masked:
        raise ValueError("client websocket frames must be masked")

    payload_length = second_byte & 0x7F
    if payload_length == 126:
        payload_length = struct.unpack(">H", recv_exact(sock, 2))[0]
    elif payload_length == 127:
        raise ValueError("64-bit websocket payload lengths are not supported in this fixture")

    mask = recv_exact(sock, 4)
    payload = bytearray(recv_exact(sock, payload_length))
    for index in range(payload_length):
        payload[index] ^= mask[index % 4]

    return opcode, bytes(payload)


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = marker.encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):
        return

    def handle_one_request(self):
        self.raw_requestline = self.rfile.readline(65537)
        if not self.raw_requestline:
            self.close_connection = True
            return
        if not self.parse_request():
            return

        if self.headers.get("Upgrade", "").lower() != "websocket":
            method_name = f"do_{self.command}"
            if not hasattr(self, method_name):
                self.send_error(501, f"Unsupported method ({self.command!r})")
                return
            getattr(self, method_name)()
            return

        websocket_key = self.headers.get("Sec-WebSocket-Key")
        if websocket_key is None:
            self.connection.close()
            return

        accept_value = base64.b64encode(
            hashlib.sha1(
                (websocket_key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("utf-8")
            ).digest()
        ).decode("utf-8")

        self.connection.sendall(
            (
                "HTTP/1.1 101 Switching Protocols\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Accept: {accept_value}\r\n"
                "\r\n"
            ).encode("utf-8")
        )

        if self.path == "/close-no-code":
            self.connection.sendall(encode_frame(0x8, b""))
            self.connection.close()
            return

        if self.path == "/fragmented-text":
            self.connection.sendall(encode_frame(0x1, b"frag", final=False))
            return

        if self.path == "/ping-from-upstream":
            self.connection.sendall(encode_frame(0x9, b"upstream-ping"))

        while True:
            opcode, payload = recv_frame(self.connection)
            if opcode in (0x1, 0x2):
                self.connection.sendall(encode_frame(opcode, payload))
                continue
            if opcode == 0x9:
                self.connection.sendall(encode_frame(0xA, payload))
                continue
            if opcode == 0xA:
                if self.path == "/ping-from-upstream":
                    self.connection.sendall(encode_frame(0x1, b"pong-ack"))
                continue
            if opcode == 0x8:
                self.connection.sendall(encode_frame(0x8, payload))
                self.connection.close()
                return

            self.connection.close()
            return


HTTPServer(("127.0.0.1", port), Handler).serve_forever()
