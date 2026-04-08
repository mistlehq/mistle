import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { getUserAvatar } from "../../auth/services/get-user-avatar.js";
import { createSingletonImageMetadataResponse } from "../../lib/singleton-image-metadata.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { user }: AppSession,
) => {
  const profileImage = await getUserAvatar({
    db: ctx.get("db"),
    userId: user.id,
  });

  return ctx.json(createSingletonImageMetadataResponse(profileImage.imageObjectKey), 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
