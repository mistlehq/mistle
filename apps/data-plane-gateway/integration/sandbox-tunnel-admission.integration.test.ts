/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken as mintGatewayBootstrapToken } from "@mistle/gateway-tunnel-auth";
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
  connectWebSocketExpectFailure,
} from "../integration/websocket-test-helpers.js";

const TestTimeoutMs = 30_000;
const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const ConnectionTokenSecret = "integration-new-connection-secret";
const ConnectionTokenIssuer = "integration-new-control-plane-api";
const GatewayTokenAudience = "integration-new-data-plane-gateway";

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
});

describe.concurrent("sandbox tunnel websocket admission integration", () => {
  it(
    "rejects connection tokens when no bootstrap owner is connected and does not redeem the token",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const tokenJti = randomUUID();
      const failedConnect = await connectWithFailure({
        env,
        sandboxInstanceId,
        token: await mintConnectToken({
          sandboxInstanceId,
          jti: tokenJti,
        }),
      });

      expect(failedConnect.responseStatusCode).toBe(409);
      await expect(countTokenRedemptions({ env, tokenJti })).resolves.toBe(0);
    },
    TestTimeoutMs,
  );

  it(
    "rejects websocket upgrades that include both bootstrap and connection token query params",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const failedConnect = await connectWebSocketExpectFailure(
        `${createWebSocketBaseUrl(env.dataPlaneGateway.hostBaseUrl)}/tunnel/sandbox/${encodeURIComponent(
          sandboxInstanceId,
        )}?bootstrap_token=${encodeURIComponent("not-a-real-bootstrap-token")}&connect_token=${encodeURIComponent(
          await mintConnectToken({
            sandboxInstanceId,
            jti: randomUUID(),
          }),
        )}`,
        {
          headers: {
            [TestEnvironmentIdHeader]: env.id,
          },
        },
      );

      expect(failedConnect.responseStatusCode).toBe(400);
    },
    TestTimeoutMs,
  );

  it(
    "rejects connection tokens whose sandbox id claim does not match the request path",
    async ({ env }) => {
      const requestedSandboxInstanceId = typeid("sbi").toString();
      const tokenSandboxInstanceId = typeid("sbi").toString();
      const failedConnect = await connectWithFailure({
        env,
        sandboxInstanceId: requestedSandboxInstanceId,
        token: await mintConnectToken({
          sandboxInstanceId: tokenSandboxInstanceId,
          jti: randomUUID(),
        }),
      });

      expect(failedConnect.responseStatusCode).toBe(401);
    },
    TestTimeoutMs,
  );

  it(
    "rejects bootstrap token replay after the token has been redeemed",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });
      const tokenJti = randomUUID();
      const token = await mintBootstrapToken({
        sandboxInstanceId,
        jti: tokenJti,
      });
      const socket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
        token,
      });

      await closeWebSocket(socket);

      const failedConnect = await connectBootstrapWithFailure({
        env,
        sandboxInstanceId,
        token,
      });

      expect(failedConnect.responseStatusCode).toBe(409);
      await expect(countTokenRedemptions({ env, tokenJti })).resolves.toBe(1);
    },
    TestTimeoutMs,
  );

  it(
    "rejects connection token replay after the token has been redeemed",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({ env, sandboxInstanceId });
      const tokenJti = randomUUID();
      let bootstrapSocket: WebSocket | undefined;
      const connectionToken = await mintConnectToken({
        sandboxInstanceId,
        jti: tokenJti,
      });

      try {
        bootstrapSocket = await connectBootstrapSocket({
          env,
          sandboxInstanceId,
          token: await mintBootstrapToken({
            sandboxInstanceId,
            jti: randomUUID(),
          }),
        });
        const connectionSocket = await connectConnectionSocket({
          env,
          sandboxInstanceId,
          token: connectionToken,
        });

        await closeWebSocket(connectionSocket);

        const failedConnect = await connectWithFailure({
          env,
          sandboxInstanceId,
          token: connectionToken,
        });

        expect(failedConnect.responseStatusCode).toBe(409);
        await expect(countTokenRedemptions({ env, tokenJti })).resolves.toBe(1);
      } finally {
        if (bootstrapSocket !== undefined) {
          await closeWebSocket(bootstrapSocket);
        }
      }
    },
    TestTimeoutMs,
  );
});

function connectWithFailure(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  token: string;
}): ReturnType<typeof connectWebSocketExpectFailure> {
  return connectWebSocketExpectFailure(
    `${createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl)}/tunnel/sandbox/${encodeURIComponent(
      input.sandboxInstanceId,
    )}?connect_token=${encodeURIComponent(input.token)}`,
    {
      headers: {
        [TestEnvironmentIdHeader]: input.env.id,
      },
    },
  );
}

function connectBootstrapWithFailure(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  token: string;
}): ReturnType<typeof connectWebSocketExpectFailure> {
  return connectWebSocketExpectFailure(
    `${createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl)}/tunnel/sandbox/${encodeURIComponent(
      input.sandboxInstanceId,
    )}?bootstrap_token=${encodeURIComponent(input.token)}`,
    {
      headers: {
        [TestEnvironmentIdHeader]: input.env.id,
      },
    },
  );
}

function connectBootstrapSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  token: string;
}): Promise<WebSocket> {
  return connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl),
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "bootstrap",
    token: input.token,
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

function connectConnectionSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  token: string;
}): Promise<WebSocket> {
  return connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl),
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "connect",
    token: input.token,
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

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

function mintBootstrapToken(input: { sandboxInstanceId: string; jti: string }): Promise<string> {
  return mintGatewayBootstrapToken({
    config: {
      bootstrapTokenSecret: BootstrapTokenSecret,
      tokenIssuer: BootstrapTokenIssuer,
      tokenAudience: GatewayTokenAudience,
    },
    jti: input.jti,
    sandboxInstanceId: input.sandboxInstanceId,
    ttlSeconds: 120,
  });
}

function mintConnectToken(input: { sandboxInstanceId: string; jti: string }): Promise<string> {
  return mintConnectionToken({
    config: {
      connectionTokenSecret: ConnectionTokenSecret,
      tokenIssuer: ConnectionTokenIssuer,
      tokenAudience: GatewayTokenAudience,
    },
    jti: input.jti,
    sandboxInstanceId: input.sandboxInstanceId,
    ttlSeconds: 120,
  });
}

async function countTokenRedemptions(input: {
  env: IntegrationTestEnvironment;
  tokenJti: string;
}): Promise<number> {
  const rows = await input.env.dataPlaneDb.query.sandboxTunnelTokenRedemptions.findMany({
    columns: {
      tokenJti: true,
    },
    where: (table, { eq }) => eq(table.tokenJti, input.tokenJti),
  });

  return rows.length;
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}
