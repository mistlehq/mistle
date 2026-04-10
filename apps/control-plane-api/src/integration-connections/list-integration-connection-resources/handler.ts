import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { requireActiveOrganizationAccess } from "../../auth/services/organization-authorization.js";
import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import {
  IntegrationConnectionResourcesConflictError,
  listIntegrationConnectionResources,
} from "../services/list-integration-connection-resources.js";
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
  const query = ctx.req.valid("query");

  try {
    const result = await listIntegrationConnectionResources(
      {
        db,
        integrationRegistry,
      },
      {
        organizationId: session.activeOrganizationId,
        connectionId,
        ...query,
      },
    );

    return ctx.json(result, 200);
  } catch (error) {
    if (error instanceof IntegrationConnectionResourcesConflictError) {
      return ctx.json(
        {
          code: error.code,
          message: error.message,
          ...(error.lastErrorCode === null ? {} : { lastErrorCode: error.lastErrorCode }),
          ...(error.lastErrorMessage === null ? {} : { lastErrorMessage: error.lastErrorMessage }),
        },
        error.status,
      );
    }

    throw error;
  }
};

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
