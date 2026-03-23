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
  const params = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const updatedConnection = await updateApiKeyConnection(
    {
      db: ctx.get("db"),
      integrationRegistry: ctx.get("integrationRegistry"),
      integrationsConfig: ctx.get("config").integrations,
    },
    {
      organizationId: session.activeOrganizationId,
      connectionId: params.connectionId,
      displayName: body.displayName,
      apiKey: body.apiKey,
    },
  );

  return ctx.json(updatedConnection, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
