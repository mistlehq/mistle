import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { getOrganizationLogo } from "../../auth/services/get-organization-logo.js";
import { requireActiveOrganizationPermission } from "../../auth/services/organization-authorization.js";
import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { requireCurrentSingletonImageObjectKey } from "../../lib/singleton-image-content.js";
import { PROFILE_IMAGE_READ_URL_TTL_SECONDS } from "../../me/constants.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const db = ctx.get("db");
  const organizationId = session.activeOrganizationId;
  const { v: requestedImageVersion } = ctx.req.valid("query");

  await requireActiveOrganizationPermission({
    db,
    actorUserId: session.user.id,
    activeOrganizationId: session.activeOrganizationId,
    permission: OrganizationPermissions.ORGANIZATION_LOGO_READ,
  });

  const organizationLogo = await getOrganizationLogo({
    db,
    organizationId,
  });
  const objectKey = requireCurrentSingletonImageObjectKey({
    currentObjectKey: organizationLogo.logoObjectKey,
    notFoundMessage: "Organization logo was not found.",
    requestedImageVersion,
  });

  const imageUrl = await ctx.get("objectStore").createPresignedGetUrl({
    objectKey,
    expiresInSeconds: PROFILE_IMAGE_READ_URL_TTL_SECONDS,
  });

  return ctx.redirect(imageUrl, 302);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
