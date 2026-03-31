import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { SANDBOX_INSTANCE_PORT_PUBLISH_TOKEN_TTL_SECONDS } from "../constants.js";
import { mintPortPublishTokenForInstance } from "../services/mint-port-publish-token-for-instance.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session, user }: AppSession,
) => {
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const publishedTargetConfig = ctx.get("publishedTargetConfig");
  const { instanceId, port } = ctx.req.valid("param");

  const publishedTarget = await mintPortPublishTokenForInstance(
    {
      dataPlaneClient,
      publishedTargetConfig,
    },
    {
      organizationId: session.activeOrganizationId,
      instanceId,
      port,
      ttlSeconds: SANDBOX_INSTANCE_PORT_PUBLISH_TOKEN_TTL_SECONDS,
      userId: user.id,
    },
  );

  return ctx.json(publishedTarget, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
