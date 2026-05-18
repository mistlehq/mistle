import type { RouteHandler } from "@hono/zod-openapi";
import { NotFoundError, withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationPermission } from "../../auth/services/organization-authorization.js";
import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { readOrganizationBilling } from "../services/organization-billing.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const config = ctx.get("config");
  if (!config.billing.stripe.enabled) {
    throw new NotFoundError("NOT_FOUND", "Billing is not available.");
  }

  await requireActiveOrganizationPermission({
    db: ctx.get("db"),
    actorUserId: session.userId,
    activeOrganizationId: session.activeOrganizationId,
    permission: OrganizationPermissions.ORGANIZATION_UPDATE,
  });

  const result = await readOrganizationBilling({
    db: ctx.get("db"),
    organizationId: session.activeOrganizationId,
  });

  return ctx.json(result, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
