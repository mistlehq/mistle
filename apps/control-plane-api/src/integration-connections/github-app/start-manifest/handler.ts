import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../../types.js";
import { startGitHubAppManifestConnection } from "../services/start-manifest.js";
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

  const startedManifest = await startGitHubAppManifestConnection(
    {
      db,
      integrationRegistry,
      integrationsConfig: config.integrations,
    },
    {
      organizationId: session.activeOrganizationId,
      connectionId,
      controlPlaneBaseUrl: config.auth.baseUrl,
      manifest: body.manifest,
      owner: body.owner,
    },
  );

  return ctx.json(startedManifest, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
