import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { startOAuth2AuthorizationCodeConnection } from "../services/start-oauth2-authorization-code-connection.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const config = ctx.get("config");
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const { targetKey } = ctx.req.valid("param");
  const { config: connectionConfig, displayName } = ctx.req.valid("json");

  const startedConnection = await startOAuth2AuthorizationCodeConnection(
    {
      db,
      integrationRegistry,
      integrationsConfig: config.integrations,
    },
    {
      organizationId: session.activeOrganizationId,
      targetKey,
      controlPlaneBaseUrl: config.auth.baseUrl,
      ...(connectionConfig === undefined ? {} : { connectionConfig }),
      ...(displayName === undefined ? {} : { displayName }),
    },
  );

  return ctx.json(startedConnection, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
