/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended Vitest fixture created by the system test harness.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { createSystemTest } from "@mistle/test-harness/system";
import { afterAll, describe, expect } from "vitest";
import { type RawData, WebSocketServer } from "ws";
import { z } from "zod";

import {
  prepareCodexSandbox,
  runSandboxExecCommandInSandbox,
  stopSandboxInstance,
} from "../system/helpers/codex-sandbox.js";
import { createRuntimeCodexSandboxFixture } from "./helpers/runtime-codex-sandbox.js";

const SYSTEM_TEST_TIMEOUT_MS = 5 * 60_000;
const SANDBOXD_EGRESS_PROXY_URL = "http://127.0.0.1:38513";
const SANDBOXD_TRANSPARENT_EGRESS_PROXY_PORT = 38_514;
const SANDBOXD_EGRESS_PROXY_CA_BUNDLE_PATH = "/run/mistle/sandboxd/egress-proxy-ca-bundle.pem";
const HTTP_REQUEST_BODY = "phase4a-gateway-egress-http-smoke";
const TRANSPARENT_HTTP_REQUEST_BODY = "phase4c-transparent-gateway-egress-http-smoke";
const TRANSPARENT_TCP_REQUEST_BODY = "phase4d-transparent-opaque-tcp-smoke";
const WEBSOCKET_REQUEST_BODY = "phase4b-gateway-egress-websocket-smoke";
const SECURE_WEBSOCKET_REQUEST_BODY = "phase4b-gateway-egress-secure-websocket-smoke";
const TRANSPARENT_SECURE_WEBSOCKET_REQUEST_BODY =
  "phase4c-transparent-gateway-egress-secure-websocket-smoke";
const HTTPS_SMOKE_URL = "https://example.com/";
const SMOKE_MARKER = "MISTLE_GATEWAY_EGRESS_HTTP_AND_HTTPS_OK";
const WEBSOCKET_SMOKE_MARKER = "MISTLE_GATEWAY_EGRESS_WEBSOCKET_OK";
const SECURE_WEBSOCKET_SMOKE_MARKER = "MISTLE_GATEWAY_EGRESS_SECURE_WEBSOCKET_OK";
const TRANSPARENT_SMOKE_MARKER = "MISTLE_GATEWAY_EGRESS_TRANSPARENT_OK";
const execFileAsync = promisify(execFile);
const SecureUpstreamCertificates = await createTestTlsCertificates();

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

type TestTlsCertificates = {
  caCertificatePem: string;
  directory: string;
  serverCertificatePem: string;
  serverPrivateKeyPem: string;
};

afterAll(async () => {
  await rm(SecureUpstreamCertificates.directory, {
    force: true,
    recursive: true,
  });
});

const it = createSystemTest({
  extraInfra: ["mailpit"],
  sandbox: {
    provider: "docker",
  },
  dataPlaneGateway: {
    directEgress: {
      trustedCaCertificates: [SecureUpstreamCertificates.caCertificatePem],
    },
  },
});

