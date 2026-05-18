import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import { requestDeleteProfile } from "../services/request-delete-profile.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
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
      organizationId: organizationActor.organizationId,
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
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.SANDBOX_PROFILE_DELETE,
  }),
);
