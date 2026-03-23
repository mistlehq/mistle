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
  const params = ctx.req.valid("param");

  const result = await requestIntegrationConnectionResourceRefresh(
    {
      db: ctx.get("db"),
      integrationRegistry: ctx.get("integrationRegistry"),
      openWorkflow: ctx.get("openWorkflow"),
    },
    {
      organizationId: session.activeOrganizationId,
      connectionId: params.connectionId,
      kind: params.kind,
    },
  );

  return ctx.json(result, 202);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
