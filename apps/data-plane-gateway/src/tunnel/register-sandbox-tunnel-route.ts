import type { NodeWebSocket } from "@hono/node-ws";
import {
  ConnectionTokenError,
  type ConnectionTokenConfig,
  verifyConnectionToken,
} from "@mistle/gateway-connection-auth";
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
  connectionTokenConfig: ConnectionTokenConfig;
};

type TokenKind = "bootstrap" | "connection";
type RequestedToken =
  | {
      kind: "missing";
    }
  | {
      kind: "ambiguous";
    }
  | {
      kind: TokenKind;
      token: string;
    };

function toNormalizedTokenValue(token: string | null): string | undefined {
  const normalizedToken = token?.trim();
  if (normalizedToken === undefined || normalizedToken.length === 0) {
    return undefined;
  }

  return normalizedToken;
}

function readRequestedTokenFromRequestUrl(url: URL): RequestedToken {
  const bootstrapToken = url.searchParams.get("bootstrap_token");
  const connectionToken = url.searchParams.get("connect_token");
  const normalizedBootstrapToken = toNormalizedTokenValue(bootstrapToken);
  const normalizedConnectionToken = toNormalizedTokenValue(connectionToken);

  if (normalizedBootstrapToken !== undefined && normalizedConnectionToken !== undefined) {
    return { kind: "ambiguous" };
  }

  if (normalizedBootstrapToken !== undefined) {
    return { kind: "bootstrap", token: normalizedBootstrapToken };
  }
  if (normalizedConnectionToken !== undefined) {
    return { kind: "connection", token: normalizedConnectionToken };
  }

  return { kind: "missing" };
}

async function verifyRequestedToken(input: {
  requestedToken: RequestedToken;
  bootstrapTokenConfig: BootstrapTokenConfig;
  connectionTokenConfig: ConnectionTokenConfig;
}): Promise<{ tokenKind: TokenKind; tokenJti: string }> {
  if (input.requestedToken.kind === "missing" || input.requestedToken.kind === "ambiguous") {
    throw new Error("Expected a token-bearing request.");
  }

  if (input.requestedToken.kind === "bootstrap") {
    const verificationResult = await verifyBootstrapToken({
      config: input.bootstrapTokenConfig,
      token: input.requestedToken.token,
    });
    return {
      tokenKind: "bootstrap",
      tokenJti: verificationResult.jti,
    };
  }

  const verificationResult = await verifyConnectionToken({
    config: input.connectionTokenConfig,
    token: input.requestedToken.token,
  });
  return {
    tokenKind: "connection",
    tokenJti: verificationResult.jti,
  };
}

export function registerSandboxTunnelRoute(input: RegisterSandboxTunnelRouteInput): void {
  input.app.get(
    SandboxTunnelRoutePath,
    async (ctx, next) => {
      if (ctx.req.header("upgrade")?.toLowerCase() !== "websocket") {
        return ctx.json({ error: "Sandbox tunnel endpoint requires websocket upgrade." }, 400);
      }

      const requestedToken = readRequestedTokenFromRequestUrl(new URL(ctx.req.url));
      if (requestedToken.kind === "missing") {
        return ctx.json({ error: "Sandbox auth token is required." }, 401);
      }
      if (requestedToken.kind === "ambiguous") {
        return ctx.json(
          {
            error:
              "Provide exactly one auth token query param: either 'bootstrap_token' or 'connect_token'.",
          },
          400,
        );
      }

      let verifiedTokenJti: string;
      let verifiedTokenKind: TokenKind;
      try {
        const verificationResult = await verifyRequestedToken({
          requestedToken,
          bootstrapTokenConfig: input.bootstrapTokenConfig,
          connectionTokenConfig: input.connectionTokenConfig,
        });
        verifiedTokenJti = verificationResult.tokenJti;
        verifiedTokenKind = verificationResult.tokenKind;
      } catch (error) {
        if (error instanceof BootstrapTokenError) {
          return ctx.json({ error: error.message }, 401);
        }
        if (error instanceof ConnectionTokenError) {
          return ctx.json({ error: error.message }, 401);
        }

        logger.error(
          {
            err: error,
            requestedTokenKind: requestedToken.kind,
          },
          "Unexpected sandbox tunnel token verification failure",
        );
        return ctx.json({ error: "Sandbox tunnel token verification failed." }, 500);
      }

      try {
        const inserted = await insertSandboxTunnelConnectAck({
          db: ctx.get("db"),
          tokenJti: verifiedTokenJti,
        });

        if (!inserted) {
          return ctx.json({ error: "Sandbox tunnel token has already been acknowledged." }, 409);
        }
      } catch (error) {
        logger.error(
          {
            err: error,
            tokenJti: verifiedTokenJti,
            tokenKind: verifiedTokenKind,
          },
          "Failed to persist sandbox tunnel token acknowledgement",
        );
        return ctx.json({ error: "Failed to acknowledge sandbox tunnel token." }, 500);
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
