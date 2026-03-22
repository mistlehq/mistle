import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";
import { INTEGRATION_TARGETS_ROUTE_BASE_PATH } from "./constants.js";
import {
  IntegrationTargetsBadRequestResponseSchema,
  listIntegrationTargetsRoute,
} from "./contracts.js";
import { IntegrationTargetsBadRequestError } from "./services/errors.js";
import { listIntegrationTargets } from "./services/list-targets.js";

export function createIntegrationTargetsRoutes(): AppRoutes<
  typeof INTEGRATION_TARGETS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();

  routes.openapi(listIntegrationTargetsRoute, async (ctx) => {
    try {
      const query = ctx.req.valid("query");
      const result = await listIntegrationTargets(ctx.get("db"), query);

      return ctx.json(result, 200);
    } catch (error) {
      return handleListIntegrationTargetsError(ctx, error);
    }
  });

  return {
    basePath: INTEGRATION_TARGETS_ROUTE_BASE_PATH,
    routes,
  };
}

function handleListIntegrationTargetsError(ctx: AppContext, error: unknown) {
  if (error instanceof IntegrationTargetsBadRequestError) {
    const responseBody: z.infer<typeof IntegrationTargetsBadRequestResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 400);
  }

  throw error;
}
