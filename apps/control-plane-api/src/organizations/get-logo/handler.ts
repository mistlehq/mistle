import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { getOrganizationLogo } from "../../auth/services/get-organization-logo.js";
import { requireOrganizationPermission } from "../../auth/services/organization-authorization.js";
import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { createSingletonImageMetadataResponse } from "../../lib/singleton-image-metadata.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const db = ctx.get("db");
  const { organizationId } = ctx.req.valid("param");

  await requireOrganizationPermission({
    db,
    actorUserId: session.user.id,
    activeOrganizationId: session.session.activeOrganizationId,
    organizationId,
    permission: OrganizationPermissions.ORGANIZATION_LOGO_READ,
  });

  const organizationLogo = await getOrganizationLogo({
    db,
    organizationId,
  });

  return ctx.json(createSingletonImageMetadataResponse(organizationLogo.logoObjectKey), 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
