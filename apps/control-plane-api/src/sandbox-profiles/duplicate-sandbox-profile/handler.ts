import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import { duplicateProfile } from "../services/duplicate-profile.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
) => {
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const { profileId } = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const duplicatedProfile = await duplicateProfile(
    {
      db,
      integrationRegistry,
    },
    {
      organizationId: organizationActor.organizationId,
      sourceProfileId: profileId,
      displayName: body.displayName,
      includeTriggers: body.includeTriggers ?? false,
      now: new Date(),
    },
  );

  return ctx.json(duplicatedProfile, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.SANDBOX_PROFILE_CREATE,
  }),
);
