import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../internal-integration-credentials/constants.js";
import { createRequireInternalAuthMiddleware } from "../middleware/require-internal-auth.js";
import {
  SandboxInstancesConflictError,
  SandboxInstancesNotFoundError,
} from "../sandbox-instances/services/factory.js";
import {
  SandboxProfilesCompileError,
  SandboxProfilesNotFoundError,
} from "../sandbox-profiles/services/factory.js";
import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";
import { INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH } from "./constants.js";
import {
  InternalSandboxRuntimeErrorResponseSchema,
  internalSandboxRuntimeGetSandboxInstanceRoute,
  internalSandboxRuntimeMintConnectionTokenRoute,
  internalSandboxRuntimeStartProfileInstanceRoute,
  InternalSandboxRuntimeGetSandboxInstanceResponseSchema,
  InternalSandboxRuntimeMintConnectionResponseSchema,
  InternalSandboxRuntimeStartProfileInstanceResponseSchema,
} from "./contracts.js";

const InternalSandboxRuntimeErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
} as const;

export function createInternalSandboxRuntimeRoutes(): AppRoutes<
  typeof INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();
  routes.use(
    "*",
    createRequireInternalAuthMiddleware({
      headerName: CONTROL_PLANE_INTERNAL_AUTH_HEADER,
      errorCode: InternalSandboxRuntimeErrorCodes.UNAUTHORIZED,
      errorMessage: "Internal service authentication failed.",
    }),
  );

  routes.openapi(internalSandboxRuntimeStartProfileInstanceRoute, async (ctx) => {
    const body = ctx.req.valid("json");

    try {
      const startedSandboxInstance = await ctx
        .get("services")
        .sandboxProfiles.startProfileInstance({
          organizationId: body.organizationId,
          profileId: body.profileId,
          profileVersion: body.profileVersion,
          startedBy: body.startedBy,
          source: body.source,
          image: {
            imageId: ctx.get("sandboxConfig").defaultBaseImage,
            createdAt: new Date().toISOString(),
          },
        });

      const responseBody: z.infer<typeof InternalSandboxRuntimeStartProfileInstanceResponseSchema> =
        {
          status: startedSandboxInstance.status,
          workflowRunId: startedSandboxInstance.workflowRunId,
          sandboxInstanceId: startedSandboxInstance.sandboxInstanceId,
        };
      return ctx.json(responseBody, 200);
    } catch (error) {
      return handleStartProfileInstanceError(ctx, error);
    }
  });

  routes.openapi(internalSandboxRuntimeGetSandboxInstanceRoute, async (ctx) => {
    const body = ctx.req.valid("json");

    try {
      const sandboxInstance = await ctx.get("services").sandboxInstances.getInstance({
        organizationId: body.organizationId,
        instanceId: body.instanceId,
      });

      const responseBody: z.infer<typeof InternalSandboxRuntimeGetSandboxInstanceResponseSchema> =
        sandboxInstance;
      return ctx.json(responseBody, 200);
    } catch (error) {
      return handleSandboxInstanceReadError(ctx, error);
    }
  });

  routes.openapi(internalSandboxRuntimeMintConnectionTokenRoute, async (ctx) => {
    const body = ctx.req.valid("json");

    try {
      const mintedToken = await ctx
        .get("services")
        .sandboxInstances.mintConnectionTokenForInstance({
          organizationId: body.organizationId,
          instanceId: body.instanceId,
        });

      const responseBody: z.infer<typeof InternalSandboxRuntimeMintConnectionResponseSchema> =
        mintedToken;
      return ctx.json(responseBody, 200);
    } catch (error) {
      return handleMintConnectionError(ctx, error);
    }
  });

  return {
    basePath: INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH,
    routes,
  };
}

function handleStartProfileInstanceError(ctx: AppContext, error: unknown) {
  if (error instanceof SandboxProfilesCompileError) {
    const responseBody: z.infer<typeof InternalSandboxRuntimeErrorResponseSchema> = {
      code: error.code,
      message: error.message,
    };
    return ctx.json(responseBody, 400);
  }

  if (error instanceof SandboxProfilesNotFoundError) {
    const responseBody: z.infer<typeof InternalSandboxRuntimeErrorResponseSchema> = {
      code: error.code,
      message: error.message,
    };
    return ctx.json(responseBody, 404);
  }

  throw error;
}

function handleSandboxInstanceReadError(ctx: AppContext, error: unknown) {
  if (error instanceof SandboxInstancesNotFoundError) {
    const responseBody: z.infer<typeof InternalSandboxRuntimeErrorResponseSchema> = {
      code: error.code,
      message: error.message,
    };
    return ctx.json(responseBody, 404);
  }

  throw error;
}

function handleMintConnectionError(ctx: AppContext, error: unknown) {
  if (error instanceof SandboxInstancesNotFoundError) {
    const responseBody: z.infer<typeof InternalSandboxRuntimeErrorResponseSchema> = {
      code: error.code,
      message: error.message,
    };
    return ctx.json(responseBody, 404);
  }

  if (error instanceof SandboxInstancesConflictError) {
    const responseBody: z.infer<typeof InternalSandboxRuntimeErrorResponseSchema> = {
      code: error.code,
      message: error.message,
    };
    return ctx.json(responseBody, 409);
  }

  throw error;
}
