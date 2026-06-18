import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredOrganizationActor } from "../../middleware/with-required-organization-actor.js";
import type { AppContextBindings, AppOrganizationActor } from "../../types.js";
import { requireDesignerOrganizationActor } from "../authorization.js";
import { putDesignerSessionCanvasTabsBySandboxInstanceId } from "../services/designer-sessions.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  organizationActor: AppOrganizationActor,
) => {
  const params = ctx.req.valid("param");
  const body = ctx.req.valid("json");
  requireDesignerOrganizationActor(organizationActor);
  const designerSession = await putDesignerSessionCanvasTabsBySandboxInstanceId(
    {
      db: ctx.get("db"),
      dataPlaneClient: ctx.get("dataPlaneClient"),
    },
    {
      organizationId: organizationActor.organizationId,
      sandboxInstanceId: params.instanceId,
      body,
    },
  );

  return ctx.json(designerSession, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredOrganizationActor(routeHandler, {
    permission: OrganizationPermissions.DESIGNER_SESSION_UPDATE,
  }),
);
