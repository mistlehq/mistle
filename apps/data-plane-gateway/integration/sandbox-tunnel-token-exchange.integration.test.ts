/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses, sandboxInstances } from "@mistle/db/data-plane";
import {
  mintTunnelExchangeToken,
  verifyBootstrapToken,
  verifyTunnelExchangeToken,
} from "@mistle/gateway-tunnel-auth";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";

const IntegrationTestTimeoutMs = 30_000;

function isTunnelTokenExchangeResponse(value: unknown): value is {
  bootstrapToken: string;
  tunnelExchangeToken: string;
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!("bootstrapToken" in value) || !("tunnelExchangeToken" in value)) {
    return false;
  }

  return typeof value.bootstrapToken === "string" && typeof value.tunnelExchangeToken === "string";
}

async function insertSandboxInstanceRow(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  status?: (typeof SandboxInstanceStatuses)[keyof typeof SandboxInstanceStatuses];
}): Promise<void> {
  await input.fixture.db.insert(sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_data_plane_gateway_integration",
    sandboxProfileId: "sbp_data_plane_gateway_integration",
    sandboxProfileVersion: 1,
    runtimeProvider: input.fixture.config.sandbox.provider,
    providerRuntimeId: `provider-${input.sandboxInstanceId}`,
    status: input.status ?? SandboxInstanceStatuses.RUNNING,
    startedByKind: "system",
    startedById: "workflow_data_plane_gateway_integration",
    source: "webhook",
    tunnelConnectedAt: null,
    lastTunnelSeenAt: null,
    tunnelDisconnectedAt: "2026-03-13T00:00:00.000Z",
  });
}

async function postTunnelTokenExchange(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  exchangeToken?: string;
}): Promise<Response> {
  const headers =
    input.exchangeToken === undefined
      ? undefined
      : ({
          Authorization: `Bearer ${input.exchangeToken}`,
        } satisfies HeadersInit);

  return fetch(
    `${input.fixture.baseUrl}/tunnel/sandbox/${encodeURIComponent(input.sandboxInstanceId)}/token-exchange`,
    {
      method: "POST",
      ...(headers === undefined ? {} : { headers }),
    },
  );
}

describe("sandbox tunnel token exchange endpoint integration", () => {
  it(
    "returns fresh bootstrap and exchange tokens for an eligible sandbox instance",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const exchangeTokenJti = randomUUID();
      const exchangeToken = await mintTunnelExchangeToken({
        config: {
          tokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: exchangeTokenJti,
        sandboxInstanceId,
        bootstrapTokenTtlSeconds: 120,
        exchangeTokenTtlSeconds: 3600,
        ttlSeconds: 3600,
      });

      const response = await postTunnelTokenExchange({
        fixture,
        sandboxInstanceId,
        exchangeToken,
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      if (!isTunnelTokenExchangeResponse(body)) {
        throw new Error("Tunnel token exchange response payload is invalid.");
      }

      const verifiedBootstrapToken = await verifyBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        token: body.bootstrapToken,
      });
      const verifiedExchangeToken = await verifyTunnelExchangeToken({
        config: {
          tokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        token: body.tunnelExchangeToken,
      });

      expect(verifiedBootstrapToken.sandboxInstanceId).toBe(sandboxInstanceId);
      expect(verifiedExchangeToken).toEqual({
        bootstrapTokenTtlSeconds: 120,
        exchangeTokenTtlSeconds: 3600,
        jti: verifiedExchangeToken.jti,
        sandboxInstanceId,
      });
      await expect(
        fixture.db.query.sandboxTunnelTokenRedemptions.findMany({
          where: (table, { eq }) => eq(table.tokenJti, exchangeTokenJti),
        }),
      ).resolves.toHaveLength(1);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects exchange token replay after the first successful redemption",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const exchangeTokenJti = randomUUID();
      const exchangeToken = await mintTunnelExchangeToken({
        config: {
          tokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: exchangeTokenJti,
        sandboxInstanceId,
        bootstrapTokenTtlSeconds: 120,
        exchangeTokenTtlSeconds: 3600,
        ttlSeconds: 3600,
      });

      const firstResponse = await postTunnelTokenExchange({
        fixture,
        sandboxInstanceId,
        exchangeToken,
      });
      const secondResponse = await postTunnelTokenExchange({
        fixture,
        sandboxInstanceId,
        exchangeToken,
      });

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(409);
      await expect(secondResponse.json()).resolves.toEqual({
        error: "Tunnel exchange token has already been redeemed.",
      });
      await expect(
        fixture.db.query.sandboxTunnelTokenRedemptions.findMany({
          where: (table, { eq }) => eq(table.tokenJti, exchangeTokenJti),
        }),
      ).resolves.toHaveLength(1);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects exchange when authorization bearer token is missing",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });

      const response = await postTunnelTokenExchange({
        fixture,
        sandboxInstanceId,
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "Tunnel exchange token bearer authorization is required.",
      });
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects exchange when the exchange token sandbox instance does not match the request path",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      const otherSandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId: otherSandboxInstanceId,
      });
      const exchangeToken = await mintTunnelExchangeToken({
        config: {
          tokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        bootstrapTokenTtlSeconds: 120,
        exchangeTokenTtlSeconds: 3600,
        ttlSeconds: 3600,
      });

      const response = await postTunnelTokenExchange({
        fixture,
        sandboxInstanceId: otherSandboxInstanceId,
        exchangeToken,
      });

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: "Tunnel exchange token sandboxInstanceId claim does not match request path.",
      });
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects exchange when the sandbox instance is not eligible",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
        status: SandboxInstanceStatuses.STOPPED,
      });
      const exchangeToken = await mintTunnelExchangeToken({
        config: {
          tokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        sandboxInstanceId,
        bootstrapTokenTtlSeconds: 120,
        exchangeTokenTtlSeconds: 3600,
        ttlSeconds: 3600,
      });

      const response = await postTunnelTokenExchange({
        fixture,
        sandboxInstanceId,
        exchangeToken,
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "Sandbox instance is not eligible for tunnel token exchange.",
      });
    },
    IntegrationTestTimeoutMs,
  );
});
