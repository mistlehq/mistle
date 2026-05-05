/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { typeid } from "typeid-js";
import { expect } from "vitest";
import WebSocket from "ws";

import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  waitForWebSocketMessage,
} from "../integration/websocket-test-helpers.js";

const TestTimeoutMs = 40_000;
const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";
const ConnectionTokenSecret = "integration-new-connection-secret";
const ConnectionTokenIssuer = "integration-new-control-plane-api";

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
});

it(
  "round-trips connection-side target authorization through the bootstrap websocket",
  async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      env,
      sandboxInstanceId,
    });

    const sockets = await connectBootstrapAndConnection({
      env,
      sandboxInstanceId,
    });

    try {
      await sendWebSocketMessage(
        sockets.connectionSocket,
        JSON.stringify({
          type: "ports.target.authorize",
          requestId: "req_connection_1",
          target: {
            kind: "port",
            port: 5173,
          },
        }),
      );

      const outboundMessage = await waitForWebSocketMessage(sockets.bootstrapSocket);
      expect(outboundMessage.isBinary).toBe(false);
      const bootstrapAuthorizeRequest = JSON.parse(String(outboundMessage.data));
      expect(bootstrapAuthorizeRequest).toEqual({
        type: "ports.target.authorize",
        requestId: expect.any(String),
        target: {
          kind: "port",
          port: 5173,
        },
      });
      expect(bootstrapAuthorizeRequest.requestId).not.toBe("req_connection_1");

      await sendWebSocketMessage(
        sockets.bootstrapSocket,
        JSON.stringify({
          type: "ports.target.authorize.result",
          requestId: bootstrapAuthorizeRequest.requestId,
          authorized: true,
          upstreamProtocol: "http",
          websocketCapable: true,
        }),
      );

      const connectionMessage = await waitForWebSocketMessage(sockets.connectionSocket);
      expect(connectionMessage.isBinary).toBe(false);
      expect(JSON.parse(String(connectionMessage.data))).toEqual({
        type: "ports.target.authorize.result",
        requestId: "req_connection_1",
        authorized: true,
        upstreamProtocol: "http",
        websocketCapable: true,
      });
    } finally {
      await closeIfOpen(sockets.connectionSocket);
      await closeIfOpen(sockets.bootstrapSocket);
    }
  },
  TestTimeoutMs,
);

it(
  "returns an explicit authorize failure to the connection when the bootstrap disconnects",
  async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      env,
      sandboxInstanceId,
    });

    const sockets = await connectBootstrapAndConnection({
      env,
      sandboxInstanceId,
    });

    try {
      await sendWebSocketMessage(
        sockets.connectionSocket,
        JSON.stringify({
          type: "ports.target.authorize",
          requestId: "req_disconnect",
          target: {
            kind: "port",
            port: 5173,
          },
        }),
      );

      const bootstrapAuthorizeRequest = JSON.parse(
        String((await waitForWebSocketMessage(sockets.bootstrapSocket)).data),
      );
      expect(bootstrapAuthorizeRequest).toEqual({
        type: "ports.target.authorize",
        requestId: expect.any(String),
        target: {
          kind: "port",
          port: 5173,
        },
      });
      expect(bootstrapAuthorizeRequest.requestId).not.toBe("req_disconnect");

      await closeWebSocket(sockets.bootstrapSocket);

      const connectionMessage = await waitForWebSocketMessage(sockets.connectionSocket);
      expect(connectionMessage.isBinary).toBe(false);
      expect(JSON.parse(String(connectionMessage.data))).toEqual({
        type: "ports.target.authorize.result",
        requestId: "req_disconnect",
        authorized: false,
        reason: "bootstrap_disconnected",
      });
    } finally {
      await closeIfOpen(sockets.connectionSocket);
      await closeIfOpen(sockets.bootstrapSocket);
    }
  },
  TestTimeoutMs,
);

async function insertSandboxInstanceRow(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_integration_new_ports_target_authorize",
    sandboxProfileId: "sbp_integration_new_ports_target_authorize",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_integration_new_ports_target_authorize",
    source: "webhook",
  });
}

async function connectBootstrapAndConnection(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<{
  bootstrapSocket: WebSocket;
  connectionSocket: WebSocket;
}> {
  const websocketBaseUrl = createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl);
  const headers = {
    [TestEnvironmentIdHeader]: input.env.id,
  };
  const bootstrapSocket = await connectSandboxTunnelWebSocket({
    websocketBaseUrl,
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "bootstrap",
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
    headers,
  });
  const connectionSocket = await connectSandboxTunnelWebSocket({
    websocketBaseUrl,
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "connect",
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
    headers,
  });

  return {
    bootstrapSocket,
    connectionSocket,
  };
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}

async function closeIfOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}
