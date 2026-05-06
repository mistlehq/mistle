/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended Vitest fixture created by the system test harness.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { promisify } from "node:util";

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
const SECURE_WEBSOCKET_REQUEST_BODY = "phase4b-gateway-egress-secure-websocket-smoke";
const HTTPS_SMOKE_URL = "https://example.com/";
const SMOKE_MARKER = "MISTLE_GATEWAY_EGRESS_HTTP_AND_HTTPS_OK";
const WEBSOCKET_SMOKE_MARKER = "MISTLE_GATEWAY_EGRESS_WEBSOCKET_OK";
const SECURE_WEBSOCKET_SMOKE_MARKER = "MISTLE_GATEWAY_EGRESS_SECURE_WEBSOCKET_OK";
const execFileAsync = promisify(execFile);

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
    "forwards sandbox HTTP, HTTPS, WS, and WSS proxy traffic through the gateway tunnel",
    async ({ system }) => {
      const upstream = await startSimulatedHttpUpstream();
      const secureUpstream = await startSimulatedSecureWebsocketUpstream();
      const fixture = createRuntimeCodexSandboxFixture(system);
      let sandboxInstanceIdForCleanup: string | undefined;
      const previousGlobalAgentCa = https.globalAgent.options.ca;
      https.globalAgent.options.ca = [...tls.rootCertificates, secureUpstream.caCertificatePem];

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
              [
                `export WS_PROXY=${shellQuote(SANDBOXD_EGRESS_PROXY_URL)}`,
                `export WSS_URL=${shellQuote(`${secureUpstream.gatewayReachableBaseUrl}/socket?case=wss`)}`,
                `export WSS_MESSAGE=${shellQuote(SECURE_WEBSOCKET_REQUEST_BODY)}`,
                "timeout 15 bash <<'BASH'",
                secureWebsocketProxySmokeScript(),
                "BASH",
              ].join("\n"),
              `printf '%s\\n' ${shellQuote(SMOKE_MARKER)}`,
              `printf '%s\\n' ${shellQuote(WEBSOCKET_SMOKE_MARKER)}`,
              `printf '%s\\n' ${shellQuote(SECURE_WEBSOCKET_SMOKE_MARKER)}`,
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
        expect(result.stdout).toContain(`WSS:echo:${SECURE_WEBSOCKET_REQUEST_BODY}`);
        expect(result.stdout).toContain(SECURE_WEBSOCKET_SMOKE_MARKER);
        expect(secureUpstream.websocketExchanges).toHaveLength(1);
        expect(secureUpstream.websocketExchanges[0]).toMatchObject({
          url: "/socket?case=wss",
          message: SECURE_WEBSOCKET_REQUEST_BODY,
        });
        expect(
          secureUpstream.websocketExchanges[0]?.headers["x-mistle-egress-grant"],
        ).toBeUndefined();
      } finally {
        https.globalAgent.options.ca = previousGlobalAgentCa;
        if (sandboxInstanceIdForCleanup !== undefined) {
          await stopSandboxInstance({
            fixture,
            sandboxInstanceId: sandboxInstanceIdForCleanup,
          });
        }
        await upstream.stop();
        await secureUpstream.stop();
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
    handleWebsocketUpgrade(request, socket, websocketExchanges);
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

async function startSimulatedSecureWebsocketUpstream(): Promise<{
  caCertificatePem: string;
  gatewayReachableBaseUrl: string;
  websocketExchanges: RecordedWebsocketExchange[];
  stop: () => Promise<void>;
}> {
  const certificates = await createTestTlsCertificates();
  const websocketExchanges: RecordedWebsocketExchange[] = [];
  const server = https.createServer({
    cert: certificates.serverCertificatePem,
    key: certificates.serverPrivateKeyPem,
  });
  server.on("upgrade", (request, socket) => {
    handleWebsocketUpgrade(request, socket, websocketExchanges);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Simulated WSS upstream did not expose a TCP listener address.");
  }

  return {
    caCertificatePem: certificates.caCertificatePem,
    gatewayReachableBaseUrl: `wss://127.0.0.1:${String(address.port)}`,
    websocketExchanges,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await rm(certificates.directory, {
        force: true,
        recursive: true,
      });
    },
  };
}

async function createTestTlsCertificates(): Promise<{
  caCertificatePem: string;
  directory: string;
  serverCertificatePem: string;
  serverPrivateKeyPem: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "mistle-gateway-egress-wss-"));
  const caKeyPath = join(directory, "ca.key");
  const caCertificatePath = join(directory, "ca.crt");
  const serverKeyPath = join(directory, "server.key");
  const serverCertificatePath = join(directory, "server.crt");
  const serverCsrPath = join(directory, "server.csr");
  const serverConfigPath = join(directory, "server.conf");

  await writeFile(
    serverConfigPath,
    [
      "[req]",
      "distinguished_name=req_distinguished_name",
      "prompt=no",
      "[req_distinguished_name]",
      "CN=127.0.0.1",
      "[ext]",
      "subjectAltName=IP:127.0.0.1,DNS:localhost",
      "keyUsage=digitalSignature,keyEncipherment",
      "extendedKeyUsage=serverAuth",
      "",
    ].join("\n"),
  );

  await execFileAsync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=Mistle Gateway Egress Test CA",
    "-keyout",
    caKeyPath,
    "-out",
    caCertificatePath,
  ]);
  await execFileAsync("openssl", [
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    serverKeyPath,
    "-out",
    serverCsrPath,
    "-config",
    serverConfigPath,
  ]);
  await execFileAsync("openssl", [
    "x509",
    "-req",
    "-in",
    serverCsrPath,
    "-CA",
    caCertificatePath,
    "-CAkey",
    caKeyPath,
    "-CAcreateserial",
    "-out",
    serverCertificatePath,
    "-days",
    "1",
    "-sha256",
    "-extensions",
    "ext",
    "-extfile",
    serverConfigPath,
  ]);

  const caCertificatePem = await readFile(caCertificatePath, "utf8");
  const serverCertificatePem = await readFile(serverCertificatePath, "utf8");
  const serverPrivateKeyPem = await readFile(serverKeyPath, "utf8");

  return {
    caCertificatePem,
    directory,
    serverCertificatePem,
    serverPrivateKeyPem,
  };
}

