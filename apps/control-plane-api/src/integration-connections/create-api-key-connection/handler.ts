import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { createApiKeyConnection } from "../services/create-api-key-connection.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const integrationsConfig = ctx.get("config").integrations;
  const { targetKey } = ctx.req.valid("param");
  const { apiKey, displayName } = ctx.req.valid("json");

  const createdConnection = await createApiKeyConnection(
    {
      db,
      integrationRegistry,
      integrationsConfig,
    },
    {
      organizationId: session.activeOrganizationId,
      targetKey,
      displayName,
      apiKey,
    },
  );

  return ctx.json(createdConnection, 201);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
