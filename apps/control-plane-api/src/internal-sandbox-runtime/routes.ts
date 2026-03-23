import { OpenAPIHono, z } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../internal-integration-credentials/constants.js";
import { createRequireInternalAuthMiddleware } from "../middleware/require-internal-auth.js";
import { SANDBOX_INSTANCE_CONNECTION_TOKEN_TTL_SECONDS } from "../sandbox-instances/constants.js";
import {
  SandboxInstancesConflictError,
  SandboxInstancesNotFoundError,
} from "../sandbox-instances/index.js";
import { getInstance } from "../sandbox-instances/services/get-instance.js";
import { mintConnectionTokenForInstance } from "../sandbox-instances/services/mint-connection-token-for-instance.js";
import {
  SandboxProfilesCompileError,
  SandboxProfilesNotFoundError,
} from "../sandbox-profiles/index.js";
import { startProfileInstance } from "../sandbox-profiles/services/start-profile-instance.js";
import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";
import { INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH } from "./constants.js";
import {
  InternalSandboxRuntimeErrorResponseSchema,
  internalSandboxRuntimeGetSandboxInstanceRoute,
  internalSandboxRuntimeMintConnectionTokenRoute,
  internalSandboxRuntimeStartProfileInstanceRoute,
} from "./contracts.js";

const InternalSandboxRuntimeErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
} as const;

export function createInternalSandboxRuntimeRoutes(): AppRoutes<
  typeof INTERNAL_SANDBOX_RUNTIME_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });
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
    const db = ctx.get("db");
    const dataPlaneClient = ctx.get("dataPlaneClient");
    const integrationsConfig = ctx.get("config").integrations;
    const sandboxConfig = ctx.get("sandboxConfig");

    try {
      const startedSandboxInstance = await startProfileInstance(
        {
          db,
          integrationsConfig,
          dataPlaneClient,
        },
        {
          organizationId: body.organizationId,
          profileId: body.profileId,
          profileVersion: body.profileVersion,
          startedBy: body.startedBy,
          source: body.source,
          image: {
            imageId: sandboxConfig.defaultBaseImage,
            createdAt: new Date().toISOString(),
          },
        },
      );

      return ctx.json(startedSandboxInstance, 200);
    } catch (error) {
      return handleStartProfileInstanceError(ctx, error);
    }
  });

  routes.openapi(internalSandboxRuntimeGetSandboxInstanceRoute, async (ctx) => {
    const body = ctx.req.valid("json");
    const db = ctx.get("db");
    const dataPlaneClient = ctx.get("dataPlaneClient");

    try {
      const sandboxInstance = await getInstance(
        {
          db,
          dataPlaneClient,
        },
        {
          organizationId: body.organizationId,
          instanceId: body.instanceId,
        },
      );

      return ctx.json(sandboxInstance, 200);
    } catch (error) {
      return handleSandboxInstanceReadError(ctx, error);
    }
  });

  routes.openapi(internalSandboxRuntimeMintConnectionTokenRoute, async (ctx) => {
    const body = ctx.req.valid("json");
    const dataPlaneClient = ctx.get("dataPlaneClient");
    const sandboxConfig = ctx.get("sandboxConfig");
    const connectionTokenConfig = ctx.get("connectionTokenConfig");

    try {
      const mintedToken = await mintConnectionTokenForInstance(
        {
          dataPlaneClient,
          defaultConnectionToken: {
            gatewayWebsocketUrl: sandboxConfig.gatewayWsUrl,
            tokenTtlSeconds: SANDBOX_INSTANCE_CONNECTION_TOKEN_TTL_SECONDS,
            tokenConfig: {
              connectionTokenSecret: connectionTokenConfig.secret,
              tokenIssuer: connectionTokenConfig.issuer,
              tokenAudience: connectionTokenConfig.audience,
            },
          },
        },
        {
          organizationId: body.organizationId,
          instanceId: body.instanceId,
        },
      );

      return ctx.json(mintedToken, 200);
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
