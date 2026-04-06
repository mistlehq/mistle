import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { putOrganizationLogo } from "../../auth/services/put-organization-logo.js";
import { PROFILE_IMAGE_READ_URL_TTL_SECONDS } from "../../me/constants.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { assertActiveOrganizationAccess } from "../services/assert-active-organization-access.js";
import { assertCanManageOrganizationLogo } from "../services/assert-can-manage-organization-logo.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const objectStore = ctx.get("objectStore");
  const db = ctx.get("db");
  const { organizationId } = ctx.req.valid("param");
  const { file } = ctx.req.valid("form");
  const imageBytes = new Uint8Array(await file.arrayBuffer());

  assertActiveOrganizationAccess({
    activeOrganizationId: session.session.activeOrganizationId,
    organizationId,
  });
  await assertCanManageOrganizationLogo({
    db,
    actorUserId: session.user.id,
    organizationId,
  });

  const organizationLogo = await putOrganizationLogo(
    {
      db,
      objectStore,
    },
    {
      organizationId,
      imageBytes,
    },
  );
  const imageUrl = await objectStore.createPresignedGetUrl({
    objectKey: organizationLogo.logoObjectKey,
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
