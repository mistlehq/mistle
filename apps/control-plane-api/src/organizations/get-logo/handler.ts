import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { getOrganizationLogo } from "../../auth/services/get-organization-logo.js";
import { PROFILE_IMAGE_READ_URL_TTL_SECONDS } from "../../me/constants.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { assertActiveOrganizationAccess } from "../services/assert-active-organization-access.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const objectStore = ctx.get("objectStore");
  const { organizationId } = ctx.req.valid("param");

  assertActiveOrganizationAccess({
    activeOrganizationId: session.session.activeOrganizationId,
    organizationId,
  });

  const organizationLogo = await getOrganizationLogo({
    db: ctx.get("db"),
    organizationId,
  });

  const imageUrl =
    organizationLogo.logoObjectKey === null
      ? null
      : await objectStore.createPresignedGetUrl({
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
