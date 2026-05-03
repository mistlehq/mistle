/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  parseStreamControlMessage,
  type StreamControlMessage,
} from "@mistle/sandbox-session-protocol";
import {
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";
import WebSocket from "ws";

import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  sendWebSocketPingAndExpectPong,
  waitForNoWebSocketMessage,
  waitForWebSocketMessage,
} from "../integration/websocket-test-helpers.js";

const TestTimeoutMs = 30_000;
const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";
const ConnectionTokenSecret = "integration-new-connection-secret";
const ConnectionTokenIssuer = "integration-new-control-plane-api";

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
});

describe.concurrent("sandbox tunnel session integration", () => {
  it(
    "forwards exec stream opens to the bootstrap peer and relays acknowledgements back to the client",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        clientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        const clientStreamId = 88;
        const forwardedOpen = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: clientStreamId,
            channel: {
              kind: "exec",
              command: "pwd",
            },
          }),
        );

        expect(parseStreamMessage((await forwardedOpen).data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "exec",
            command: "pwd",
          },
        });

        const forwardedOpenOk = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );

        expect(parseStreamMessage((await forwardedOpenOk).data)).toEqual({
          type: "stream.open.ok",
          streamId: clientStreamId,
        });
      } finally {
        await Promise.all([closeIfOpen(bootstrapSocket), closeIfOpen(clientSocket)]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "keeps the bootstrap peer connected after a connection peer disconnects",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let firstClientSocket: WebSocket | undefined;
      let secondClientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        firstClientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        const bootstrapNoMessage = waitForNoWebSocketMessage(bootstrapSocket);
        await closeWebSocket(firstClientSocket);
        firstClientSocket = undefined;
        await bootstrapNoMessage;

        await sendWebSocketPingAndExpectPong(
          bootstrapSocket,
          Buffer.from("bootstrap-still-open", "utf8"),
        );

        secondClientSocket = await connectConnectionSocket({ env, sandboxInstanceId });
        const forwardedOpen = waitForWebSocketMessage(bootstrapSocket);
        await sendWebSocketMessage(
          secondClientSocket,
          JSON.stringify({
            type: "stream.open",
            streamId: 44,
            channel: {
              kind: "agent",
            },
          }),
        );

        expect(parseStreamMessage((await forwardedOpen).data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });
      } finally {
        await Promise.all([
          closeIfOpen(bootstrapSocket),
          closeIfOpen(firstClientSocket),
          closeIfOpen(secondClientSocket),
        ]);
      }
    },
    TestTimeoutMs,
  );

  it(
    "resets active client streams when the bootstrap peer disconnects but keeps the client websocket open",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });

      let bootstrapSocket: WebSocket | undefined;
      let clientSocket: WebSocket | undefined;

      try {
        bootstrapSocket = await connectBootstrapSocket({ env, sandboxInstanceId });
        clientSocket = await connectConnectionSocket({ env, sandboxInstanceId });

        const clientStreamId = 77;
        const forwardedOpen = waitForWebSocketMessage(bootstrapSocket);
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

        expect(parseStreamMessage((await forwardedOpen).data)).toEqual({
          type: "stream.open",
          streamId: 1,
          channel: {
            kind: "agent",
          },
        });

        const forwardedOpenOk = waitForWebSocketMessage(clientSocket);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "stream.open.ok",
            streamId: 1,
          }),
        );
        expect(parseStreamMessage((await forwardedOpenOk).data)).toEqual({
          type: "stream.open.ok",
          streamId: clientStreamId,
        });

        const clientReset = waitForWebSocketMessage(clientSocket);
        await closeWebSocket(bootstrapSocket);
        bootstrapSocket = undefined;

        expect(parseStreamMessage((await clientReset).data)).toEqual({
          type: "stream.reset",
          streamId: clientStreamId,
          code: "bootstrap_disconnected",
          message:
            "Sandbox bootstrap tunnel disconnected and invalidated the active interactive stream.",
        });

        await sendWebSocketPingAndExpectPong(
          clientSocket,
          Buffer.from("client-still-open-after-bootstrap-disconnect", "utf8"),
        );
      } finally {
        await Promise.all([closeIfOpen(bootstrapSocket), closeIfOpen(clientSocket)]);
      }
    },
    TestTimeoutMs,
  );
});

async function insertSandboxInstanceRow(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_integration_new_tunnel_session",
    sandboxProfileId: "sbp_integration_new_tunnel_session",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_integration_new_tunnel_session",
    source: "webhook",
  });
}

async function connectBootstrapSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return await connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl),
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
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

async function connectConnectionSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return await connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl),
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
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

function parseStreamMessage(data: string | Buffer): StreamControlMessage {
  if (typeof data !== "string") {
    throw new Error("Expected websocket message data to be a string.");
  }

  const parsedMessage = parseStreamControlMessage(data);
  if (parsedMessage === undefined) {
    throw new Error("Expected websocket message payload to be a stream control message.");
  }

  return parsedMessage;
}

async function closeIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}
