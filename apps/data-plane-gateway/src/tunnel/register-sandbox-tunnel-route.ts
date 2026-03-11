import { randomUUID } from "node:crypto";

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
import type { WSMessageReceive } from "hono/ws";

import { logger } from "../logger.js";
import type { DataPlaneGatewayApp } from "../types.js";
import { insertSandboxTunnelConnectAck } from "./connect-ack.js";
import type { SandboxOwnerResolver } from "./ownership/sandbox-owner-resolver.js";
import type { SandboxOwnerStore } from "./ownership/sandbox-owner-store.js";
import type { TunnelRelayCoordinator } from "./relay-coordinator.js";
import type { RelayPeerSide, RelayTarget } from "./types.js";

const SandboxTunnelRoutePath = "/tunnel/sandbox/:instanceId";

type RegisterSandboxTunnelRouteInput = {
  app: DataPlaneGatewayApp;
  upgradeWebSocket: NodeWebSocket["upgradeWebSocket"];
  gatewayNodeId: string;
  bootstrapTokenConfig: BootstrapTokenConfig;
  connectionTokenConfig: ConnectionTokenConfig;
  relayCoordinator: TunnelRelayCoordinator;
  sandboxOwnerStore: SandboxOwnerStore;
  sandboxOwnerResolver: SandboxOwnerResolver;
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

const CloseCodes: {
  INTERNAL_ERROR: number;
} = {
  INTERNAL_ERROR: 1011,
};
const OwnerLeaseTtlMs = 30_000;

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
}): Promise<{ tokenKind: TokenKind; tokenJti: string; tokenSandboxInstanceId: string }> {
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
      tokenSandboxInstanceId: verificationResult.sandboxInstanceId,
    };
  }

  const verificationResult = await verifyConnectionToken({
    config: input.connectionTokenConfig,
    token: input.requestedToken.token,
  });
  return {
    tokenKind: "connection",
    tokenJti: verificationResult.jti,
    tokenSandboxInstanceId: verificationResult.sandboxInstanceId,
  };
}

function toForwardPayload(data: WSMessageReceive): string | ArrayBuffer | undefined {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return data;
  }

  return undefined;
}

function toSourcePeerSide(tokenKind: TokenKind): RelayPeerSide {
  return tokenKind;
}

