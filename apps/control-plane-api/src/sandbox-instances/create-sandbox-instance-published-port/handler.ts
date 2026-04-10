import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { SANDBOX_INSTANCE_PUBLISHED_PORT_BOOTSTRAP_TTL_SECONDS } from "../constants.js";
import { mintPublishedPortForInstance } from "../services/mint-published-port-for-instance.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const publishConfig = ctx.get("publishConfig");
  const sandboxConfig = ctx.get("sandboxConfig");
  const { instanceId, port } = ctx.req.valid("param");

  const publishedPort = await mintPublishedPortForInstance(
    {
      dataPlaneClient,
      defaultPublishedPort: {
        gatewayWebsocketUrl: sandboxConfig.gatewayWsUrl,
        publishBaseDomain: publishConfig.baseDomain,
        tokenTtlSeconds: SANDBOX_INSTANCE_PUBLISHED_PORT_BOOTSTRAP_TTL_SECONDS,
        tokenConfig: {
          tokenSecret: publishConfig.access.tokenSecret,
          tokenIssuer: publishConfig.access.tokenIssuer,
          tokenAudience: publishConfig.access.tokenAudience,
        },
      },
    },
    {
      organizationId: session.activeOrganizationId,
      instanceId,
      port,
    },
  );

  return ctx.json(publishedPort, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
