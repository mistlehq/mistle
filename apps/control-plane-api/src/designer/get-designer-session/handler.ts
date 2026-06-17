import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import { requireDesignerOrganizationActor } from "../authorization.js";
import { getDesignerSession } from "../services/designer-sessions.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
) => {
  const params = ctx.req.valid("param");
  requireDesignerOrganizationActor(organizationActor);
  const designerSession = await getDesignerSession(
    {
      db: ctx.get("db"),
      dataPlaneClient: ctx.get("dataPlaneClient"),
    },
    {
      organizationId: organizationActor.organizationId,
      sessionId: params.sessionId,
    },
  );

  return ctx.json(designerSession, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.DESIGNER_SESSION_READ,
  }),
);
