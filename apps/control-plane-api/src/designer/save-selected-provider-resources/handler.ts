import type { RouteHandler } from "@hono/zod-openapi";
import { ForbiddenError, withHttpErrorHandler } from "@mistle/http/errors.js";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import { requireDesignerOrganizationActor } from "../authorization.js";
import { saveDesignerSelectedProviderResources } from "../services/designer-dashboard-actions.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
) => {
  const params = ctx.req.valid("param");
  const body = ctx.req.valid("json");
  requireDesignerOrganizationActor(organizationActor);
  // The dashboard action is Designer-mediated, but the persisted mutation is a sandbox profile draft write.
  if (!organizationActor.permissions.includes(OrganizationPermissions.SANDBOX_PROFILE_UPDATE)) {
    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }

  const receipt = await saveDesignerSelectedProviderResources(
    {
      db: ctx.get("db"),
      integrationRegistry: ctx.get("integrationRegistry"),
      sandboxConfig: ctx.get("sandboxConfig"),
    },
    {
      organizationId: organizationActor.organizationId,
      sessionId: params.sessionId,
      body,
    },
  );

  return ctx.json(receipt, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.DESIGNER_SESSION_UPDATE,
  }),
);
