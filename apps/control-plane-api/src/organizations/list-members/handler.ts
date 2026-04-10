import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireOrganizationPermission } from "../../auth/services/organization-authorization.js";
import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { PROFILE_IMAGE_READ_URL_TTL_SECONDS } from "../../me/constants.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { listMembers } from "../services/list-members.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const db = ctx.get("db");
  const objectStore = ctx.get("objectStore");
  const { organizationId } = ctx.req.valid("param");
  const { limit, offset, search } = ctx.req.valid("query");

  await requireOrganizationPermission({
    db,
    actorUserId: session.user.id,
    activeOrganizationId: session.session.activeOrganizationId,
    organizationId,
    permission: OrganizationPermissions.ORGANIZATION_MEMBERSHIP_READ,
  });

  const result = await listMembers(
    {
      db,
      objectStore,
      presignedUrlTtlSeconds: PROFILE_IMAGE_READ_URL_TTL_SECONDS,
    },
    {
      organizationId,
      limit,
      offset,
      search,
    },
  );

  return ctx.json(result, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
