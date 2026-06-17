import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import { requireDesignerOrganizationActor } from "../authorization.js";
import { createDesignerSession } from "../services/designer-sessions.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
) => {
  const body = ctx.req.valid("json");
  const designerActor = requireDesignerOrganizationActor(organizationActor);
  const designerSession = await createDesignerSession(
    {
      db: ctx.get("db"),
      dataPlaneClient: ctx.get("dataPlaneClient"),
      sandboxConfig: ctx.get("sandboxConfig"),
    },
    {
      organizationId: organizationActor.organizationId,
      actor: {
        kind: "user",
        id: designerActor.userId,
        actingUserId: designerActor.userId,
      },
      body,
    },
  );

  return ctx.json(designerSession, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.DESIGNER_SESSION_CREATE,
  }),
);
