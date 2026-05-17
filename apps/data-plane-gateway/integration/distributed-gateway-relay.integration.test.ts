/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { parseStreamControlMessage } from "@mistle/sandbox-session-protocol";
import { TestEnvironmentIdHeader, createIntegrationTest } from "@mistle/test-harness/integration";
import { systemSleeper } from "@mistle/time";
import { typeid } from "typeid-js";
import { expect } from "vitest";
import WebSocket from "ws";

import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  waitForWebSocketMessage,
} from "./websocket-test-helpers.js";

const RelayMessageTimeoutMs = 10_000;
const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";
const ConnectionTokenSecret = "integration-new-connection-secret";
const ConnectionTokenIssuer = "integration-new-control-plane-api";
const FirstGatewayId = "data-plane-gateway-a";
const SecondGatewayId = "data-plane-gateway-b";

const it = createIntegrationTest({
  services: [
    "data-plane-api",
    { id: FirstGatewayId, service: "data-plane-gateway", mode: "runtime" },
    { id: SecondGatewayId, service: "data-plane-gateway", mode: "runtime" },
  ],
  extraInfra: ["nats"],
  __dangerouslyIsolatedServices: {
    reason: "This suite starts two gateway runtime instances for distributed relay coverage.",
    services: [FirstGatewayId, SecondGatewayId],
  },
  __serviceOptions: {
    dataPlaneGateway: {
      gatewayRelay: {
        backend: "nats",
        namePrefix: "mistle-integration",
      },
    },
  },
});

it("routes sandbox tunnel messages across two gateway instances through NATS", async ({ env }) => {
  const sandboxInstanceId = typeid("sbi").toString();

  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: sandboxInstanceId,
    organizationId: "org_integration_distributed_gateway_relay",
    sandboxProfileId: "sbp_integration_distributed_gateway_relay",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_integration_distributed_gateway_relay",
    source: "webhook",
  });

  const firstGateway = env.httpService(FirstGatewayId);
  const secondGateway = env.httpService(SecondGatewayId);
  const headers = {
    [TestEnvironmentIdHeader]: env.id,
  };
  let bootstrapSocket: WebSocket | undefined;
  let clientSocket: WebSocket | undefined;

  try {
    bootstrapSocket = await connectSandboxTunnelWebSocket({
      websocketBaseUrl: createWebSocketBaseUrl(firstGateway.hostBaseUrl),
      sandboxInstanceId,
      tokenKind: "bootstrap",
      headers,
      token: await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: BootstrapTokenSecret,
          tokenIssuer: BootstrapTokenIssuer,
          tokenAudience: GatewayTokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        ttlSeconds: 120,
      }),
    });
    clientSocket = await connectConnectionWebSocketWhenReady({
      headers,
      sandboxInstanceId,
      websocketBaseUrl: createWebSocketBaseUrl(secondGateway.hostBaseUrl),
    });

    const bootstrapMessagePromise = waitForWebSocketMessage(bootstrapSocket, {
      timeoutMs: RelayMessageTimeoutMs,
    });
    await sendWebSocketMessage(
      clientSocket,
      JSON.stringify({
        type: "stream.open",
        streamId: 42,
        channel: {
          kind: "agent",
        },
      }),
    );
    const bootstrapMessage = await bootstrapMessagePromise;
    if (typeof bootstrapMessage.data !== "string") {
      throw new Error("Expected bootstrap peer to receive a text stream.open message.");
    }

    expect(bootstrapMessage.isBinary).toBe(false);
    expect(parseStreamControlMessage(bootstrapMessage.data)).toEqual({
      type: "stream.open",
      streamId: 1,
      channel: {
        kind: "agent",
      },
    });

    const clientMessagePromise = waitForWebSocketMessage(clientSocket, {
      timeoutMs: RelayMessageTimeoutMs,
    });
    await sendWebSocketMessage(
      bootstrapSocket,
      JSON.stringify({
        type: "stream.open.ok",
        streamId: 1,
      }),
    );
    const clientMessage = await clientMessagePromise;
    if (typeof clientMessage.data !== "string") {
      throw new Error("Expected connection peer to receive a text stream.open.ok message.");
    }

    expect(clientMessage.isBinary).toBe(false);
    expect(parseStreamControlMessage(clientMessage.data)).toEqual({
      type: "stream.open.ok",
      streamId: 42,
    });
  } finally {
    await closeIfOpen(clientSocket);
    await closeIfOpen(bootstrapSocket);
  }
});

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}

async function connectConnectionWebSocketWhenReady(input: {
  headers: Record<string, string>;
  sandboxInstanceId: string;
  websocketBaseUrl: string;
}): Promise<WebSocket> {
  const deadlineMs = Date.now() + 8_000;
  let lastError: unknown;

  while (Date.now() < deadlineMs) {
    try {
      return await connectSandboxTunnelWebSocket({
        websocketBaseUrl: input.websocketBaseUrl,
        sandboxInstanceId: input.sandboxInstanceId,
        tokenKind: "connect",
        headers: input.headers,
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
    } catch (error) {
      lastError = error;
      await systemSleeper.sleep(100);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Timed out connecting sandbox tunnel websocket.");
}

async function closeIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}
