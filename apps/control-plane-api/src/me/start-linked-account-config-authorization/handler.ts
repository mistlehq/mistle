import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { startLinkedAccountAuthorization } from "../../identity-linking/services/start-linked-account-authorization.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  session: AppSession,
) => {
  const { organizationProviderConfigId } = ctx.req.valid("param");
  const startedAuthorization = await startLinkedAccountAuthorization(
    {
      db: ctx.get("db"),
      integrationRegistry: ctx.get("integrationRegistry"),
      integrationsConfig: ctx.get("config").integrations,
    },
    {
      organizationId: session.activeOrganizationId,
      userId: session.user.id,
      organizationProviderConfigId,
      controlPlaneBaseUrl: ctx.get("config").auth.baseUrl,
    },
  );

  return ctx.json(startedAuthorization, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
