import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { requestIntegrationConnectionResourceRefresh } from "../services/refresh-integration-connection-resources.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const openWorkflow = ctx.get("openWorkflow");
  const { connectionId, kind } = ctx.req.valid("param");

  const result = await requestIntegrationConnectionResourceRefresh(
    {
      db,
      integrationRegistry,
      openWorkflow,
    },
    {
      organizationId: session.activeOrganizationId,
      connectionId,
      kind,
    },
  );

  return ctx.json(result, 202);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
