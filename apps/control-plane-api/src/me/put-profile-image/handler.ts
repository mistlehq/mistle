import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { putUserAvatar } from "../../auth/services/put-user-avatar.js";
import { createSingletonImageMetadataResponse } from "../../lib/singleton-image-metadata.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { user }: AppSession,
) => {
  const db = ctx.get("db");
  const { file } = ctx.req.valid("form");
  const imageBytes = new Uint8Array(await file.arrayBuffer());

  const profileImage = await putUserAvatar(
    {
      db,
      objectStore: ctx.get("objectStore"),
    },
    {
      userId: user.id,
      imageBytes,
    },
  );

  return ctx.json(createSingletonImageMetadataResponse(profileImage.imageObjectKey), 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
