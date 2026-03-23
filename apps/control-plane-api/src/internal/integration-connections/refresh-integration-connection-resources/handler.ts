import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import type { AppContextBindings } from "../../../types.js";
import { requestIntegrationConnectionResourceRefresh } from "../services/request-integration-connection-resource-refresh.js";
import { route } from "./route.js";

const routeHandler: RouteHandler<typeof route, AppContextBindings> = async (ctx) => {
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const openWorkflow = ctx.get("openWorkflow");
  const body = ctx.req.valid("json");

  const result = await requestIntegrationConnectionResourceRefresh(
    {
      db,
      integrationRegistry,
      openWorkflow,
    },
    body,
  );

  return ctx.json(result, 202);
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withHttpErrorHandler(routeHandler);
