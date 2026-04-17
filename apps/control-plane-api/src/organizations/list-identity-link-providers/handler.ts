import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationPermission } from "../../auth/services/organization-authorization.js";
import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { listOrganizationIdentityLinkProviders } from "../../identity-linking/services/list-organization-identity-link-providers.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const db = ctx.get("db");

  await requireActiveOrganizationPermission({
    db,
    actorUserId: session.user.id,
    activeOrganizationId: session.activeOrganizationId,
    permission: OrganizationPermissions.ORGANIZATION_UPDATE,
  });

  const providers = await listOrganizationIdentityLinkProviders(
    {
      db,
      integrationRegistry: ctx.get("integrationRegistry"),
    },
    {
      organizationId: session.activeOrganizationId,
    },
  );

  return ctx.json({ providers }, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
