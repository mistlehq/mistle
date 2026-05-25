import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";
import { systemClock } from "@mistle/time";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import { PUBLIC_PORT_ACCESS_LINKS_ROUTE_BASE_PATH } from "../../public-port-access-links/index.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { SANDBOX_INSTANCE_PORT_ACCESS_LINK_TTL_SECONDS } from "../constants.js";
import { mintPortAccess } from "../services/mint-port-access.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const db = ctx.get("db");
  const { instanceId, port } = ctx.req.valid("param");
  const portAccessConfig = ctx.get("portAccessConfig");
  const publicBaseUrl = ctx.get("config").dashboard.baseUrl;

  const portAccess = await mintPortAccess(
    {
      dataPlaneClient,
    },
    {
      db,
      organizationId: session.activeOrganizationId,
      instanceId,
      port,
      baseDomain: portAccessConfig.baseDomain,
      publicBaseUrl,
      linkPathBase: PUBLIC_PORT_ACCESS_LINKS_ROUTE_BASE_PATH,
      linkTtlSeconds: SANDBOX_INSTANCE_PORT_ACCESS_LINK_TTL_SECONDS,
      createdBy: {
        kind: "user",
        id: session.userId,
      },
      clock: systemClock,
    },
  );

  return ctx.json(portAccess, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
