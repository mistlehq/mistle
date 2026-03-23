import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { requestDeleteProfile } from "../services/request-delete-profile.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const openWorkflow = ctx.get("openWorkflow");
  const { profileId } = ctx.req.valid("param");

  const deletionRequest = await requestDeleteProfile(
    {
      db,
      openWorkflow,
    },
    {
      organizationId: session.activeOrganizationId,
      profileId,
    },
  );

  return ctx.json(
    {
      status: "accepted" as const,
      profileId: deletionRequest.profileId,
    },
    202,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
