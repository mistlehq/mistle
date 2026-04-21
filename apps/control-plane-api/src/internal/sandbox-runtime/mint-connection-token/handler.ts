import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { SANDBOX_INSTANCE_CONNECTION_TOKEN_TTL_SECONDS } from "../../../sandbox-instances/constants.js";
import type { AppContextBindings } from "../../../types.js";
import { mintConnectionToken } from "../services/mint-connection-token.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("db");
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const sandboxConfig = ctx.get("sandboxConfig");
  const connectionTokenConfig = ctx.get("connectionTokenConfig");
  const body = ctx.req.valid("json");

  const mintedToken = await mintConnectionToken(
    {
      db,
      dataPlaneClient,
      gatewayWebsocketUrl: sandboxConfig.gatewayWsUrl,
      tokenTtlSeconds: SANDBOX_INSTANCE_CONNECTION_TOKEN_TTL_SECONDS,
      tokenConfig: {
        connectionTokenSecret: connectionTokenConfig.secret,
        tokenIssuer: connectionTokenConfig.issuer,
        tokenAudience: connectionTokenConfig.audience,
      },
    },
    {
      organizationId: body.organizationId,
      instanceId: body.instanceId,
      ...(body.actingUserId === undefined ? {} : { actingUserId: body.actingUserId }),
      ...(body.webhookEventId === undefined ? {} : { webhookEventId: body.webhookEventId }),
      ...(body.deliveryTaskId === undefined ? {} : { deliveryTaskId: body.deliveryTaskId }),
      ...(body.externalDeliveryId === undefined
        ? {}
        : { externalDeliveryId: body.externalDeliveryId }),
      ...(body.automationRunId === undefined ? {} : { automationRunId: body.automationRunId }),
      ...(body.conversationId === undefined ? {} : { conversationId: body.conversationId }),
    },
  );

  return ctx.json(mintedToken, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
