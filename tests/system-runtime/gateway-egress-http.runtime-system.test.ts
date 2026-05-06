/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended Vitest fixture created by the system test harness.
 */

import { createHash } from "node:crypto";
import http from "node:http";

import { createSystemTest } from "@mistle/test-harness/system";
import { describe, expect } from "vitest";
import { z } from "zod";

import {
  prepareCodexSandbox,
  runSandboxExecCommandInSandbox,
  stopSandboxInstance,
} from "../system/helpers/codex-sandbox.js";
import { createRuntimeCodexSandboxFixture } from "./helpers/runtime-codex-sandbox.js";

const it = createSystemTest({
  extraInfra: ["mailpit"],
  sandbox: {
    provider: "docker",
  },
  gatewayProxy: true,
});

const SYSTEM_TEST_TIMEOUT_MS = 5 * 60_000;
const SANDBOXD_EGRESS_PROXY_URL = "http://127.0.0.1:38513";
const HTTP_REQUEST_BODY = "phase4a-gateway-egress-http-smoke";
const WEBSOCKET_REQUEST_BODY = "phase4b-gateway-egress-websocket-smoke";
const HTTPS_SMOKE_URL = "https://example.com/";
const SMOKE_MARKER = "MISTLE_GATEWAY_EGRESS_HTTP_AND_HTTPS_OK";
const WEBSOCKET_SMOKE_MARKER = "MISTLE_GATEWAY_EGRESS_WEBSOCKET_OK";

const HttpEchoResponseSchema = z
  .object({
    ok: z.literal(true),
    method: z.string(),
    url: z.string(),
    body: z.string(),
  })
  .strict();

type RecordedHttpRequest = {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
};

type RecordedWebsocketExchange = {
  url: string;
  headers: http.IncomingHttpHeaders;
  message: string;
};

describe("runtime system gateway egress HTTP smoke", () => {
  it(
    "forwards sandbox HTTP, HTTPS, and websocket proxy traffic through the gateway tunnel",
    async ({ system }) => {
      const upstream = await startSimulatedHttpUpstream();
      const fixture = createRuntimeCodexSandboxFixture(system);
      let sandboxInstanceIdForCleanup: string | undefined;

      try {
        const { authenticatedSession, sandboxInstanceId } = await prepareCodexSandbox({
          fixture,
          email: "runtime-gateway-egress-http-smoke@example.com",
        });
        sandboxInstanceIdForCleanup = sandboxInstanceId;

        const result = await runSandboxExecCommandInSandbox({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
          command: "sh",
          args: [
            "-lc",
            [
              "set -e",
              [
                "curl",
                "--proxy",
                shellQuote(SANDBOXD_EGRESS_PROXY_URL),
                "--noproxy ''",
                "-fsS",
                "-X POST",
                "-H 'content-type: text/plain'",
                `--data ${shellQuote(HTTP_REQUEST_BODY)}`,
                shellQuote(`${upstream.gatewayReachableBaseUrl}/echo?case=http`),
              ].join(" "),
              "printf '\\n'",
              [
                "curl",
                "--proxy",
                shellQuote(SANDBOXD_EGRESS_PROXY_URL),
                "--noproxy ''",
                "-k",
                "-fsS",
                shellQuote(HTTPS_SMOKE_URL),
                "| grep -q 'Example Domain'",
              ].join(" "),
              [
                `export WS_PROXY=${shellQuote(SANDBOXD_EGRESS_PROXY_URL)}`,
                `export WS_URL=${shellQuote(`${upstream.gatewayReachableBaseUrl.replace(/^http:/u, "ws:")}/socket?case=websocket`)}`,
                `export WS_MESSAGE=${shellQuote(WEBSOCKET_REQUEST_BODY)}`,
                "timeout 15 bash <<'BASH'",
                websocketProxySmokeScript(),
                "BASH",
              ].join("\n"),
              `printf '%s\\n' ${shellQuote(SMOKE_MARKER)}`,
              `printf '%s\\n' ${shellQuote(WEBSOCKET_SMOKE_MARKER)}`,
            ].join("\n"),
          ],
          timeoutMs: 90_000,
        });

        if (result.exitCode !== 0) {
          throw new Error(
            `Gateway egress smoke command failed with exit code ${String(result.exitCode)}. stdout=${result.stdout} stderr=${result.stderr}`,
          );
        }

        const response = parseHttpEchoResponse(result.stdout);
        expect(response).toEqual({
          ok: true,
          method: "POST",
          url: "/echo?case=http",
          body: HTTP_REQUEST_BODY,
        });
        expect(result.stdout).toContain(SMOKE_MARKER);
        expect(upstream.requests).toHaveLength(1);
        expect(upstream.requests[0]).toMatchObject({
          method: "POST",
          url: "/echo?case=http",
          body: HTTP_REQUEST_BODY,
        });
        expect(upstream.requests[0]?.headers["x-mistle-egress-grant"]).toBeUndefined();
        expect(result.stdout).toContain(`WS:echo:${WEBSOCKET_REQUEST_BODY}`);
        expect(result.stdout).toContain(WEBSOCKET_SMOKE_MARKER);
        expect(upstream.websocketExchanges).toHaveLength(1);
        expect(upstream.websocketExchanges[0]).toMatchObject({
          url: "/socket?case=websocket",
          message: WEBSOCKET_REQUEST_BODY,
        });
        expect(upstream.websocketExchanges[0]?.headers["x-mistle-egress-grant"]).toBeUndefined();
      } finally {
        if (sandboxInstanceIdForCleanup !== undefined) {
          await stopSandboxInstance({
            fixture,
            sandboxInstanceId: sandboxInstanceIdForCleanup,
          });
        }
        await upstream.stop();
      }
    },
    SYSTEM_TEST_TIMEOUT_MS,
  );
});

