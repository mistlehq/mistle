import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import {
  TunnelExchangeTokenError,
  type VerifiedTunnelExchangeToken,
  type TunnelExchangeTokenConfig,
  mintBootstrapToken,
  mintTunnelExchangeToken,
  type BootstrapTokenConfig,
  verifyTunnelExchangeToken,
} from "@mistle/gateway-tunnel-auth";

import { logger } from "../logger.js";
import type { DataPlaneGatewayApp } from "../types.js";

const SandboxTunnelTokenExchangeRoutePath = "/tunnel/sandbox/:instanceId/token-exchange";

type RegisterSandboxTunnelTokenExchangeRouteInput = {
  app: DataPlaneGatewayApp;
  bootstrapTokenConfig: BootstrapTokenConfig;
  tunnelExchangeTokenConfig: TunnelExchangeTokenConfig;
};

const EligibleSandboxInstanceStatuses = new Set<
  (typeof SandboxInstanceStatuses)[keyof typeof SandboxInstanceStatuses]
>([SandboxInstanceStatuses.STARTING, SandboxInstanceStatuses.RUNNING]);

function readBearerToken(authorizationHeader: string | undefined): string | undefined {
  const normalizedHeader = authorizationHeader?.trim();
  if (normalizedHeader === undefined || normalizedHeader.length === 0) {
    return undefined;
  }

  const bearerPrefixMatch = /^bearer\s+/iu.exec(normalizedHeader);
  if (bearerPrefixMatch === null) {
    return undefined;
  }

  const token = normalizedHeader.slice(bearerPrefixMatch[0].length).trim();
  if (token.length === 0) {
    return undefined;
  }

  return token;
}

export function registerSandboxTunnelTokenExchangeRoute(
  input: RegisterSandboxTunnelTokenExchangeRouteInput,
): void {
  input.app.post(SandboxTunnelTokenExchangeRoutePath, async (ctx) => {
    const requestedInstanceId = ctx.req.param("instanceId").trim();
    if (requestedInstanceId.length === 0) {
      return ctx.json({ error: "Sandbox instance id path param is required." }, 400);
    }

    const exchangeToken = readBearerToken(ctx.req.header("authorization"));
    if (exchangeToken === undefined) {
      return ctx.json({ error: "Tunnel exchange token bearer authorization is required." }, 401);
    }

    let verifiedExchangeToken: VerifiedTunnelExchangeToken;
    try {
      verifiedExchangeToken = await verifyTunnelExchangeToken({
        config: input.tunnelExchangeTokenConfig,
        token: exchangeToken,
      });
    } catch (error) {
      if (error instanceof TunnelExchangeTokenError) {
        return ctx.json({ error: error.message }, 401);
      }

      logger.error(
        {
          err: error,
          requestedInstanceId,
        },
        "Unexpected tunnel exchange token verification failure",
      );
      return ctx.json({ error: "Tunnel exchange token verification failed." }, 500);
    }

    if (verifiedExchangeToken.sandboxInstanceId !== requestedInstanceId) {
      return ctx.json(
        { error: "Tunnel exchange token sandboxInstanceId claim does not match request path." },
        401,
      );
    }

    const sandboxInstance = await ctx.get("db").query.sandboxInstances.findFirst({
      columns: {
        status: true,
      },
      where: (table, { eq }) => eq(table.id, requestedInstanceId),
    });
    if (sandboxInstance === undefined) {
      return ctx.json({ error: "Sandbox instance was not found." }, 404);
    }
    if (!EligibleSandboxInstanceStatuses.has(sandboxInstance.status)) {
      return ctx.json(
        { error: "Sandbox instance is not eligible for tunnel token exchange." },
        409,
      );
    }

    try {
      const [bootstrapToken, tunnelExchangeToken] = await Promise.all([
        mintBootstrapToken({
          config: input.bootstrapTokenConfig,
          jti: randomUUID(),
          sandboxInstanceId: requestedInstanceId,
          ttlSeconds: verifiedExchangeToken.bootstrapTokenTtlSeconds,
        }),
        mintTunnelExchangeToken({
          config: input.tunnelExchangeTokenConfig,
          jti: randomUUID(),
          sandboxInstanceId: requestedInstanceId,
          bootstrapTokenTtlSeconds: verifiedExchangeToken.bootstrapTokenTtlSeconds,
          exchangeTokenTtlSeconds: verifiedExchangeToken.exchangeTokenTtlSeconds,
          ttlSeconds: verifiedExchangeToken.exchangeTokenTtlSeconds,
        }),
      ]);

      return ctx.json(
        {
          bootstrapToken,
          tunnelExchangeToken,
        },
        200,
      );
    } catch (error) {
      logger.error(
        {
          err: error,
          sandboxInstanceId: requestedInstanceId,
        },
        "Failed to mint sandbox tunnel exchange response tokens",
      );
      return ctx.json({ error: "Failed to mint sandbox tunnel exchange response tokens." }, 500);
    }
  });
}
