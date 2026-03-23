import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { startGitHubAppInstallationConnection } from "../services/start-github-app-installation-connection.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const integrationsConfig = ctx.get("config").integrations;
  const { targetKey } = ctx.req.valid("param");
  const { displayName } = ctx.req.valid("json");

  const startedConnection = await startGitHubAppInstallationConnection(
    {
      db,
      integrationRegistry,
      integrationsConfig,
    },
    {
      organizationId: session.activeOrganizationId,
      targetKey,
      ...(displayName === undefined ? {} : { displayName }),
    },
  );

  return ctx.json(startedConnection, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
