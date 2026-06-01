/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { connect, type Socket } from "node:net";

import { derivePortAccessHost } from "@mistle/port-access-auth";
import type { TestHttpResponse, TestServiceHandle } from "@mistle/test-harness";
import {
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { systemScheduler, type TimerHandle } from "@mistle/time";
import { typeid } from "typeid-js";
import { expect } from "vitest";

import {
  DirectEgressHttpRoutePath,
  DirectEgressWebSocketRoutePath,
} from "../src/egress/direct-egress-proxy-service.js";
import {
  PtyTransportTokenQueryParam,
  PtyTransportWebSocketRoutePath,
} from "../src/pty/pty-transport-service.js";
import {
  GatewayDrainingRejectionCode,
  GatewayDrainingRejectionMessage,
} from "../src/runtime/gateway-drain-admission.js";
import { connectWebSocketExpectFailure } from "./websocket-test-helpers.js";

const TestTimeoutMs = 40_000;
const RawSocketTimeoutMs = 4_000;
const PortAccessBaseDomain = "mistle.localhost";

const it = createIntegrationTest({
  services: ["data-plane-gateway"],
  __dangerouslyIsolatedServices: {
    reason: "This suite intentionally mutates the data-plane gateway runtime lifecycle state.",
    services: ["data-plane-gateway"],
  },
});

it(
  "rejects new long-lived gateway admissions after drain starts",
  async ({ env }) => {
    startGatewayDrain(env.service("data-plane-gateway"));

    await expectDrainedWebSocket({
      env,
      path: `/tunnel/sandbox/${encodeURIComponent(typeid("sbi").toString())}?bootstrap_token=not-a-token`,
    });
    await expectDrainedWebSocket({
      env,
      path: `${PtyTransportWebSocketRoutePath}?${PtyTransportTokenQueryParam}=not-a-token`,
    });
    await expectDrainedWebSocket({
      env,
      path: `${DirectEgressWebSocketRoutePath}?target=${encodeURIComponent("ws://127.0.0.1:65535/socket")}`,
    });

    const directHttpResponse = await env.dataPlaneGateway.http.fetch(
      `${DirectEgressHttpRoutePath}?target=${encodeURIComponent("http://127.0.0.1:65535/")}`,
    );
    await expectJsonDrainResponse(directHttpResponse);

    const portAccessHost = derivePortAccessHost({
      config: {
        baseDomain: PortAccessBaseDomain,
      },
      sandboxInstanceId: typeid("sbi").toString(),
      port: 5173,
    });
    const portAccessHttpResponse = await requestRawPortAccessHttp({
      env,
      host: portAccessHost,
    });
    expect(portAccessHttpResponse).toContain("HTTP/1.1 503 Service Unavailable");
    expect(portAccessHttpResponse).toContain(
      `${GatewayDrainingRejectionCode}: ${GatewayDrainingRejectionMessage}`,
    );

    const rawUpgradeResponse = await requestRawPortAccessUpgrade({
      env,
      host: portAccessHost,
    });
    expect(rawUpgradeResponse).toContain("HTTP/1.1 503 Service Unavailable");
    expect(rawUpgradeResponse).toContain(
      `${GatewayDrainingRejectionCode}: ${GatewayDrainingRejectionMessage}`,
    );
  },
  TestTimeoutMs,
);

function startGatewayDrain(service: TestServiceHandle): void {
  if (service.startDrain === undefined) {
    throw new Error("Expected data-plane gateway integration service to expose startDrain.");
  }

  service.startDrain();
}

async function expectDrainedWebSocket(input: {
  env: IntegrationTestEnvironment;
  path: string;
}): Promise<void> {
  const url = new URL(input.path, input.env.dataPlaneGateway.hostBaseUrl);
  url.protocol = "ws:";

  const result = await connectWebSocketExpectFailure(url.toString(), {
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });

  expect(result.responseStatusCode).toBe(503);
}

async function expectJsonDrainResponse(response: TestHttpResponse): Promise<void> {
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({
    error: GatewayDrainingRejectionCode,
    message: GatewayDrainingRejectionMessage,
  });
}

async function requestRawPortAccessUpgrade(input: {
  env: IntegrationTestEnvironment;
  host: string;
}): Promise<string> {
  const socket = await connectRawClient(input.env);
  try {
    socket.write(
      [
        "GET /socket HTTP/1.1",
        `Host: ${input.host}`,
        `${TestEnvironmentIdHeader}: ${input.env.id}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n"),
    );

    const response = await waitForSocketResponse(socket);
    return response.toString("utf8");
  } finally {
    socket.destroy();
  }
}

async function requestRawPortAccessHttp(input: {
  env: IntegrationTestEnvironment;
  host: string;
}): Promise<string> {
  const socket = await connectRawClient(input.env);
  try {
    socket.write(
      [
        "GET / HTTP/1.1",
        `Host: ${input.host}`,
        `${TestEnvironmentIdHeader}: ${input.env.id}`,
        "",
        "",
      ].join("\r\n"),
    );

    const response = await waitForSocketResponse(socket);
    return response.toString("utf8");
  } finally {
    socket.destroy();
  }
}

function connectRawClient(env: IntegrationTestEnvironment): Promise<Socket> {
  const baseUrl = new URL(env.dataPlaneGateway.hostBaseUrl);
  const port = Number.parseInt(baseUrl.port, 10);
  if (!Number.isInteger(port)) {
    throw new Error("Expected gateway base URL to include an integer port.");
  }

  return new Promise((resolve, reject) => {
    const socket = connect({
      host: baseUrl.hostname,
      port,
    });
    const cleanup = (): void => {
      socket.off("connect", onConnect);
      socket.off("error", onError);
    };
    const onConnect = (): void => {
      cleanup();
      resolve(socket);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    socket.once("connect", onConnect);
    socket.once("error", onError);
  });
}

function waitForSocketResponse(socket: Socket): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let timeoutHandle: TimerHandle | undefined;

  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      if (timeoutHandle !== undefined) {
        systemScheduler.cancel(timeoutHandle);
      }
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    };
    const onData = (chunk: Buffer): void => {
      chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      let responseComplete: boolean;
      try {
        responseComplete = hasCompleteHttpResponse(bytes);
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }

      if (responseComplete) {
        cleanup();
        resolve(bytes);
      }
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onClose = (): void => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };

    timeoutHandle = systemScheduler.schedule(() => {
      cleanup();
      reject(new Error("Timed out waiting for raw Port Access drain response."));
    }, RawSocketTimeoutMs);
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function hasCompleteHttpResponse(bytes: Buffer): boolean {
  const headerEndIndex = bytes.indexOf("\r\n\r\n");
  if (headerEndIndex === -1) {
    return false;
  }

  const headers = bytes.subarray(0, headerEndIndex).toString("latin1");
  const contentLength = readHttpContentLength(headers);
  if (contentLength === null) {
    return true;
  }

  return bytes.length >= headerEndIndex + 4 + contentLength;
}

function readHttpContentLength(headers: string): number | null {
  for (const line of headers.split("\r\n").slice(1)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const name = line.slice(0, separatorIndex).trim().toLowerCase();
    if (name !== "content-length") {
      continue;
    }

    const value = Number.parseInt(line.slice(separatorIndex + 1).trim(), 10);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Received invalid raw Port Access response Content-Length: ${line}`);
    }

    return value;
  }

  return null;
}
