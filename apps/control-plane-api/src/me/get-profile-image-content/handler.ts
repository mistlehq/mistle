import type { RouteHandler } from "@hono/zod-openapi";
import { NotFoundError, withHttpErrorHandler } from "@mistle/http/errors.js";

import { getUserAvatar } from "../../auth/services/get-user-avatar.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { PROFILE_IMAGE_READ_URL_TTL_SECONDS } from "../constants.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { user }: AppSession,
) => {
  const profileImage = await getUserAvatar({
    db: ctx.get("db"),
    userId: user.id,
  });

  if (profileImage.imageObjectKey === null) {
    throw new NotFoundError("NOT_FOUND", "Profile image was not found.");
  }

  const imageUrl = await ctx.get("objectStore").createPresignedGetUrl({
    objectKey: profileImage.imageObjectKey,
    expiresInSeconds: PROFILE_IMAGE_READ_URL_TTL_SECONDS,
  });

  return ctx.redirect(imageUrl, 302);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
