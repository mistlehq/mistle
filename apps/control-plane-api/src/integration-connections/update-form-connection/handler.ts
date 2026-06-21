import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { updateFormConnection } from "../services/update-form-connection.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const dataPlaneClient = ctx.get("dataPlaneClient");
  const integrationRegistry = ctx.get("integrationRegistry");
  const config = ctx.get("config");
  const integrationsConfig = config.integrations;
  const { connectionId } = ctx.req.valid("param");
  const {
    config: connectionConfig,
    displayName,
    providerConfigurationSetup,
    secrets,
  } = ctx.req.valid("json");

  const updatedConnection = await updateFormConnection(
    {
      db,
      dataPlaneClient,
      integrationRegistry,
      integrationsConfig,
      controlPlaneBaseUrl: config.auth.baseUrl,
    },
    {
      organizationId: session.activeOrganizationId,
      connectionId,
      displayName,
      config: connectionConfig,
      ...(providerConfigurationSetup === undefined ? {} : { providerConfigurationSetup }),
      ...(secrets === undefined ? {} : { secrets }),
    },
  );

  return ctx.json(updatedConnection, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