export function registerSandboxTunnelRoute(input: RegisterSandboxTunnelRouteInput): void {
  input.app.get(
    SandboxTunnelRoutePath,
    async (ctx, next) => {
      if (ctx.req.header("upgrade")?.toLowerCase() !== "websocket") {
        return ctx.json({ error: "Sandbox tunnel endpoint requires websocket upgrade." }, 400);
      }
      const requestedInstanceId = ctx.req.param("instanceId").trim();
      if (requestedInstanceId.length === 0) {
        return ctx.json({ error: "Sandbox instance id path param is required." }, 400);
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
      let verifiedTokenSandboxInstanceId: string;
      try {
        const verificationResult = await verifyRequestedToken({
          requestedToken,
          bootstrapTokenConfig: input.bootstrapTokenConfig,
          connectionTokenConfig: input.connectionTokenConfig,
        });
        verifiedTokenJti = verificationResult.tokenJti;
        verifiedTokenKind = verificationResult.tokenKind;
        verifiedTokenSandboxInstanceId = verificationResult.tokenSandboxInstanceId;
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
            requestedInstanceId,
          },
          "Unexpected sandbox tunnel token verification failure",
        );
        return ctx.json({ error: "Sandbox tunnel token verification failed." }, 500);
      }

      if (verifiedTokenSandboxInstanceId !== requestedInstanceId) {
        return ctx.json(
          { error: "Sandbox tunnel token sandboxInstanceId claim does not match request path." },
          401,
        );
      }

      if (verifiedTokenKind === "connection") {
        const ownerResolution = await input.sandboxOwnerResolver.resolveOwner({
          sandboxInstanceId: requestedInstanceId,
        });
        if (ownerResolution.kind === "missing") {
          return ctx.json({ error: "Sandbox is not connected." }, 409);
        }
        if (ownerResolution.kind === "remote") {
          return ctx.json({ error: "Sandbox is connected to a different gateway node." }, 503);
        }
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

      if (verifiedTokenKind === "bootstrap") {
        const sandboxRelaySessionId = randomUUID();
        try {
          const owner = await input.sandboxOwnerStore.claimOwner({
            sandboxInstanceId: requestedInstanceId,
            nodeId: input.gatewayNodeId,
            sessionId: sandboxRelaySessionId,
            ttlMs: OwnerLeaseTtlMs,
          });
          ctx.set("sandboxRelaySessionId", sandboxRelaySessionId);
          ctx.set("sandboxOwnerLeaseId", owner.leaseId);
        } catch (error) {
          logger.error(
            {
              err: error,
              sandboxInstanceId: requestedInstanceId,
            },
            "Failed to claim sandbox ownership for bootstrap websocket",
          );
          return ctx.json({ error: "Failed to claim sandbox ownership." }, 500);
        }
      }

      await next();
    },
    input.upgradeWebSocket(
      (ctx) => {
        const requestedInstanceId = ctx.req.param("instanceId");
        if (requestedInstanceId === undefined) {
          throw new Error("Sandbox tunnel websocket request is missing instanceId path parameter.");
        }

        const sandboxInstanceId = requestedInstanceId.trim();
        const requestedToken = readRequestedTokenFromRequestUrl(new URL(ctx.req.url));
        if (requestedToken.kind !== "bootstrap" && requestedToken.kind !== "connection") {
          throw new Error("Expected validated sandbox tunnel websocket request token.");
        }

        const sourcePeerSide = toSourcePeerSide(requestedToken.kind);
        const bootstrapRelaySessionId =
          requestedToken.kind === "bootstrap" ? ctx.get("sandboxRelaySessionId") : undefined;
        const bootstrapOwnerLeaseId =
          requestedToken.kind === "bootstrap" ? ctx.get("sandboxOwnerLeaseId") : undefined;
        if (requestedToken.kind === "bootstrap" && bootstrapRelaySessionId === undefined) {
          throw new Error("Expected sandbox relay session id for bootstrap websocket request.");
        }
        if (requestedToken.kind === "bootstrap" && bootstrapOwnerLeaseId === undefined) {
          throw new Error("Expected sandbox owner lease id for bootstrap websocket request.");
        }
        let relayTarget: RelayTarget | undefined;

        return {
          onOpen: (_event, ws) => {
            relayTarget = input.relayCoordinator.attachPeer({
              sandboxInstanceId,
              side: sourcePeerSide,
              sessionId: bootstrapRelaySessionId,
              socket: ws,
            });
          },
          onMessage: (event, ws) => {
            if (relayTarget === undefined) {
              ws.close(
                CloseCodes.INTERNAL_ERROR,
                "Sandbox tunnel relay target was not initialized for websocket connection.",
              );
              return;
            }

            if (!input.relayCoordinator.isCurrentPeer(relayTarget)) {
              return;
            }

            const payload = toForwardPayload(event.data);
            if (payload === undefined) {
              ws.close(CloseCodes.INTERNAL_ERROR, "Unsupported websocket message type.");
              return;
            }

            void input.relayCoordinator
              .forwardPeerMessage({
                sandboxInstanceId,
                fromSide: sourcePeerSide,
                payload,
              })
              .catch((error: unknown) => {
                logger.error(
                  {
                    err: error,
                    instanceId: sandboxInstanceId,
                    sourceTokenKind: requestedToken.kind,
                  },
                  "Failed forwarding sandbox tunnel websocket message to peer",
                );
                ws.close(
                  CloseCodes.INTERNAL_ERROR,
                  "Failed forwarding websocket message to tunnel peer.",
                );
              });
          },
          onClose: () => {
            if (requestedToken.kind === "bootstrap" && bootstrapOwnerLeaseId !== undefined) {
              void input.sandboxOwnerStore.releaseOwner({
                sandboxInstanceId,
                leaseId: bootstrapOwnerLeaseId,
              });
            }
            if (relayTarget === undefined) {
              return;
            }
            input.relayCoordinator.detachPeer(relayTarget);
          },
        };
      },
      {
        onError: (error) => {
          logger.error(
            {
              err: error,
            },
            "Sandbox tunnel websocket error",
          );
        },
      },
    ),
  );
}
