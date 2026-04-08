import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { PROFILE_IMAGE_READ_URL_TTL_SECONDS } from "../../me/constants.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { getActiveOrganizationRole } from "../services/get-active-organization-role.js";
import { listMemberAvatars } from "../services/list-member-avatars.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const db = ctx.get("db");
  const objectStore = ctx.get("objectStore");
  const { organizationId } = ctx.req.valid("param");
  const { userIds } = ctx.req.valid("json");

  await getActiveOrganizationRole({
    db,
    actorUserId: session.user.id,
    activeOrganizationId: session.session.activeOrganizationId,
    organizationId,
  });

  const result = await listMemberAvatars(
    {
      db,
      objectStore,
      presignedUrlTtlSeconds: PROFILE_IMAGE_READ_URL_TTL_SECONDS,
    },
    {
      organizationId,
      userIds,
    },
  );

  return ctx.json(result, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
