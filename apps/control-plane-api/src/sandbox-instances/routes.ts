import { OpenAPIHono, z } from "@hono/zod-openapi";

import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";
import { SANDBOX_INSTANCES_ROUTE_BASE_PATH } from "./constants.js";
import {
  createSandboxInstanceConnectionTokenRoute,
  getSandboxInstanceRoute,
  listSandboxInstancesRoute,
  ListSandboxInstancesResponseSchema,
  SandboxInstancesConflictResponseSchema,
  SandboxInstancesBadRequestResponseSchema,
  SandboxInstancesNotFoundResponseSchema,
} from "./contracts.js";
import {
  SandboxInstancesBadRequestError,
  SandboxInstancesConflictError,
  SandboxInstancesNotFoundError,
} from "./services/factory.js";

export function createSandboxInstancesRoutes(): AppRoutes<
  typeof SANDBOX_INSTANCES_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();

  routes.openapi(listSandboxInstancesRoute, async (ctx) => {
    try {
      const query = ctx.req.valid("query");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const sandboxInstances = await ctx.get("services").sandboxInstances.listInstances({
        organizationId: session.session.activeOrganizationId,
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.after === undefined ? {} : { after: query.after }),
        ...(query.before === undefined ? {} : { before: query.before }),
      });

      const responseBody: z.infer<typeof ListSandboxInstancesResponseSchema> = sandboxInstances;

      return ctx.json(responseBody, 200);
    } catch (error) {
      return handleListSandboxInstancesError(ctx, error);
    }
  });

  routes.openapi(getSandboxInstanceRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const sandboxInstance = await ctx.get("services").sandboxInstances.getInstance({
        organizationId: session.session.activeOrganizationId,
        instanceId: params.instanceId,
      });

      return ctx.json(sandboxInstance, 200);
    } catch (error) {
      return handleGetSandboxInstanceError(ctx, error);
    }
  });

  routes.openapi(createSandboxInstanceConnectionTokenRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const connectionToken = await ctx
        .get("services")
        .sandboxInstances.mintConnectionTokenForInstance({
          organizationId: session.session.activeOrganizationId,
          instanceId: params.instanceId,
        });

      return ctx.json(connectionToken, 201);
    } catch (error) {
      return handleMintConnectionTokenError(ctx, error);
    }
  });

  return {
    basePath: SANDBOX_INSTANCES_ROUTE_BASE_PATH,
    routes,
  };
}

function handleMintConnectionTokenError(ctx: AppContext, error: unknown) {
  if (error instanceof SandboxInstancesNotFoundError) {
    const responseBody: z.infer<typeof SandboxInstancesNotFoundResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 404);
  }

  if (error instanceof SandboxInstancesConflictError) {
    const responseBody: z.infer<typeof SandboxInstancesConflictResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 409);
  }

  throw error;
}

function handleListSandboxInstancesError(ctx: AppContext, error: unknown) {
  if (error instanceof SandboxInstancesBadRequestError) {
    const responseBody: z.infer<typeof SandboxInstancesBadRequestResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 400);
  }

  throw error;
}

function handleGetSandboxInstanceError(ctx: AppContext, error: unknown) {
  if (error instanceof SandboxInstancesNotFoundError) {
    const responseBody: z.infer<typeof SandboxInstancesNotFoundResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 404);
  }

  throw error;
}
