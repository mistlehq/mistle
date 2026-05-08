import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { refreshIntegrationWebhookSourceTriggerCapabilities } from "../services/webhook-sources.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const source = await refreshIntegrationWebhookSourceTriggerCapabilities(
    {
      db: ctx.get("db"),
      integrationRegistry: ctx.get("integrationRegistry"),
      integrationsConfig: ctx.get("config").integrations,
      controlPlaneBaseUrl: ctx.get("config").auth.baseUrl,
    },
    {
      organizationId: session.activeOrganizationId,
      connectionId: ctx.req.valid("param").connectionId,
      body: ctx.req.valid("json"),
    },
  );

  return ctx.json(source, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
