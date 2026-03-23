import type { RouteHandler } from "@hono/zod-openapi";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { createProfile } from "../services/create-profile.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const { displayName } = ctx.req.valid("json");

  const profile = await createProfile(
    {
      db,
    },
    {
      displayName,
      organizationId: session.activeOrganizationId,
    },
  );

  return ctx.json(profile, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withRequiredSession(routeHandler);
