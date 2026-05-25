import type { RouteHandler } from "@hono/zod-openapi";
import { NotFoundError, withHttpErrorHandler } from "@mistle/http/errors.js";
import { systemClock } from "@mistle/time";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import {
  SANDBOX_INSTANCE_PORT_ACCESS_BOOTSTRAP_PATH,
  SANDBOX_INSTANCE_PORT_ACCESS_TOKEN_TTL_SECONDS,
} from "../../sandbox-instances/constants.js";
import { resolvePortAccessLink } from "../../sandbox-instances/services/mint-port-access.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const portAccessConfig = ctx.get("portAccessConfig");
  const { slug } = ctx.req.valid("param");

  const redirect = await resolvePortAccessLink({
    db,
    organizationId: session.activeOrganizationId,
    slug,
    baseDomain: portAccessConfig.baseDomain,
    gatewayWsUrl: portAccessConfig.gatewayWsUrl,
    bootstrapPath: SANDBOX_INSTANCE_PORT_ACCESS_BOOTSTRAP_PATH,
    tokenTtlSeconds: SANDBOX_INSTANCE_PORT_ACCESS_TOKEN_TTL_SECONDS,
    tokenConfig: portAccessConfig.access,
    clock: systemClock,
  });

  if (redirect === null) {
    throw new NotFoundError("NOT_FOUND", "Port Access link was not found or has expired.");
  }

  const acceptHeader = ctx.req.header("accept") ?? "";
  if (acceptHeader.toLowerCase().includes("application/json")) {
    return ctx.json(
      {
        url: redirect.bootstrapUrl,
      },
      200,
    );
  }

  return ctx.redirect(redirect.bootstrapUrl, 302);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
