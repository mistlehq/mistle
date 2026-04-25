import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../../types.js";
import { startGitHubAppInstallationConnection } from "../services/start-installation.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const integrationsConfig = ctx.get("config").integrations;
  const { connectionId } = ctx.req.valid("param");

  const startedConnection = await startGitHubAppInstallationConnection(
    {
      db,
      integrationRegistry,
      integrationsConfig,
    },
    {
      organizationId: session.activeOrganizationId,
      connectionId,
    },
  );

  return ctx.json(startedConnection, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
