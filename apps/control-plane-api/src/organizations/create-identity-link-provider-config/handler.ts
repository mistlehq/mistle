import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationPermission } from "../../auth/services/organization-authorization.js";
import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { buildOrganizationIdentityLinkProviderConfigResponse } from "../../identity-linking/services/organization-identity-link-provider-config-response.js";
import { createOrganizationIdentityLinkProviderConfig } from "../../identity-linking/services/put-organization-identity-link-provider.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const db = ctx.get("db");
  const { providerFamily } = ctx.req.valid("param");
  const { integrationConnectionId, status } = ctx.req.valid("json");

  await requireActiveOrganizationPermission({
    db,
    actorUserId: session.user.id,
    activeOrganizationId: session.activeOrganizationId,
    permission: OrganizationPermissions.ORGANIZATION_UPDATE,
  });

  const config = await createOrganizationIdentityLinkProviderConfig(
    {
      db,
      integrationRegistry: ctx.get("integrationRegistry"),
    },
    {
      organizationId: session.activeOrganizationId,
      actorUserId: session.user.id,
      providerFamily,
      integrationConnectionId,
      status,
    },
  );

  return ctx.json(
    await buildOrganizationIdentityLinkProviderConfigResponse(
      {
        db,
        integrationRegistry: ctx.get("integrationRegistry"),
      },
      {
        organizationId: session.activeOrganizationId,
        organizationProviderConfigId: config.id,
      },
    ),
    201,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
