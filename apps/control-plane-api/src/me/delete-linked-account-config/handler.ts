import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { unlinkLinkedAccountForProviderConfig } from "../../identity-linking/services/unlink-linked-account.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const { organizationProviderConfigId } = ctx.req.valid("param");

  await unlinkLinkedAccountForProviderConfig(
    {
      db: ctx.get("db"),
    },
    {
      organizationId: session.activeOrganizationId,
      userId: session.user.id,
      organizationProviderConfigId,
    },
  );

  return new Response(null, {
    status: 204,
  });
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
