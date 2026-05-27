/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import {
  PtyTransportTokenRoles,
  mintBootstrapToken,
  mintPtyTransportToken,
  verifyPtyTransportToken,
} from "@mistle/gateway-tunnel-auth";
import { parsePtySessionControlMessage } from "@mistle/sandbox-session-protocol";
import {
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { systemScheduler, type TimerHandle } from "@mistle/time";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";
import WebSocket from "ws";

import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  connectWebSocket,
  sendWebSocketMessage,
  waitForWebSocketMessage,
} from "../integration/websocket-test-helpers.js";
import {
  PtyTransportTokenQueryParam,
  PtyTransportWebSocketRoutePath,
} from "../src/pty/pty-transport-service.js";

const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";
const PtyTransportTokenSecret = "integration-new-pty-token-secret";
const PtyTransportTokenIssuer = "integration-new-data-plane-gateway";
const PtyTransportTokenAudience = "integration-new-gateway-pty";
const FirstGatewayId = "data-plane-gateway-a";
const SecondGatewayId = "data-plane-gateway-b";
const StepTimeoutMs = 5_000;
const TestTimeoutMs = 30_000;
const LargeDistributedPtyPayload = "distributed pty relay payload ".repeat(40_000);

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
});

const distributedIt = createIntegrationTest({
  services: [
    "data-plane-api",
    { id: FirstGatewayId, service: "data-plane-gateway", mode: "runtime" },
    { id: SecondGatewayId, service: "data-plane-gateway", mode: "runtime" },
  ],
  extraInfra: ["nats"],
  __dangerouslyIsolatedServices: {
    reason: "This suite starts two gateway runtime instances for direct PTY relay coverage.",
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

describe.concurrent("PTY transport integration", () => {
  it(
    "opens a sandbox-side PTY transport through bootstrap control and proxies websocket frames",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const ptySessionId = "pty_integration_session";
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
      });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const clientSocket = await connectPtyTransportSocket({
        env,
        token: await mintClientPtyToken({
          organizationId: `org_${sandboxInstanceId}`,
          ptySessionId,
          sandboxInstanceId,
        }),
      });

      let sandboxSocket: WebSocket | undefined;
      try {
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "pty.transport.open",
            launch: {
              session: "create",
              cols: 120,
              rows: 40,
              cwd: "/workspace/repo",
              command: "bash",
              args: ["-lc", "printf ready"],
            },
          }),
        );
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "stream.signal",
            streamId: 1,
            signal: {
              type: "pty.resize",
              cols: 121,
              rows: 41,
            },
          }),
        );

        const bootstrapMessage = parsePtySessionControlMessage(
          await waitForTextMessage({
            label: "waiting for pty.session.open",
            socket: bootstrapSocket,
          }),
        );
        if (bootstrapMessage?.type !== "pty.session.open") {
          throw new Error("Expected pty.session.open bootstrap control message.");
        }

        expect(bootstrapMessage).toEqual({
          type: "pty.session.open",
          requestId: expect.stringMatching(/^pty_/),
          ptySessionId,
          transportUrl: expect.stringContaining(PtyTransportWebSocketRoutePath),
          transportToken: expect.any(String),
          launch: {
            session: "create",
            cols: 120,
            rows: 40,
            cwd: "/workspace/repo",
            command: "bash",
            args: ["-lc", "printf ready"],
          },
        });
        const verifiedSandboxToken = await verifyPtyTransportToken({
          config: ptyTransportTokenConfig(),
          token: bootstrapMessage.transportToken,
        });
        expect(verifiedSandboxToken).toMatchObject({
          sub: sandboxInstanceId,
          organizationId: `org_${sandboxInstanceId}`,
          ptySessionId,
          role: PtyTransportTokenRoles.SANDBOX,
        });
        expect(
          new URL(bootstrapMessage.transportUrl).searchParams.get(PtyTransportTokenQueryParam),
        ).toBe(bootstrapMessage.transportToken);

        sandboxSocket = await connectWebSocket(bootstrapMessage.transportUrl);
        await sendWebSocketMessage(
          bootstrapSocket,
          JSON.stringify({
            type: "pty.session.opened",
            requestId: bootstrapMessage.requestId,
            ptySessionId,
          }),
        );
        await sendWebSocketMessage(clientSocket, "from-client");
        await expect(
          withTimeout({
            label: "waiting for sandbox-side PTY frame",
            promise: waitForWebSocketMessage(sandboxSocket),
          }),
        ).resolves.toMatchObject({
          data: "from-client",
          isBinary: false,
        });

        await sendWebSocketMessage(sandboxSocket, Buffer.from("from-sandbox", "utf8"));
        const clientMessage = await withTimeout({
          label: "waiting for client-side PTY frame",
          promise: waitForWebSocketMessage(clientSocket),
        });
        expect(clientMessage.isBinary).toBe(true);
        expect(Buffer.isBuffer(clientMessage.data) ? clientMessage.data.toString("utf8") : "").toBe(
          "from-sandbox",
        );
      } finally {
        await closeIfOpen(sandboxSocket);
        await closeIfOpen(clientSocket);
        await closeIfOpen(bootstrapSocket);
      }
    },
    TestTimeoutMs,
  );
});

