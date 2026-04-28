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
  const body = ctx.req.valid("json");

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
      routeSegment: "github-app",
      body,
      invalidInputCode:
        IntegrationConnectionsBadRequestCodes.INVALID_GITHUB_APP_MANIFEST_START_INPUT,
    },
  );

  if (startedSetup.kind !== "form-post") {
    throw new Error("GitHub App manifest setup must return a form post start result.");
  }
  const manifestField = startedSetup.fields["manifest"];
  if (manifestField === undefined) {
    throw new Error("GitHub App manifest setup did not return a manifest form field.");
  }

  return ctx.json(
    {
      submissionUrl: startedSetup.submissionUrl,
      fields: {
        manifest: manifestField,
      },
    },
    200,
  );
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
