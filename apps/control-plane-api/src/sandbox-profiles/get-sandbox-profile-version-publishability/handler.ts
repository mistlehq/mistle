import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import { getProfileVersionPublishability } from "../services/get-profile-version-publishability.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
) => {
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const sandboxConfig = ctx.get("sandboxConfig");
  const { profileId, version } = ctx.req.valid("param");

  const publishability = await getProfileVersionPublishability(
    {
      db,
      integrationRegistry,
      sandboxConfig,
    },
    {
      organizationId: organizationActor.organizationId,
      profileId,
      profileVersion: version,
    },
  );

  return ctx.json(publishability, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.SANDBOX_PROFILE_READ,
  }),
);
