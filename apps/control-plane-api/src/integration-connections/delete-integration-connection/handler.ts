import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { deleteIntegrationConnection } from "../services/delete-integration-connection.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const { connectionId } = ctx.req.valid("param");

  await deleteIntegrationConnection(
    {
      db: ctx.get("db"),
      integrationRegistry: ctx.get("integrationRegistry"),
      integrationsConfig: ctx.get("config").integrations,
      controlPlaneBaseUrl: ctx.get("config").auth.baseUrl,
    },
    {
      organizationId: session.activeOrganizationId,
      connectionId,
    },
  );

  return ctx.json(
    {
      connectionId,
    },
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
