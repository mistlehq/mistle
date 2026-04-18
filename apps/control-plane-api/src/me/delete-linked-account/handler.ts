import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { unlinkLinkedAccount } from "../../identity-linking/services/unlink-linked-account.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const { providerFamily } = ctx.req.valid("param");

  await unlinkLinkedAccount(
    {
      db: ctx.get("db"),
    },
    {
      organizationId: session.activeOrganizationId,
      userId: session.user.id,
      providerFamily,
    },
  );

  return new Response(null, {
    status: 204,
  });
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
