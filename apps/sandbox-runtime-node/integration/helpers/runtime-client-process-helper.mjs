import { createHash } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";

const mode = process.env.SANDBOX_RUNTIME_PROCESS_HELPER_MODE;
const port = Number.parseInt(process.env.SANDBOX_RUNTIME_PROCESS_HELPER_PORT ?? "", 10);
const delayMs = Number.parseInt(process.env.SANDBOX_RUNTIME_PROCESS_HELPER_DELAY_MS ?? "0", 10);
const statusCode = Number.parseInt(
  process.env.SANDBOX_RUNTIME_PROCESS_HELPER_STATUS_CODE ?? "200",
  10,
);

function requirePort() {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("helper port is required");
  }

  return port;
}

function websocketAcceptValue(key) {
  return createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
}

switch (mode) {
  case "tcp-listen": {
    const server = createNetServer((socket) => {
      socket.destroy();
    });
    server.listen(requirePort(), "127.0.0.1");
    break;
  }
  case "http-listen": {
    const server = createHttpServer((request, response) => {
      if (request.url === "/env") {
        response.statusCode = 200;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            setupValue: process.env.SETUP_VALUE,
            overriddenValue: process.env.OVERRIDDEN_VALUE,
            processOnlyValue: process.env.PROCESS_ONLY_VALUE,
          }),
        );
        return;
      }

      response.statusCode = statusCode;
      response.end("ready");
    });
    server.listen(requirePort(), "127.0.0.1");
    break;
  }
  case "ws-listen":
  case "ws-listen-close-now": {
    const server = createHttpServer();
    server.on("upgrade", (request, socket) => {
      const websocketKey = request.headers["sec-websocket-key"];
      if (typeof websocketKey !== "string") {
        socket.destroy();
        return;
      }

      socket.write(
        [
          "HTTP/1.1 101 Switching Protocols",
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Accept: ${websocketAcceptValue(websocketKey)}`,
          "",
          "",
        ].join("\r\n"),
      );

      if (mode === "ws-listen-close-now") {
        socket.destroy();
        return;
      }
    });
    server.listen(requirePort(), "127.0.0.1");
    break;
  }
  case "exit-immediately":
    process.exit(17);
    break;
  case "exit-after-delay":
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    process.exit(17);
    break;
  case "ignore-sigterm":
    process.on("SIGTERM", () => {});
    process.stdin.resume();
    break;
  default:
    throw new Error(`unsupported helper mode ${String(mode)}`);
}