describe("runtime system gateway egress HTTP smoke", () => {
  it(
    "forwards sandbox HTTP, HTTPS, WS, WSS, and opaque TCP traffic through the gateway tunnel",
    async ({ system }) => {
      const upstream = await startSimulatedHttpUpstream();
      const secureUpstream = await startSimulatedSecureWebsocketUpstream(
        SecureUpstreamCertificates,
      );
      const fixture = createRuntimeCodexSandboxFixture(system);
      let sandboxInstanceIdForCleanup: string | undefined;

      try {
        const { authenticatedSession, sandboxInstanceId } = await prepareCodexSandbox({
          fixture,
          email: "runtime-gateway-egress-http-smoke@example.com",
        });
        sandboxInstanceIdForCleanup = sandboxInstanceId;
        const upstreamUrl = new URL(upstream.gatewayReachableBaseUrl);
        const secureUpstreamUrl = new URL(secureUpstream.gatewayReachableBaseUrl);

        const result = await runSandboxExecCommandInSandbox({
          fixture,
          authenticatedSession,
          sandboxInstanceId,
          command: "sh",
          args: [
            "-lc",
            [
              "set -e",
              publicAccessHttpSmokeHelpers(),
              [
                "public_access_http_smoke",
                shellQuote("POST"),
                shellQuote(`${upstream.gatewayReachableBaseUrl}/echo?case=http`),
                shellQuote(HTTP_REQUEST_BODY),
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
              [
                `export TRANSPARENT_PROXY_PORT=${shellQuote(String(SANDBOXD_TRANSPARENT_EGRESS_PROXY_PORT))}`,
                `export TRANSPARENT_PROXY_CA_BUNDLE=${shellQuote(SANDBOXD_EGRESS_PROXY_CA_BUNDLE_PATH)}`,
                `export TRANSPARENT_HTTP_PORT=${shellQuote(upstreamUrl.port)}`,
                `export TRANSPARENT_SECURE_PORT=${shellQuote(secureUpstreamUrl.port)}`,
                `export TRANSPARENT_HTTP_URL=${shellQuote(`${upstream.gatewayReachableBaseUrl}/echo?case=transparent-http`)}`,
                `export TRANSPARENT_HTTPS_URL=${shellQuote(`${secureUpstream.gatewayReachableBaseUrl.replace(/^wss:/u, "https:")}/secure?case=transparent-https`)}`,
                `export TRANSPARENT_WSS_PATH=${shellQuote("/socket?case=transparent-wss")}`,
                `export TRUSTED_CA_CERT_PEM=${shellQuote(secureUpstream.caCertificatePem)}`,
                `export TRANSPARENT_HTTP_MESSAGE=${shellQuote(TRANSPARENT_HTTP_REQUEST_BODY)}`,
                `export TRANSPARENT_WSS_MESSAGE=${shellQuote(TRANSPARENT_SECURE_WEBSOCKET_REQUEST_BODY)}`,
                `export TRANSPARENT_TCP_MESSAGE=${shellQuote(TRANSPARENT_TCP_REQUEST_BODY)}`,
                "timeout 30 bash <<'BASH'",
                transparentGatewaySmokeScript(),
                "BASH",
              ].join("\n"),
              `printf '%s\\n' ${shellQuote(SMOKE_MARKER)}`,
              `printf '%s\\n' ${shellQuote(WEBSOCKET_SMOKE_MARKER)}`,
              `printf '%s\\n' ${shellQuote(SECURE_WEBSOCKET_SMOKE_MARKER)}`,
              `printf '%s\\n' ${shellQuote(TRANSPARENT_SMOKE_MARKER)}`,
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
        expect(upstream.requests).toHaveLength(2);
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
        expect(secureUpstream.websocketExchanges).toHaveLength(2);
        expect(secureUpstream.websocketExchanges[0]).toMatchObject({
          url: "/socket?case=wss",
          message: SECURE_WEBSOCKET_REQUEST_BODY,
        });
        expect(
          secureUpstream.websocketExchanges[0]?.headers["x-mistle-egress-grant"],
        ).toBeUndefined();
        expect(result.stdout).toContain(TRANSPARENT_SMOKE_MARKER);
        expect(upstream.requests[1]).toMatchObject({
          method: "POST",
          url: "/echo?case=transparent-http",
          body: TRANSPARENT_HTTP_REQUEST_BODY,
        });
        expect(upstream.requests[1]?.headers["x-mistle-egress-grant"]).toBeUndefined();
        expect(secureUpstream.requests).toHaveLength(1);
        expect(secureUpstream.requests[0]).toMatchObject({
          method: "GET",
          url: "/secure?case=transparent-https",
          body: "",
        });
        expect(secureUpstream.requests[0]?.headers["x-mistle-egress-grant"]).toBeUndefined();
        expect(result.stdout).toContain(
          `TRANSPARENT-WSS:echo:${TRANSPARENT_SECURE_WEBSOCKET_REQUEST_BODY}`,
        );
        expect(secureUpstream.websocketExchanges[1]).toMatchObject({
          url: "/socket?case=transparent-wss",
          message: TRANSPARENT_SECURE_WEBSOCKET_REQUEST_BODY,
        });
        expect(
          secureUpstream.websocketExchanges[1]?.headers["x-mistle-egress-grant"],
        ).toBeUndefined();
        expect(result.stdout).toContain(`TRANSPARENT-TCP:echo:${TRANSPARENT_TCP_REQUEST_BODY}`);
      } finally {
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
  const websocketServer = new WebSocketServer({ noServer: true });
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
    websocketServer.handleUpgrade(request, socket, Buffer.alloc(0), (websocket) => {
      websocket.once("message", (message) => {
        const messageText = rawWebSocketDataToString(message);
        websocketExchanges.push({
          url: request.url ?? "",
          headers: request.headers,
          message: messageText,
        });
        websocket.send(`echo:${messageText}`);
        websocket.close();
      });
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
    stop: async () => {
      websocketServer.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function startSimulatedSecureWebsocketUpstream(certificates: TestTlsCertificates): Promise<{
  caCertificatePem: string;
  gatewayReachableBaseUrl: string;
  requests: RecordedHttpRequest[];
  websocketExchanges: RecordedWebsocketExchange[];
  stop: () => Promise<void>;
}> {
  const requests: RecordedHttpRequest[] = [];
  const websocketExchanges: RecordedWebsocketExchange[] = [];
  const websocketServer = new WebSocketServer({ noServer: true });
  const server = https.createServer(
    {
      cert: certificates.serverCertificatePem,
      key: certificates.serverPrivateKeyPem,
    },
    (request, response) => {
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
    },
  );
  server.on("upgrade", (request, socket) => {
    websocketServer.handleUpgrade(request, socket, Buffer.alloc(0), (websocket) => {
      websocket.once("message", (message) => {
        const messageText = rawWebSocketDataToString(message);
        websocketExchanges.push({
          url: request.url ?? "",
          headers: request.headers,
          message: messageText,
        });
        websocket.send(`echo:${messageText}`);
        websocket.close();
      });
    });
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
    requests,
    websocketExchanges,
    stop: async () => {
      websocketServer.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

function rawWebSocketDataToString(data: RawData): string {
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
}

async function createTestTlsCertificates(): Promise<TestTlsCertificates> {
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

function publicAccessHttpSmokeHelpers(): string {
  return [
    "public_access_http_smoke() {",
    '  method="$1"',
    '  url="$2"',
    '  body="$3"',
    '  output_file="$(mktemp)"',
    '  status_file="$(mktemp)"',
    "  attempt=1",
    '  while [ "$attempt" -le 5 ]; do',
    [
      "    if curl",
      "--proxy",
      shellQuote(SANDBOXD_EGRESS_PROXY_URL),
      "--noproxy ''",
      "-sS",
      '-X "$method"',
      "-H 'content-type: text/plain'",
      '--data "$body"',
      '--output "$output_file"',
      "--write-out '%{http_code}'",
      '"$url" > "$status_file"; then',
    ].join(" "),
    '      status="$(cat "$status_file")"',
    '      if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then',
    '        cat "$output_file"',
    '        rm -f "$output_file" "$status_file"',
    "        return 0",
    "      fi",
    '      if [ "$status" != 502 ] && [ "$status" != 503 ] && [ "$status" != 504 ]; then',
    '        cat "$output_file" >&2',
    '        printf "public access HTTP smoke got non-retryable status %s for %s\\n" "$status" "$url" >&2',
    '        rm -f "$output_file" "$status_file"',
    "        return 22",
    "      fi",
    "    fi",
    '    if [ "$attempt" -eq 5 ]; then',
    '      cat "$output_file" >&2',
    '      status="$(cat "$status_file" 2>/dev/null || true)"',
    '      printf "public access HTTP smoke exhausted retries for %s with status %s\\n" "$url" "$status" >&2',
    '      rm -f "$output_file" "$status_file"',
    "      return 22",
    "    fi",
    '    sleep "$attempt"',
    '    attempt="$((attempt + 1))"',
    "  done",
    "}",
  ].join("\n");
}

function websocketProxySmokeScript(): string {
  return [
    "set -euo pipefail",
    websocketClientFrameFunction(),
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
    'WEBSOCKET_FRAME_MESSAGE="${WS_MESSAGE}" websocket_client_frame >&3',
    'frame_file="$(mktemp)"',
    "response_byte_count=$((7 + ${#WS_MESSAGE}))",
    'dd bs=1 count="${response_byte_count}" <&3 >"${frame_file}" 2>/dev/null',
    'grep -a "echo:${WS_MESSAGE}" "${frame_file}" >/dev/null || { printf \'unexpected websocket frame bytes:\\n\' >&2; od -An -tx1 "${frame_file}" >&2; exit 1; }',
    "printf 'WS:echo:%s\\n' \"${WS_MESSAGE}\"",
  ].join("\n");
}

function secureWebsocketProxySmokeScript(): string {
  return [
    "set -euo pipefail",
    websocketClientFrameFunction(),
    'proxy_authority="${WS_PROXY#http://}"',
    'proxy_host="${proxy_authority%%:*}"',
    'proxy_port="${proxy_authority##*:}"',
    'target_authority="${WSS_URL#wss://}"',
    'target_host_port="${target_authority%%/*}"',
    'target_path="/${target_authority#*/}"',
    'target_host="${target_host_port%%:*}"',
    'output_file="$(mktemp)"',
    'stderr_file="$(mktemp)"',
    "set +e",
    "{",
    '  printf \'GET %s HTTP/1.1\\r\\nHost: %s\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n\' "${target_path}" "${target_host_port}"',
    "  sleep 0.2",
    '  WEBSOCKET_FRAME_MESSAGE="${WSS_MESSAGE}" websocket_client_frame',
    '} | openssl s_client -proxy "${proxy_host}:${proxy_port}" -connect "${target_host_port}" -servername "${target_host}" -quiet >"${output_file}" 2>"${stderr_file}"',
    'openssl_exit="$?"',
    "set -e",
    "dump_wss_debug() {",
    '  printf "openssl s_client exit code: %s\\n" "${openssl_exit}" >&2',
    "  printf 'WSS stdout bytes:\\n' >&2",
    '  cat "${output_file}" >&2',
    "  printf '\\nWSS stderr bytes:\\n' >&2",
    '  cat "${stderr_file}" >&2',
    "}",
    "grep -a 'HTTP/1.1 101' \"${output_file}\" >/dev/null || { printf 'unexpected WSS response bytes\\n' >&2; dump_wss_debug; exit 1; }",
    'grep -a "echo:${WSS_MESSAGE}" "${output_file}" >/dev/null || { printf \'unexpected WSS echo bytes\\n\' >&2; dump_wss_debug; exit 1; }',
    "printf 'WSS:echo:%s\\n' \"${WSS_MESSAGE}\"",
  ].join("\n");
}

function transparentGatewaySmokeScript(): string {
  return [
    "set -euo pipefail",
    websocketClientFrameFunction(),
    'tcp_port_file="$(mktemp)"',
    "perl -MIO::Socket::INET - \"${tcp_port_file}\" <<'PERL' &",
    "use strict;",
    "use warnings;",
    "",
    "my $port_file = $ARGV[0];",
    "my $server = IO::Socket::INET->new(",
    "  LocalAddr => '127.0.0.1',",
    "  LocalPort => 0,",
    "  Proto => 'tcp',",
    "  Listen => 1,",
    "  Reuse => 1,",
    ') or die "failed to start TCP smoke server: $!";',
    "open(my $handle, '>', $port_file) or die \"failed to write TCP smoke port file: $!\";",
    "print $handle $server->sockport;",
    "close($handle);",
    "for my $connection_index (1..2) {",
    '  my $client = $server->accept() or die "failed to accept TCP smoke client: $!";',
    "  my $payload = '';",
    "  $client->recv($payload, 65536);",
    '  print $client "echo:$payload";',
    "  close($client);",
    "}",
    "close($server);",
    "PERL",
    'tcp_server_pid="$!"',
    "cleanup_transparent_rules() {",
    "  nft delete table ip mistle_transparent_smoke 2>/dev/null || true",
    "}",
    "cleanup_transparent_smoke() {",
    "  cleanup_transparent_rules",
    '  kill "${tcp_server_pid}" 2>/dev/null || true',
    '  rm -f "${trusted_ca_file:-}"',
    "}",
    "trap cleanup_transparent_smoke EXIT",
    'trusted_ca_file="$(mktemp)"',
    'printf "%s\\n" "${TRUSTED_CA_CERT_PEM}" >"${trusted_ca_file}"',
    'while [ ! -s "${tcp_port_file}" ]; do sleep 0.05; done',
    'TRANSPARENT_TCP_PORT="$(cat "${tcp_port_file}")"',
    "cleanup_transparent_rules",
    'exec 4<>"/dev/tcp/127.0.0.1/${TRANSPARENT_TCP_PORT}"',
    'printf "direct:%s" "${TRANSPARENT_TCP_MESSAGE}" >&4',
    "direct_tcp_response_byte_count=$((12 + ${#TRANSPARENT_TCP_MESSAGE}))",
    'direct_tcp_response=""',
    'IFS= read -r -N "${direct_tcp_response_byte_count}" direct_tcp_response <&4 || { printf \'direct TCP read failed after receiving: %s\\n\' "${direct_tcp_response}" >&2; exit 1; }',
    '[ "${direct_tcp_response}" = "echo:direct:${TRANSPARENT_TCP_MESSAGE}" ] || { printf \'unexpected direct TCP response: %s\\n\' "${direct_tcp_response}" >&2; exit 1; }',
    "exec 4<&-",
    "exec 4>&-",
    "nft add table ip mistle_transparent_smoke || { id >&2; grep Cap /proc/self/status >&2; exit 1; }",
    "nft 'add chain ip mistle_transparent_smoke output { type nat hook output priority -100; policy accept; }' || { id >&2; grep Cap /proc/self/status >&2; exit 1; }",
    'nft add rule ip mistle_transparent_smoke output meta mark "${TRANSPARENT_PROXY_PORT}" return || { id >&2; grep Cap /proc/self/status >&2; exit 1; }',
    'nft add rule ip mistle_transparent_smoke output ip daddr 127.0.0.1 tcp dport "${TRANSPARENT_HTTP_PORT}" redirect to :"${TRANSPARENT_PROXY_PORT}" || { id >&2; grep Cap /proc/self/status >&2; exit 1; }',
    'nft add rule ip mistle_transparent_smoke output ip daddr 127.0.0.1 tcp dport "${TRANSPARENT_SECURE_PORT}" redirect to :"${TRANSPARENT_PROXY_PORT}" || { id >&2; grep Cap /proc/self/status >&2; exit 1; }',
    'nft add rule ip mistle_transparent_smoke output ip daddr 127.0.0.1 tcp dport "${TRANSPARENT_TCP_PORT}" redirect to :"${TRANSPARENT_PROXY_PORT}" || { id >&2; grep Cap /proc/self/status >&2; exit 1; }',
    'ss -ltnp | grep -q ":${TRANSPARENT_PROXY_PORT} " || { printf "transparent proxy listener is not bound\\n" >&2; ss -ltnp >&2; nft list ruleset >&2; exit 1; }',
    "unset HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY http_proxy https_proxy all_proxy no_proxy",
    'curl -fsS -X POST -H "content-type: text/plain" --data "${TRANSPARENT_HTTP_MESSAGE}" "${TRANSPARENT_HTTP_URL}"',
    "printf '\\n'",
    'curl --cacert "${trusted_ca_file}" -fsS "${TRANSPARENT_HTTPS_URL}"',
    "printf '\\n'",
    'output_file="$(mktemp)"',
    'stderr_file="$(mktemp)"',
    "set +e",
    "{",
    '  printf \'GET %s HTTP/1.1\\r\\nHost: 127.0.0.1:%s\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n\' "${TRANSPARENT_WSS_PATH}" "${TRANSPARENT_SECURE_PORT}"',
    "  sleep 0.2",
    '  WEBSOCKET_FRAME_MESSAGE="${TRANSPARENT_WSS_MESSAGE}" websocket_client_frame',
    '} | openssl s_client -connect "127.0.0.1:${TRANSPARENT_SECURE_PORT}" -servername "127.0.0.1" -CAfile "${TRANSPARENT_PROXY_CA_BUNDLE}" -verify_return_error -quiet >"${output_file}" 2>"${stderr_file}"',
    'openssl_exit="$?"',
    "set -e",
    "dump_transparent_wss_debug() {",
    '  printf "openssl s_client exit code: %s\\n" "${openssl_exit}" >&2',
    "  printf 'transparent WSS stdout bytes:\\n' >&2",
    '  cat "${output_file}" >&2',
    "  printf '\\ntransparent WSS stderr bytes:\\n' >&2",
    '  cat "${stderr_file}" >&2',
    "}",
    "grep -a 'HTTP/1.1 101' \"${output_file}\" >/dev/null || { printf 'unexpected transparent WSS response bytes\\n' >&2; dump_transparent_wss_debug; exit 1; }",
    'grep -a "echo:${TRANSPARENT_WSS_MESSAGE}" "${output_file}" >/dev/null || { printf \'unexpected transparent WSS echo bytes\\n\' >&2; dump_transparent_wss_debug; exit 1; }',
    "printf 'TRANSPARENT-WSS:echo:%s\\n' \"${TRANSPARENT_WSS_MESSAGE}\"",
    'exec 5<>"/dev/tcp/127.0.0.1/${TRANSPARENT_TCP_PORT}"',
    'printf "%s" "${TRANSPARENT_TCP_MESSAGE}" >&5',
    "tcp_response_byte_count=$((5 + ${#TRANSPARENT_TCP_MESSAGE}))",
    'tcp_response=""',
    'IFS= read -r -N "${tcp_response_byte_count}" tcp_response <&5 || { printf \'transparent TCP read failed after receiving: %s\\n\' "${tcp_response}" >&2; exit 1; }',
    '[ "${tcp_response}" = "echo:${TRANSPARENT_TCP_MESSAGE}" ] || { printf \'unexpected transparent TCP response: %s\\n\' "${tcp_response}" >&2; exit 1; }',
    "printf 'TRANSPARENT-TCP:echo:%s\\n' \"${TRANSPARENT_TCP_MESSAGE}\"",
  ].join("\n");
}

function websocketClientFrameFunction(): string {
  return [
    "websocket_client_frame() {",
    "  perl -e '",
    "    use strict;",
    "    use warnings;",
    "    my $message = $ENV{WEBSOCKET_FRAME_MESSAGE};",
    '    die "missing WEBSOCKET_FRAME_MESSAGE" unless defined $message;',
    '    die "websocket smoke message is too long" if length($message) > 125;',
    "    my @mask = (0x11, 0x22, 0x33, 0x44);",
    '    print pack("C C C C C C", 0x81, 0x80 | length($message), @mask);',
    "    for my $index (0 .. length($message) - 1) {",
    "      print chr(ord(substr($message, $index, 1)) ^ $mask[$index % 4]);",
    "    }",
    "  '",
    "}",
  ].join("\n");
}
