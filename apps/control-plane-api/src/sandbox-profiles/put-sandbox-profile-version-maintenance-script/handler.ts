import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { putProfileVersionMaintenanceScript } from "../services/put-profile-version-maintenance-script.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const { profileId, version } = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const response = await putProfileVersionMaintenanceScript(
    {
      db,
    },
    {
      organizationId: session.activeOrganizationId,
      profileId,
      profileVersion: version,
      maintenanceScript: body.maintenanceScript,
    },
  );

  return ctx.json(response, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
