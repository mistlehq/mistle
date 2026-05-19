/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  PayloadKindWebSocketText,
  decodeDataFrame,
  encodeDataFrame,
  parseStreamControlMessage,
} from "@mistle/sandbox-session-protocol";
import { TestEnvironmentIdHeader, createIntegrationTest } from "@mistle/test-harness/integration";
import { typeid } from "typeid-js";
import { expect } from "vitest";
import WebSocket from "ws";

import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  waitForWebSocketMessage,
} from "../integration/websocket-test-helpers.js";

const TestTimeoutMs = 60_000;
const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";
const ConnectionTokenSecret = "integration-new-connection-secret";
const ConnectionTokenIssuer = "integration-new-control-plane-api";

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
  __dangerouslyIsolatedServices: {
    reason: "This suite intentionally restarts the data-plane gateway runtime.",
    services: ["data-plane-gateway"],
  },
});

it(
  "keeps sandbox tunnel routing usable across a gateway restart",
  async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();

    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: sandboxInstanceId,
      organizationId: "org_integration_new_gateway_restart",
      sandboxProfileId: "sbp_integration_new_gateway_restart",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: `provider-${sandboxInstanceId}`,
      status: SandboxInstanceStatuses.STARTING,
      startedByKind: "system",
      startedById: "workflow_integration_new_gateway_restart",
      source: "webhook",
    });

    const gatewayBaseUrl = env.dataPlaneGateway.hostBaseUrl;
    const websocketBaseUrl = createWebSocketBaseUrl(gatewayBaseUrl);

    await exerciseSandboxTunnel({
      environmentId: env.id,
      websocketBaseUrl,
      sandboxInstanceId,
      payload: "before-restart",
    });

    await env.dataPlaneGateway.restart();
    const healthResponse = await env.dataPlaneGateway.http.fetch("/__healthz");

    expect(healthResponse.ok).toBe(true);
    expect(env.dataPlaneGateway.hostBaseUrl).toBe(gatewayBaseUrl);

    await exerciseSandboxTunnel({
      environmentId: env.id,
      websocketBaseUrl,
      sandboxInstanceId,
      payload: "after-restart",
    });
  },
  TestTimeoutMs,
);

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}

async function exerciseSandboxTunnel(input: {
  environmentId: string;
  websocketBaseUrl: string;
  sandboxInstanceId: string;
  payload: string;
}): Promise<void> {
  const clientStreamId = 52;
  let bootstrapSocket: WebSocket | undefined;
  let clientSocket: WebSocket | undefined;

  try {
    const headers = {
      [TestEnvironmentIdHeader]: input.environmentId,
    };

    bootstrapSocket = await connectSandboxTunnelWebSocket({
      websocketBaseUrl: input.websocketBaseUrl,
      sandboxInstanceId: input.sandboxInstanceId,
      tokenKind: "bootstrap",
      headers,
      token: await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: BootstrapTokenSecret,
          tokenIssuer: BootstrapTokenIssuer,
          tokenAudience: GatewayTokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId: input.sandboxInstanceId,
        ttlSeconds: 120,
      }),
    });
    clientSocket = await connectSandboxTunnelWebSocket({
      websocketBaseUrl: input.websocketBaseUrl,
      sandboxInstanceId: input.sandboxInstanceId,
      tokenKind: "connect",
      headers,
      token: await mintConnectionToken({
        config: {
          connectionTokenSecret: ConnectionTokenSecret,
          tokenIssuer: ConnectionTokenIssuer,
          tokenAudience: GatewayTokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId: input.sandboxInstanceId,
        ttlSeconds: 120,
      }),
    });

    const forwardedOpenPromise = waitForWebSocketMessage(bootstrapSocket);
    await sendWebSocketMessage(
      clientSocket,
      JSON.stringify({
        type: "stream.open",
        streamId: clientStreamId,
        channel: {
          kind: "agent",
        },
      }),
    );
    const forwardedOpen = await forwardedOpenPromise;
    if (typeof forwardedOpen.data !== "string") {
      throw new Error("Expected forwarded stream.open to be text.");
    }

    expect(forwardedOpen.isBinary).toBe(false);
    expect(parseStreamControlMessage(forwardedOpen.data)).toEqual({
      type: "stream.open",
      streamId: 1,
      channel: {
        kind: "agent",
      },
    });

    const forwardedOpenOkPromise = waitForWebSocketMessage(clientSocket);
    await sendWebSocketMessage(
      bootstrapSocket,
      JSON.stringify({
        type: "stream.open.ok",
        streamId: 1,
      }),
    );
    const forwardedOpenOk = await forwardedOpenOkPromise;
    if (typeof forwardedOpenOk.data !== "string") {
      throw new Error("Expected forwarded stream.open.ok to be text.");
    }

    expect(forwardedOpenOk.isBinary).toBe(false);
    expect(parseStreamControlMessage(forwardedOpenOk.data)).toEqual({
      type: "stream.open.ok",
      streamId: clientStreamId,
    });

    const forwardedDataPromise = waitForWebSocketMessage(bootstrapSocket);
    await sendWebSocketMessage(
      clientSocket,
      Buffer.from(
        encodeDataFrame({
          streamId: clientStreamId,
          payloadKind: PayloadKindWebSocketText,
          payload: Buffer.from(input.payload, "utf8"),
        }),
      ),
    );
    const forwardedData = await forwardedDataPromise;
    if (typeof forwardedData.data === "string") {
      throw new Error("Expected forwarded stream data to be binary.");
    }

    const decodedFrame = decodeDataFrame(new Uint8Array(forwardedData.data));
    expect(forwardedData.isBinary).toBe(true);
    expect(decodedFrame.payloadKind).toBe(PayloadKindWebSocketText);
    expect(Buffer.from(decodedFrame.payload).toString("utf8")).toBe(input.payload);
  } finally {
    await closeIfOpen(clientSocket);
    await closeIfOpen(bootstrapSocket);
  }
}

async function closeIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}
