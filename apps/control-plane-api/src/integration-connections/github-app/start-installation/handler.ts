import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../../types.js";
import { IntegrationConnectionsBadRequestCodes } from "../../constants.js";
import { startExternalAppSetup } from "../../services/external-app-setup.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const config = ctx.get("config");
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const { connectionId } = ctx.req.valid("param");

  const startedSetup = await startExternalAppSetup(
    {
      db,
      integrationRegistry,
      integrationsConfig: config.integrations,
      controlPlaneBaseUrl: config.auth.baseUrl,
    },
    {
      organizationId: session.activeOrganizationId,
      connectionId,
      routeSegment: "github-app-installation",
      body: {},
      invalidInputCode:
        IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_INSTALLATION_START_INPUT,
      missingCredentialsMessage: `Integration connection '${connectionId}' is missing required GitHub App credentials.`,
    },
  );

  if (startedSetup.kind !== "redirect") {
    throw new Error("GitHub App installation setup must return a redirect start result.");
  }

  return ctx.json({ authorizationUrl: startedSetup.authorizationUrl }, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
