/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import {
  mintTunnelExchangeToken,
  verifyBootstrapToken,
  verifyTunnelExchangeToken,
} from "@mistle/gateway-tunnel-auth";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";
import { z } from "zod";

const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";

const TokenExchangeResponseSchema = z
  .object({
    bootstrapToken: z.string().min(1),
    tunnelExchangeToken: z.string().min(1),
  })
  .strict();

const it = createIntegrationTest({
  services: ["data-plane-gateway"],
});

describe.concurrent("sandbox tunnel token exchange integration", () => {
  it("returns fresh bootstrap and exchange tokens for an eligible sandbox instance", async ({
    env,
  }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    const exchangeTokenJti = randomUUID();

    await insertSandboxInstanceRow(env, {
      sandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
    });

    const response = await postTunnelTokenExchange({
      env,
      sandboxInstanceId,
      exchangeToken: await mintExchangeToken({
        sandboxInstanceId,
        jti: exchangeTokenJti,
      }),
    });

    expect(response.status).toBe(200);
    const body = TokenExchangeResponseSchema.parse(await response.json());
    const verifiedBootstrapToken = await verifyBootstrapToken({
      config: bootstrapTokenConfig(),
      token: body.bootstrapToken,
    });
    const verifiedExchangeToken = await verifyTunnelExchangeToken({
      config: exchangeTokenConfig(),
      token: body.tunnelExchangeToken,
    });

    expect(verifiedBootstrapToken.sandboxInstanceId).toBe(sandboxInstanceId);
    expect(verifiedExchangeToken).toEqual({
      bootstrapTokenTtlSeconds: 120,
      exchangeTokenTtlSeconds: 3600,
      jti: verifiedExchangeToken.jti,
      sandboxInstanceId,
    });
    await expect(countRedemptions(env, exchangeTokenJti)).resolves.toBe(1);
  });

  it("rejects exchange token replay after the first successful redemption", async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    const exchangeTokenJti = randomUUID();
    const exchangeToken = await mintExchangeToken({
      sandboxInstanceId,
      jti: exchangeTokenJti,
    });

    await insertSandboxInstanceRow(env, {
      sandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
    });

    const firstResponse = await postTunnelTokenExchange({
      env,
      sandboxInstanceId,
      exchangeToken,
    });
    const secondResponse = await postTunnelTokenExchange({
      env,
      sandboxInstanceId,
      exchangeToken,
    });

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(409);
    await expect(secondResponse.json()).resolves.toEqual({
      error: "Tunnel exchange token has already been redeemed.",
    });
    await expect(countRedemptions(env, exchangeTokenJti)).resolves.toBe(1);
  });

  it("rejects exchange when authorization bearer token is missing", async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow(env, {
      sandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
    });

    const response = await postTunnelTokenExchange({
      env,
      sandboxInstanceId,
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Tunnel exchange token bearer authorization is required.",
    });
  });

  it("rejects exchange when the token sandbox id does not match the request path", async ({
    env,
  }) => {
    const requestedSandboxInstanceId = typeid("sbi").toString();
    const tokenSandboxInstanceId = typeid("sbi").toString();

    await insertSandboxInstanceRow(env, {
      sandboxInstanceId: requestedSandboxInstanceId,
      status: SandboxInstanceStatuses.RUNNING,
    });

    const response = await postTunnelTokenExchange({
      env,
      sandboxInstanceId: requestedSandboxInstanceId,
      exchangeToken: await mintExchangeToken({
        sandboxInstanceId: tokenSandboxInstanceId,
        jti: randomUUID(),
      }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Tunnel exchange token sandboxInstanceId claim does not match request path.",
    });
  });

  it("rejects exchange when the sandbox instance is not eligible", async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow(env, {
      sandboxInstanceId,
      status: SandboxInstanceStatuses.STOPPED,
    });

    const response = await postTunnelTokenExchange({
      env,
      sandboxInstanceId,
      exchangeToken: await mintExchangeToken({
        sandboxInstanceId,
        jti: randomUUID(),
      }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Sandbox instance is not eligible for tunnel token exchange.",
    });
  });
});

async function insertSandboxInstanceRow(
  env: IntegrationTestEnvironment,
  input: {
    sandboxInstanceId: string;
    status: (typeof SandboxInstanceStatuses)[keyof typeof SandboxInstanceStatuses];
  },
): Promise<void> {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_gateway_token_exchange",
    sandboxProfileId: "sbp_gateway_token_exchange",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: input.status,
    startedByKind: "system",
    startedById: "workflow_gateway_token_exchange",
    source: "webhook",
  });
}

function postTunnelTokenExchange(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  exchangeToken?: string;
}): Promise<Response> {
  return input.env.dataPlaneGateway.http.fetch(
    `/tunnel/sandbox/${encodeURIComponent(input.sandboxInstanceId)}/token-exchange`,
    {
      method: "POST",
      ...(input.exchangeToken === undefined
        ? {}
        : {
            headers: {
              authorization: `Bearer ${input.exchangeToken}`,
            },
          }),
    },
  );
}

function mintExchangeToken(input: { sandboxInstanceId: string; jti: string }): Promise<string> {
  return mintTunnelExchangeToken({
    config: exchangeTokenConfig(),
    jti: input.jti,
    sandboxInstanceId: input.sandboxInstanceId,
    bootstrapTokenTtlSeconds: 120,
    exchangeTokenTtlSeconds: 3600,
    ttlSeconds: 3600,
  });
}

function bootstrapTokenConfig() {
  return {
    bootstrapTokenSecret: BootstrapTokenSecret,
    tokenIssuer: BootstrapTokenIssuer,
    tokenAudience: GatewayTokenAudience,
  };
}

function exchangeTokenConfig() {
  return {
    tokenSecret: BootstrapTokenSecret,
    tokenIssuer: BootstrapTokenIssuer,
    tokenAudience: GatewayTokenAudience,
  };
}

async function countRedemptions(
  env: IntegrationTestEnvironment,
  tokenJti: string,
): Promise<number> {
  const rows = await env.dataPlaneDb.query.sandboxTunnelTokenRedemptions.findMany({
    columns: {
      tokenJti: true,
    },
    where: (table, { eq }) => eq(table.tokenJti, tokenJti),
  });

  return rows.length;
}
