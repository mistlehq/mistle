import type { RouteHandler } from "@hono/zod-openapi";
import { ForbiddenError, withHttpErrorHandler } from "@mistle/http/errors.js";

import { canManageOrganization } from "../../auth/services/organization-policy.js";
import { putOrganizationLogo } from "../../auth/services/put-organization-logo.js";
import { createSingletonImageMetadataResponse } from "../../lib/singleton-image-metadata.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { getActiveOrganizationRole } from "../services/get-active-organization-role.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const db = ctx.get("db");
  const { organizationId } = ctx.req.valid("param");
  const { file } = ctx.req.valid("form");
  const imageBytes = new Uint8Array(await file.arrayBuffer());

  const actorRole = await getActiveOrganizationRole({
    db,
    actorUserId: session.user.id,
    activeOrganizationId: session.session.activeOrganizationId,
    organizationId,
  });
  if (!canManageOrganization(actorRole)) {
    throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
  }

  const organizationLogo = await putOrganizationLogo(
    {
      db,
      objectStore: ctx.get("objectStore"),
    },
    {
      organizationId,
      imageBytes,
    },
  );

  return ctx.json(createSingletonImageMetadataResponse(organizationLogo.logoObjectKey), 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
