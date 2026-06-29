import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationPermission } from "../../auth/services/organization-authorization.js";
import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { readOrganizationUsage } from "../services/organization-usage.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  await requireActiveOrganizationPermission({
    db: ctx.get("db"),
    actorUserId: session.userId,
    activeOrganizationId: session.activeOrganizationId,
    permission: OrganizationPermissions.ORGANIZATION_UPDATE,
  });

  const query = ctx.req.valid("query");
  const result = await readOrganizationUsage(
    {
      db: ctx.get("db"),
      dataPlaneClient: ctx.get("dataPlaneClient"),
    },
    {
      month: query.month,
      organizationId: session.activeOrganizationId,
      requestedAt: new Date().toISOString(),
    },
  );

  return ctx.json(result, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
