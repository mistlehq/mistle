import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import { SANDBOX_INSTANCE_CONNECTION_TOKEN_TTL_SECONDS } from "../constants.js";
import { mintConnectionTokenForInstance } from "../services/mint-connection-token-for-instance.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
) => {
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const { instanceId } = ctx.req.valid("param");
  const sandboxConfig = ctx.get("sandboxConfig");
  const connectionTokenConfig = ctx.get("connectionTokenConfig");

  const connectionToken = await mintConnectionTokenForInstance(
    {
      dataPlaneClient,
      defaultConnectionToken: {
        gatewayWebsocketUrl: sandboxConfig.gatewayWsUrl,
        tokenTtlSeconds: SANDBOX_INSTANCE_CONNECTION_TOKEN_TTL_SECONDS,
        tokenConfig: {
          connectionTokenSecret: connectionTokenConfig.secret,
          tokenIssuer: connectionTokenConfig.issuer,
          tokenAudience: connectionTokenConfig.audience,
        },
      },
    },
    {
      organizationId: organizationActor.organizationId,
      instanceId,
    },
  );

  return ctx.json(connectionToken, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.SANDBOX_SESSION_CONNECT,
  }),
);
