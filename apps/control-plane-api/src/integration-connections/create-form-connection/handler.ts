import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { createFormConnection } from "../services/create-form-connection.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const appConfig = ctx.get("config");
  const integrationsConfig = appConfig.integrations;
  const { targetKey } = ctx.req.valid("param");
  const { config: connectionConfig, displayName, methodId, secrets } = ctx.req.valid("json");

  const createdConnection = await createFormConnection(
    {
      db,
      integrationRegistry,
      integrationsConfig,
      controlPlaneBaseUrl: appConfig.auth.baseUrl,
    },
    {
      organizationId: session.activeOrganizationId,
      targetKey,
      displayName,
      methodId,
      config: connectionConfig,
      secrets,
    },
  );

  return ctx.json(createdConnection, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
