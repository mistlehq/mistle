import type { RouteHandler } from "@hono/zod-openapi";
import { ApiKeyActorKinds } from "@mistle/db/control-plane";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationPermission } from "../../auth/services/organization-authorization.js";
import { OrganizationPermissions } from "../../auth/services/organization-policy.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { deleteApiKey } from "../services/delete-api-key.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const { apiKeyId } = ctx.req.valid("param");

  await requireActiveOrganizationPermission({
    db,
    actorUserId: session.userId,
    activeOrganizationId: session.activeOrganizationId,
    permission: OrganizationPermissions.API_KEY_MANAGE,
  });

  await deleteApiKey(
    {
      db,
    },
    {
      organizationId: session.activeOrganizationId,
      actorKind: ApiKeyActorKinds.USER,
      actorId: session.userId,
      apiKeyId,
    },
  );

  return ctx.body(null, 204);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
