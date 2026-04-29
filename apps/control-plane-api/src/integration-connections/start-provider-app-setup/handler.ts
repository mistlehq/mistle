import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { IntegrationConnectionsBadRequestCodes } from "../constants.js";
import { startProviderAppSetup } from "../services/provider-app-setup.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const config = ctx.get("config");
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const { connectionId, routeSegment } = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  const startedSetup = await startProviderAppSetup(
    {
      db,
      integrationRegistry,
      integrationsConfig: config.integrations,
      controlPlaneBaseUrl: config.auth.baseUrl,
    },
    {
      organizationId: session.activeOrganizationId,
      connectionId,
      routeSegment,
      body,
      invalidInputCode: IntegrationConnectionsBadRequestCodes.INVALID_UPDATE_CONNECTION_INPUT,
    },
  );

  return ctx.json(startedSetup, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
