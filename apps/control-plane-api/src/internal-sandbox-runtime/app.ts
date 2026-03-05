import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../internal-integration-credentials/constants.js";
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
  InternalSandboxRuntimeMintConnectionRequestSchema,
  InternalSandboxRuntimeMintConnectionResponseSchema,
  InternalSandboxRuntimeStartProfileInstanceRequestSchema,
  InternalSandboxRuntimeStartProfileInstanceResponseSchema,
} from "./contracts.js";

const InternalSandboxRuntimeErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_REQUEST: "INVALID_REQUEST",
} as const;

export function createInternalSandboxRuntimeApp(): AppRoutes<
  typeof INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();

  routes.post("/start-profile-instance", async (ctx) => {
    const authorizationFailureResponse = resolveAuthorizationFailureResponse(ctx);
    if (authorizationFailureResponse !== null) {
      return authorizationFailureResponse;
    }

    const requestBody = await ctx.req
      .json()
      .catch((): unknown => ({ __parseError: "invalid_json_body" }));
    const parsedInput =
      InternalSandboxRuntimeStartProfileInstanceRequestSchema.safeParse(requestBody);
    if (!parsedInput.success) {
      const responseBody: z.infer<typeof InternalSandboxRuntimeErrorResponseSchema> = {
        code: InternalSandboxRuntimeErrorCodes.INVALID_REQUEST,
        message: "Internal start profile instance request body is invalid.",
      };
      return ctx.json(responseBody, 400);
    }

    try {
      const startedSandboxInstance = await ctx
        .get("services")
        .sandboxProfiles.startProfileInstance({
          organizationId: parsedInput.data.organizationId,
          profileId: parsedInput.data.profileId,
          profileVersion: parsedInput.data.profileVersion,
          startedBy: parsedInput.data.startedBy,
          source: parsedInput.data.source,
          issueConnectionToken: false,
          image: {
            imageId: ctx.get("sandboxConfig").defaultBaseImage,
            kind: "base",
            createdAt: new Date().toISOString(),
          },
        });

      const responseBody: z.infer<typeof InternalSandboxRuntimeStartProfileInstanceResponseSchema> =
        {
          status: startedSandboxInstance.status,
          workflowRunId: startedSandboxInstance.workflowRunId,
          sandboxInstanceId: startedSandboxInstance.sandboxInstanceId,
          providerSandboxId: startedSandboxInstance.providerSandboxId,
        };
      return ctx.json(responseBody, 200);
    } catch (error) {
      return handleInternalSandboxRuntimeError(ctx, error);
    }
  });

  routes.post("/mint-connection-token", async (ctx) => {
    const authorizationFailureResponse = resolveAuthorizationFailureResponse(ctx);
    if (authorizationFailureResponse !== null) {
      return authorizationFailureResponse;
    }

    const requestBody = await ctx.req
      .json()
      .catch((): unknown => ({ __parseError: "invalid_json_body" }));
    const parsedInput = InternalSandboxRuntimeMintConnectionRequestSchema.safeParse(requestBody);
    if (!parsedInput.success) {
      const responseBody: z.infer<typeof InternalSandboxRuntimeErrorResponseSchema> = {
        code: InternalSandboxRuntimeErrorCodes.INVALID_REQUEST,
        message: "Internal mint connection token request body is invalid.",
      };
      return ctx.json(responseBody, 400);
    }

    try {
      const mintedToken = await ctx
        .get("services")
        .sandboxInstances.mintConnectionTokenForInstance({
          organizationId: parsedInput.data.organizationId,
          instanceId: parsedInput.data.instanceId,
        });

      const responseBody: z.infer<typeof InternalSandboxRuntimeMintConnectionResponseSchema> =
        mintedToken;
      return ctx.json(responseBody, 200);
    } catch (error) {
      return handleInternalSandboxRuntimeError(ctx, error);
    }
  });

  return {
    basePath: INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH,
    routes,
  };
}

function resolveAuthorizationFailureResponse(ctx: AppContext) {
  const providedServiceToken = ctx.req.header(CONTROL_PLANE_INTERNAL_AUTH_HEADER);
  if (
    providedServiceToken !== undefined &&
    providedServiceToken === ctx.get("internalAuthServiceToken")
  ) {
    return null;
  }

  const responseBody: z.infer<typeof InternalSandboxRuntimeErrorResponseSchema> = {
    code: InternalSandboxRuntimeErrorCodes.UNAUTHORIZED,
    message: "Internal service authentication failed.",
  };
  return ctx.json(responseBody, 401);
}

function handleInternalSandboxRuntimeError(ctx: AppContext, error: unknown) {
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
