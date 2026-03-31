import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { SANDBOX_INSTANCE_PORT_SHARE_DEFAULT_TTL_SECONDS } from "../constants.js";
import { createPortShareLinkForInstance } from "../services/create-port-share-link-for-instance.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const publishedTargetConfig = ctx.get("publishedTargetConfig");
  const { instanceId, port } = ctx.req.valid("param");
  const { expiresInSeconds } = ctx.req.valid("json");

  const shareLink = await createPortShareLinkForInstance(
    {
      dataPlaneClient,
      publishedTargetConfig,
    },
    {
      organizationId: session.activeOrganizationId,
      instanceId,
      port,
      ttlSeconds: expiresInSeconds ?? SANDBOX_INSTANCE_PORT_SHARE_DEFAULT_TTL_SECONDS,
    },
  );

  return ctx.json(shareLink, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
