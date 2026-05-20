import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationPermission } from "../../auth/services/organization-authorization.js";
import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { listOrganizationIdentityLinkProviderConfigLinks } from "../../identity-linking/services/list-organization-identity-link-provider-links.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const db = ctx.get("db");
  const { organizationProviderConfigId } = ctx.req.valid("param");

  await requireActiveOrganizationPermission({
    db,
    actorUserId: session.user.id,
    activeOrganizationId: session.activeOrganizationId,
    permission: OrganizationPermissions.ORGANIZATION_UPDATE,
  });

  const links = await listOrganizationIdentityLinkProviderConfigLinks(
    {
      db,
    },
    {
      organizationId: session.activeOrganizationId,
      organizationProviderConfigId,
    },
  );

  return ctx.json({ links }, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
