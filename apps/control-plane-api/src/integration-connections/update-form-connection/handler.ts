import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationAccess } from "../../auth/services/organization-authorization.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import { updateFormConnection } from "../services/update-form-connection.js";
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
  const integrationsConfig = ctx.get("config").integrations;
  const { connectionId } = ctx.req.valid("param");
  const { config, displayName, secrets } = ctx.req.valid("json");

  const updatedConnection = await updateFormConnection(
    {
      db,
      integrationRegistry,
      integrationsConfig,
    },
    {
      organizationId: session.activeOrganizationId,
      connectionId,
      displayName,
      config,
      ...(secrets === undefined ? {} : { secrets }),
    },
  );

  return ctx.json(updatedConnection, 200);
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
