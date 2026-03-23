import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { updateApiKeyConnection } from "../services/update-api-key-connection.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const integrationsConfig = ctx.get("config").integrations;
  const { connectionId } = ctx.req.valid("param");
  const { apiKey, displayName } = ctx.req.valid("json");

  const updatedConnection = await updateApiKeyConnection(
    {
      db,
      integrationRegistry,
      integrationsConfig,
    },
    {
      organizationId: session.activeOrganizationId,
      connectionId,
      displayName,
      apiKey,
    },
  );

  return ctx.json(updatedConnection, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
