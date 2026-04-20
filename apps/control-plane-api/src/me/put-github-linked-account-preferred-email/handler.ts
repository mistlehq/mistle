import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { updateGitHubLinkedAccountPreferredEmail } from "../../identity-linking/services/update-github-linked-account-preferred-email.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const { preferredEmail } = ctx.req.valid("json");

  await updateGitHubLinkedAccountPreferredEmail(
    {
      db: ctx.get("db"),
      integrationRegistry: ctx.get("integrationRegistry"),
    },
    {
      organizationId: session.activeOrganizationId,
      userId: session.user.id,
      preferredEmail,
    },
  );

  return new Response(null, {
    status: 204,
  });
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
