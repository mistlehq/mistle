import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { deleteOrganizationLogo } from "../../auth/services/delete-organization-logo.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { assertActiveOrganizationAccess } from "../services/assert-active-organization-access.js";
import { assertCanManageOrganizationLogo } from "../services/assert-can-manage-organization-logo.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const db = ctx.get("db");
  const { organizationId } = ctx.req.valid("param");

  assertActiveOrganizationAccess({
    activeOrganizationId: session.session.activeOrganizationId,
    organizationId,
  });
  await assertCanManageOrganizationLogo({
    db,
    actorUserId: session.user.id,
    organizationId,
  });

  await deleteOrganizationLogo(
    {
      db,
      objectStore: ctx.get("objectStore"),
    },
    {
      organizationId,
    },
  );

  return new Response(null, {
    status: 204,
  });
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
