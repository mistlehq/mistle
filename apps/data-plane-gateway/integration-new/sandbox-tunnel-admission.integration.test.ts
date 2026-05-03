/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import {
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import { connectWebSocketExpectFailure } from "../integration/websocket-test-helpers.js";

const TestTimeoutMs = 30_000;
const ConnectionTokenSecret = "integration-new-connection-secret";
const ConnectionTokenIssuer = "integration-new-control-plane-api";
const GatewayTokenAudience = "integration-new-data-plane-gateway";

const it = createIntegrationTest({
  services: ["data-plane-gateway"],
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
