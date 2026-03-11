import type { NodeWebSocket } from "@hono/node-ws";

import { logger } from "../logger.js";
import type { DataPlaneGatewayApp } from "../types.js";
import { verifyInternalForwardingHeaders } from "./internal-forwarding-auth.js";
import type { GatewayHttpForwarder, GatewayWebSocketForwarder } from "./types.js";

export const InternalGatewayHttpForwardRoutePath = "/__internal/forward/http/*";
export const InternalGatewayTunnelForwardRoutePath =
  "/__internal/forward/tunnel/sandbox/:instanceId";

function toPathSuffix(path: string): string {
  return path.startsWith("/__internal/forward/http/")
    ? path.slice("/__internal/forward/http".length)
    : path;
}

export function registerInternalGatewayForwardingRoutes(input: {
  app: DataPlaneGatewayApp;
  upgradeWebSocket: NodeWebSocket["upgradeWebSocket"];
  internalServiceToken: string;
  gatewayHttpForwarder: GatewayHttpForwarder;
  gatewayWebSocketForwarder: GatewayWebSocketForwarder;
}): void {
  input.app.all(InternalGatewayHttpForwardRoutePath, async (ctx) => {
    let forwardingIdentity;
    try {
      forwardingIdentity = verifyInternalForwardingHeaders({
        headers: ctx.req.raw.headers,
        expectedServiceToken: input.internalServiceToken,
      });
    } catch (error) {
      logger.warn(
        {
          err: error,
          path: ctx.req.path,
        },
        "Rejected unauthorized internal gateway HTTP forwarding request",
      );
      return ctx.json({ error: "Internal gateway forwarding is unauthorized." }, 401);
    }

    return input.gatewayHttpForwarder.forwardRequest({
      sourceNodeId: forwardingIdentity.sourceNodeId,
      targetNodeId: forwardingIdentity.targetNodeId,
      pathSuffix: toPathSuffix(ctx.req.path),
      request: ctx.req.raw,
    });
  });

  input.app.get(
    InternalGatewayTunnelForwardRoutePath,
    async (ctx, next) => {
      try {
        const forwardingIdentity = verifyInternalForwardingHeaders({
          headers: ctx.req.raw.headers,
          expectedServiceToken: input.internalServiceToken,
        });
        ctx.set("internalForwardingSourceNodeId", forwardingIdentity.sourceNodeId);
        ctx.set("internalForwardingTargetNodeId", forwardingIdentity.targetNodeId);
      } catch (error) {
        logger.warn(
          {
            err: error,
            path: ctx.req.path,
          },
          "Rejected unauthorized internal gateway websocket forwarding request",
        );
        return ctx.json({ error: "Internal gateway forwarding is unauthorized." }, 401);
      }

      await next();
    },
    input.upgradeWebSocket(
      (ctx) => {
        const sandboxInstanceId = ctx.req.param("instanceId");
        if (sandboxInstanceId === undefined || sandboxInstanceId.trim().length === 0) {
          throw new Error(
            "Internal gateway forwarding websocket request is missing sandbox instance id.",
          );
        }

        const sourceNodeId = ctx.get("internalForwardingSourceNodeId");
        const targetNodeId = ctx.get("internalForwardingTargetNodeId");
        if (sourceNodeId === undefined || targetNodeId === undefined) {
          throw new Error(
            "Expected verified internal forwarding identity for websocket forwarding request.",
          );
        }

        return input.gatewayWebSocketForwarder.createEvents({
          sourceNodeId,
          targetNodeId,
          sandboxInstanceId: sandboxInstanceId.trim(),
          requestUrl: new URL(ctx.req.url),
        });
      },
      {
        onError: (error) => {
          logger.error(
            {
              err: error,
            },
            "Internal gateway websocket forwarding error",
          );
        },
      },
    ),
  );
}