function createWebsocketAcceptKey(key: string): string {
  return createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
}

function handleWebsocketUpgrade(
  request: http.IncomingMessage,
  socket: NodeJS.ReadWriteStream,
  websocketExchanges: RecordedWebsocketExchange[],
): void {
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
    const message = Buffer.from(chunk).toString("utf8");
    websocketExchanges.push({
      url: request.url ?? "",
      headers: request.headers,
      message,
    });
    socket.end(`echo:${message}`);
  });
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

function secureWebsocketProxySmokeScript(): string {
  return [
    "set -euo pipefail",
    'proxy_authority="${WS_PROXY#http://}"',
    'proxy_host="${proxy_authority%%:*}"',
    'proxy_port="${proxy_authority##*:}"',
    'target_authority="${WSS_URL#wss://}"',
    'target_host_port="${target_authority%%/*}"',
    'target_path="/${target_authority#*/}"',
    'target_host="${target_host_port%%:*}"',
    'output_file="$(mktemp)"',
    "{",
    '  printf \'GET %s HTTP/1.1\\r\\nHost: %s\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n\' "${target_path}" "${target_host_port}"',
    "  sleep 0.2",
    "  printf '%s' \"${WSS_MESSAGE}\"",
    '} | openssl s_client -proxy "${proxy_host}:${proxy_port}" -connect "${target_host_port}" -servername "${target_host}" -quiet >"${output_file}" 2>/dev/null',
    "grep -a 'HTTP/1.1 101' \"${output_file}\" >/dev/null || { printf 'unexpected WSS response bytes:\\n' >&2; cat \"${output_file}\" >&2; exit 1; }",
    'grep -a "echo:${WSS_MESSAGE}" "${output_file}" >/dev/null || { printf \'unexpected WSS echo bytes:\\n\' >&2; cat "${output_file}" >&2; exit 1; }',
    "printf 'WSS:echo:%s\\n' \"${WSS_MESSAGE}\"",
  ].join("\n");
}
