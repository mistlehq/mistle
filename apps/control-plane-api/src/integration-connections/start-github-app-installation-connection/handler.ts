import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationAccess } from "../../auth/services/organization-authorization.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { startGitHubAppInstallationConnection } from "../services/start-github-app-installation-connection.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session, user }: AppSession,
) => {
  const db = ctx.get("db");

  await requireActiveOrganizationAccess({
    db,
    actorUserId: user.id,
    activeOrganizationId: session.activeOrganizationId,
  });
  const integrationRegistry = ctx.get("integrationRegistry");
  const { connectionId } = ctx.req.valid("param");

  const startedConnection = await startGitHubAppInstallationConnection(
    {
      db,
      integrationRegistry,
    },
    {
      organizationId: session.activeOrganizationId,
      connectionId,
    },
  );

  return ctx.json(startedConnection, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
