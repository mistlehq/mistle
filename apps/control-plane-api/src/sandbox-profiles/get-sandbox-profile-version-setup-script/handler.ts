import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { getProfileVersionSetupScript } from "../services/get-profile-version-setup-script.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const { profileId, version } = ctx.req.valid("param");

  const setupScript = await getProfileVersionSetupScript(
    {
      db,
    },
    {
      organizationId: session.activeOrganizationId,
      profileId,
      profileVersion: version,
    },
  );

  return ctx.json(setupScript, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
