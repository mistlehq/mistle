import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { putUserAvatar } from "../../auth/services/put-user-avatar.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { PROFILE_IMAGE_READ_URL_TTL_SECONDS } from "../constants.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { user }: AppSession,
) => {
  const objectStore = ctx.get("objectStore");
  const db = ctx.get("db");
  const { file } = ctx.req.valid("form");
  const imageBytes = new Uint8Array(await file.arrayBuffer());

  const profileImage = await putUserAvatar(
    {
      db,
      objectStore,
    },
    {
      userId: user.id,
      imageBytes,
    },
  );
  const imageUrl = await objectStore.createPresignedGetUrl({
    objectKey: profileImage.imageObjectKey,
    expiresInSeconds: PROFILE_IMAGE_READ_URL_TTL_SECONDS,
  });

  return ctx.json(
    {
      imageUrl,
    },
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
