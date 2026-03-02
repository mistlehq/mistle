import type { NodeWebSocket } from "@hono/node-ws";
import {
  BootstrapTokenError,
  type BootstrapTokenConfig,
  verifyBootstrapToken,
} from "@mistle/gateway-tunnel-auth";

import { logger } from "../logger.js";
import type { DataPlaneGatewayApp } from "../types.js";
import { insertSandboxTunnelConnectAck } from "./connect-ack.js";

const SandboxTunnelRoutePath = "/tunnel/sandbox";

type RegisterSandboxTunnelRouteInput = {
  app: DataPlaneGatewayApp;
  upgradeWebSocket: NodeWebSocket["upgradeWebSocket"];
  bootstrapTokenConfig: BootstrapTokenConfig;
};

function readBootstrapTokenFromRequestUrl(url: URL): string | undefined {
  const bootstrapToken = url.searchParams.get("bootstrap_token");
  const normalizedBootstrapToken = bootstrapToken?.trim();

  if (normalizedBootstrapToken === undefined || normalizedBootstrapToken.length === 0) {
    return undefined;
  }

  return normalizedBootstrapToken;
}

export function registerSandboxTunnelRoute(input: RegisterSandboxTunnelRouteInput): void {
  input.app.get(
    SandboxTunnelRoutePath,
    async (ctx, next) => {
      if (ctx.req.header("upgrade")?.toLowerCase() !== "websocket") {
        return ctx.json({ error: "Sandbox tunnel endpoint requires websocket upgrade." }, 400);
      }

      const bootstrapToken = readBootstrapTokenFromRequestUrl(new URL(ctx.req.url));
      if (bootstrapToken === undefined) {
        return ctx.json({ error: "Sandbox bootstrap token is required." }, 401);
      }

      let verifiedTokenJti: string;
      try {
        const verificationResult = await verifyBootstrapToken({
          config: input.bootstrapTokenConfig,
          token: bootstrapToken,
        });
        verifiedTokenJti = verificationResult.jti;
      } catch (error) {
        if (error instanceof BootstrapTokenError) {
          return ctx.json({ error: error.message }, 401);
        }

        logger.error(
          {
            err: error,
          },
          "Unexpected bootstrap token verification failure",
        );
        return ctx.json({ error: "Sandbox bootstrap token verification failed." }, 500);
      }

      try {
        const inserted = await insertSandboxTunnelConnectAck({
          db: ctx.get("db"),
          bootstrapTokenJti: verifiedTokenJti,
        });

        if (!inserted) {
          return ctx.json({ error: "Sandbox bootstrap token has already been acknowledged." }, 409);
        }
      } catch (error) {
        logger.error(
          {
            err: error,
            bootstrapTokenJti: verifiedTokenJti,
          },
          "Failed to persist sandbox tunnel bootstrap token acknowledgement",
        );
        return ctx.json({ error: "Failed to acknowledge sandbox bootstrap token." }, 500);
      }

      await next();
    },
    input.upgradeWebSocket(() => ({}), {
      onError: (error) => {
        logger.error(
          {
            err: error,
          },
          "Sandbox tunnel websocket error",
        );
      },
    }),
  );
}
