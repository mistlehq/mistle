import type { RouteHandler } from "@hono/zod-openapi";
import { getControlPlaneDatabaseSchema } from "@mistle/db/control-plane";
import { NotFoundError, withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationPermission } from "../../auth/services/organization-authorization.js";
import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import {
  enqueueStripeCustomerProvisioning,
  readOrganizationBilling,
} from "../services/organization-billing.js";
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

  const organization = await ctx.get("db").query.organizations.findFirst({
    columns: {
      name: true,
    },
    where: (table, { eq }) => eq(table.id, session.activeOrganizationId),
  });

  if (organization === undefined) {
    throw new NotFoundError("NOT_FOUND", "Organization was not found.");
  }

  await enqueueStripeCustomerProvisioning({
    db: ctx.get("db"),
    table: getControlPlaneDatabaseSchema(ctx.get("db")).organizationBillingCustomers,
    openWorkflow: ctx.get("openWorkflow"),
    organizationId: session.activeOrganizationId,
    organizationName: organization.name,
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
