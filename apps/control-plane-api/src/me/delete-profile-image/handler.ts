import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { deleteUserAvatar } from "../../auth/services/delete-user-avatar.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { user }: AppSession,
) => {
  await deleteUserAvatar(
    {
      db: ctx.get("db"),
      objectStore: ctx.get("objectStore"),
    },
    {
      userId: user.id,
    },
  );

  return new Response(null, {
    status: 204,
  });
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