async function startSimulatedHttpUpstream(): Promise<{
  gatewayReachableBaseUrl: string;
  requests: RecordedHttpRequest[];
  websocketExchanges: RecordedWebsocketExchange[];
  stop: () => Promise<void>;
}> {
  const requests: RecordedHttpRequest[] = [];
  const websocketExchanges: RecordedWebsocketExchange[] = [];
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const recordedRequest = {
        method: request.method ?? "",
        url: request.url ?? "",
        headers: request.headers,
        body,
      };
      requests.push(recordedRequest);

      const responseBody = JSON.stringify({
        ok: true,
        method: recordedRequest.method,
        url: recordedRequest.url,
        body,
      });
      response.writeHead(200, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(responseBody).toString(),
      });
      response.end(responseBody);
    });
  });
  server.on("upgrade", (request, socket) => {
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "connection: Upgrade",
        "upgrade: websocket",
        `sec-websocket-accept: ${createWebsocketAcceptKey(key)}`,
        "\r\n",
      ].join("\r\n"),
    );

    socket.once("data", (chunk) => {
      const message = chunk.toString("utf8");
      websocketExchanges.push({
        url: request.url ?? "",
        headers: request.headers,
        message,
      });
      socket.end(`echo:${message}`);
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Simulated HTTP upstream did not expose a TCP listener address.");
  }

  return {
    gatewayReachableBaseUrl: `http://127.0.0.1:${String(address.port)}`,
    requests,
    websocketExchanges,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

function createWebsocketAcceptKey(key: string): string {
  return createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
}

function parseHttpEchoResponse(stdout: string): z.infer<typeof HttpEchoResponseSchema> {
  const responseLine = stdout
    .trim()
    .split("\n")
    .find((line) => line.startsWith("{"));
  if (responseLine === undefined) {
    throw new Error(
      `Gateway egress smoke command did not return an HTTP response. stdout=${stdout}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(responseLine);
  } catch (error) {
    throw new Error(
      `Gateway egress smoke command returned invalid HTTP JSON: ${error instanceof Error ? error.message : String(error)}. stdout=${stdout}`,
    );
  }

  return HttpEchoResponseSchema.parse(parsed);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function websocketProxySmokeScript(): string {
  return [
    "set -euo pipefail",
    'proxy_authority="${WS_PROXY#http://}"',
    'proxy_host="${proxy_authority%%:*}"',
    'proxy_port="${proxy_authority##*:}"',
    'target_authority="${WS_URL#ws://}"',
    'target_host="${target_authority%%/*}"',
    'exec 3<>"/dev/tcp/${proxy_host}/${proxy_port}"',
    'printf \'GET %s HTTP/1.1\\r\\nHost: %s\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n\' "${WS_URL}" "${target_host}" >&3',
    'response_head=""',
    "while IFS= read -r line <&3; do",
    "  response_head=\"${response_head}${line}\"$'\\n'",
    "  if [ \"${line}\" = $'\\r' ]; then",
    "    break",
    "  fi",
    "done",
    "printf '%s' \"${response_head}\" | grep -q 'HTTP/1.1 101' || { printf 'unexpected websocket response head:\\n%s\\nbody:\\n' \"${response_head}\" >&2; dd bs=1 count=256 <&3 >&2 2>/dev/null || true; exit 1; }",
    "printf '%s' \"${WS_MESSAGE}\" >&3",
    'frame_file="$(mktemp)"',
    "response_byte_count=$((5 + ${#WS_MESSAGE}))",
    'dd bs=1 count="${response_byte_count}" <&3 >"${frame_file}" 2>/dev/null',
    'grep -a "echo:${WS_MESSAGE}" "${frame_file}" >/dev/null || { printf \'unexpected websocket frame bytes:\\n\' >&2; od -An -tx1 "${frame_file}" >&2; exit 1; }',
    "printf 'WS:echo:%s\\n' \"${WS_MESSAGE}\"",
  ].join("\n");
}
