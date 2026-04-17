import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationPermission } from "../../auth/services/organization-authorization.js";
import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { disableOrganizationIdentityLinkProvider } from "../../identity-linking/services/disable-organization-identity-link-provider.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const db = ctx.get("db");
  const { providerFamily } = ctx.req.valid("param");

  await requireActiveOrganizationPermission({
    db,
    actorUserId: session.user.id,
    activeOrganizationId: session.activeOrganizationId,
    permission: OrganizationPermissions.ORGANIZATION_UPDATE,
  });

  const provider = await disableOrganizationIdentityLinkProvider(
    {
      db,
      integrationRegistry: ctx.get("integrationRegistry"),
    },
    {
      organizationId: session.activeOrganizationId,
      actorUserId: session.user.id,
      providerFamily,
    },
  );

  return ctx.json(provider, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