describe.concurrent("distributed PTY transport integration", () => {
  distributedIt(
    "proxies PTY websocket frames when the client and sandbox sockets land on different gateway instances",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const ptySessionId = "pty_distributed_session";
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
      });
      const firstGateway = env.httpService(FirstGatewayId);
      const secondGateway = env.httpService(SecondGatewayId);
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        gatewayBaseUrl: secondGateway.hostBaseUrl,
        sandboxInstanceId,
      });
      const clientSocket = await connectPtyTransportSocket({
        env,
        gatewayBaseUrl: firstGateway.hostBaseUrl,
        token: await mintClientPtyToken({
          organizationId: `org_${sandboxInstanceId}`,
          ptySessionId,
          sandboxInstanceId,
        }),
      });

      let sandboxSocket: WebSocket | undefined;
      try {
        await sendWebSocketMessage(
          clientSocket,
          JSON.stringify({
            type: "pty.transport.open",
            launch: {
              session: "attach",
            },
          }),
        );

        const bootstrapMessage = parsePtySessionControlMessage(
          await waitForTextMessage({
            label: "waiting for distributed pty.session.open",
            socket: bootstrapSocket,
          }),
        );
        if (bootstrapMessage?.type !== "pty.session.open") {
          throw new Error("Expected distributed pty.session.open bootstrap control message.");
        }

        sandboxSocket = await connectPtyTransportSocket({
          env,
          gatewayBaseUrl: secondGateway.hostBaseUrl,
          token: bootstrapMessage.transportToken,
        });

        await sendWebSocketMessage(clientSocket, LargeDistributedPtyPayload);
        await expect(
          withTimeout({
            label: "waiting for distributed sandbox-side PTY frame",
            promise: waitForWebSocketMessage(sandboxSocket),
          }),
        ).resolves.toMatchObject({
          data: LargeDistributedPtyPayload,
          isBinary: false,
        });

        await sendWebSocketMessage(sandboxSocket, LargeDistributedPtyPayload);
        await expect(
          withTimeout({
            label: "waiting for distributed client-side PTY frame",
            promise: waitForWebSocketMessage(clientSocket),
          }),
        ).resolves.toMatchObject({
          data: LargeDistributedPtyPayload,
          isBinary: false,
        });
      } finally {
        await closeIfOpen(sandboxSocket);
        await closeIfOpen(clientSocket);
        await closeIfOpen(bootstrapSocket);
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
    organizationId: `org_${input.sandboxInstanceId}`,
    sandboxProfileId: `sbp_${input.sandboxInstanceId}`,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: `workflow_${input.sandboxInstanceId}`,
    source: "webhook",
  });
}

async function connectBootstrapSocket(input: {
  env: IntegrationTestEnvironment;
  gatewayBaseUrl?: string;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(
      input.gatewayBaseUrl ?? input.env.dataPlaneGateway.hostBaseUrl,
    ),
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "bootstrap",
    token: await mintBootstrapToken({
      config: {
        bootstrapTokenSecret: BootstrapTokenSecret,
        tokenIssuer: BootstrapTokenIssuer,
        tokenAudience: GatewayTokenAudience,
      },
      sandboxInstanceId: input.sandboxInstanceId,
      jti: randomUUID(),
      ttlSeconds: 300,
    }),
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

function connectPtyTransportSocket(input: {
  env: IntegrationTestEnvironment;
  gatewayBaseUrl?: string;
  token: string;
}): Promise<WebSocket> {
  return connectWebSocket(
    `${createWebSocketBaseUrl(
      input.gatewayBaseUrl ?? input.env.dataPlaneGateway.hostBaseUrl,
    )}${PtyTransportWebSocketRoutePath}?${PtyTransportTokenQueryParam}=${encodeURIComponent(input.token)}`,
    {
      headers: {
        [TestEnvironmentIdHeader]: input.env.id,
      },
    },
  );
}

async function mintClientPtyToken(input: {
  organizationId: string;
  ptySessionId: string;
  sandboxInstanceId: string;
}): Promise<string> {
  const minted = await mintPtyTransportToken({
    config: ptyTransportTokenConfig(),
    claims: {
      sub: input.sandboxInstanceId,
      organizationId: input.organizationId,
      ptySessionId: input.ptySessionId,
      role: PtyTransportTokenRoles.CLIENT,
      actingUserId: `usr_${input.sandboxInstanceId}`,
    },
    ttlSeconds: 300,
  });

  return minted.token;
}

function ptyTransportTokenConfig() {
  return {
    tokenSecret: PtyTransportTokenSecret,
    tokenIssuer: PtyTransportTokenIssuer,
    tokenAudience: PtyTransportTokenAudience,
  };
}

async function waitForTextMessage(input: { label: string; socket: WebSocket }): Promise<string> {
  const message = await withTimeout({
    label: input.label,
    promise: waitForWebSocketMessage(input.socket),
  });
  if (typeof message.data !== "string") {
    throw new Error(`${input.label} returned a binary websocket message.`);
  }

  return message.data;
}

function createWebSocketBaseUrl(hostBaseUrl: string): string {
  const url = new URL(hostBaseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString().replace(/\/$/, "");
}

function withTimeout<T>(input: { label: string; promise: Promise<T> }): Promise<T> {
  let timeoutHandle: TimerHandle | undefined;
  return new Promise<T>((resolve, reject) => {
    timeoutHandle = systemScheduler.schedule(() => {
      reject(new Error(`Timed out ${input.label}.`));
    }, StepTimeoutMs);

    input.promise.then(
      (value) => {
        if (timeoutHandle !== undefined) {
          systemScheduler.cancel(timeoutHandle);
        }
        resolve(value);
      },
      (error: unknown) => {
        if (timeoutHandle !== undefined) {
          systemScheduler.cancel(timeoutHandle);
        }
        reject(error);
      },
    );
  });
}

async function closeIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}
