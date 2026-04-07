import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { getUserAvatar } from "../../auth/services/get-user-avatar.js";
import { resolvePresignedImageExpiresAt } from "../../auth/services/presigned-image-response.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { PROFILE_IMAGE_READ_URL_TTL_SECONDS } from "../constants.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { user }: AppSession,
) => {
  const objectStore = ctx.get("objectStore");
  const profileImage = await getUserAvatar({
    db: ctx.get("db"),
    userId: user.id,
  });
  const now = new Date();

  const imageUrl =
    profileImage.imageObjectKey === null
      ? null
      : await objectStore.createPresignedGetUrl({
          objectKey: profileImage.imageObjectKey,
          expiresInSeconds: PROFILE_IMAGE_READ_URL_TTL_SECONDS,
        });
  const expiresAt =
    imageUrl === null
      ? null
      : resolvePresignedImageExpiresAt({
          now,
          expiresInSeconds: PROFILE_IMAGE_READ_URL_TTL_SECONDS,
        });

  return ctx.json(
    {
      imageUrl,
      expiresAt,
    },
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
