import type { RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import {
  IntegrationConnectionResourcesConflictError,
  listIntegrationConnectionResources,
} from "../services/list-integration-connection-resources.js";
import { route } from "./route.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const params = ctx.req.valid("param");
  const query = ctx.req.valid("query");

  try {
    const result = await listIntegrationConnectionResources(
      {
        db: ctx.get("db"),
        integrationRegistry: ctx.get("integrationRegistry"),
      },
      {
        organizationId: session.activeOrganizationId,
        connectionId: params.connectionId,
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
