const crypto = require("node:crypto");
const http = require("node:http");

const port = Number(process.argv[2]);
const marker = process.argv[3] ?? "ws-transport-listener";

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end(marker);
});

server.on("upgrade", (request, socket) => {
  const websocketKey = request.headers["sec-websocket-key"];
  if (typeof websocketKey !== "string") {
    socket.destroy();
    return;
  }

  const acceptValue = crypto
    .createHash("sha1")
    .update(`${websocketKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptValue}`,
      "",
      "",
    ].join("\r\n"),
  );

  if (request.url === "/close-no-code") {
    socket.write(encodeFrame(0x8, Buffer.alloc(0)));
    socket.end();
    return;
  }

  if (request.url === "/fragmented-text") {
    socket.write(encodeFrame(0x1, Buffer.from("frag"), { final: false }));
    return;
  }

  if (request.url === "/ping-from-upstream") {
    socket.write(encodeFrame(0x9, Buffer.from("upstream-ping")));
  }

  let buffered = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffered = Buffer.concat([buffered, chunk]);
    while (true) {
      const frame = tryDecodeFrame(buffered);
      if (frame === undefined) {
        return;
      }
      buffered = frame.remaining;

      switch (frame.opcode) {
        case 0x1:
        case 0x2: {
          socket.write(encodeFrame(frame.opcode, frame.payload));
          break;
        }
        case 0x9: {
          socket.write(encodeFrame(0xa, frame.payload));
          break;
        }
        case 0xa: {
          if (request.url === "/ping-from-upstream") {
            socket.write(encodeFrame(0x1, Buffer.from("pong-ack")));
          }
          break;
        }
        case 0x8: {
          socket.write(encodeFrame(0x8, frame.payload));
          socket.end();
          return;
        }
        default: {
          socket.destroy();
          return;
        }
      }
    }
  });
});

server.listen(port, "127.0.0.1");

function tryDecodeFrame(buffer) {
  if (buffer.length < 2) {
    return undefined;
  }

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const opcode = firstByte & 0x0f;
  let payloadLength = secondByte & 0x7f;
  const masked = (secondByte & 0x80) !== 0;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return undefined;
    }
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    throw new Error("64-bit websocket payload lengths are not supported in this fixture");
  }

  if (!masked) {
    throw new Error("client websocket frames must be masked");
  }

  if (buffer.length < offset + 4 + payloadLength) {
    return undefined;
  }

  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;

  const payload = Buffer.from(buffer.subarray(offset, offset + payloadLength));
  for (let index = 0; index < payload.length; index += 1) {
    payload[index] ^= mask[index % 4];
  }

  return {
    opcode,
    payload,
    remaining: buffer.subarray(offset + payloadLength),
  };
}

function encodeFrame(opcode, payload, options = {}) {
  const final = options.final ?? true;
  if (payload.length >= 65536) {
    throw new Error("large websocket payloads are not supported in this fixture");
  }

  const firstByte = (final ? 0x80 : 0x00) | opcode;

  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([firstByte, payload.length]), payload]);
  }

  const header = Buffer.alloc(4);
  header[0] = firstByte;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}
