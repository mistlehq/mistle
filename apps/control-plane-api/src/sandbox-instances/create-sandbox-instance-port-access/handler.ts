import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import {
  SANDBOX_INSTANCE_PORT_ACCESS_BOOTSTRAP_PATH,
  SANDBOX_INSTANCE_PORT_ACCESS_TOKEN_TTL_SECONDS,
} from "../constants.js";
import { mintPortAccessForInstance } from "../services/mint-port-access-for-instance.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const { instanceId, port } = ctx.req.valid("param");
  const portAccessConfig = ctx.get("portAccessConfig");

  const portAccess = await mintPortAccessForInstance(
    {
      dataPlaneClient,
      defaultPortAccess: {
        baseDomain: portAccessConfig.baseDomain,
        bootstrapPath: SANDBOX_INSTANCE_PORT_ACCESS_BOOTSTRAP_PATH,
        tokenTtlSeconds: SANDBOX_INSTANCE_PORT_ACCESS_TOKEN_TTL_SECONDS,
        tokenConfig: portAccessConfig.access,
      },
    },
    {
      organizationId: session.activeOrganizationId,
      instanceId,
      port,
    },
  );

  return ctx.json(portAccess, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
