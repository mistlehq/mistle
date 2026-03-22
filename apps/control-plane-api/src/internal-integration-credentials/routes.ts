import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { createRequireInternalAuthMiddleware } from "../middleware/require-internal-auth.js";
import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";
import {
  CONTROL_PLANE_INTERNAL_AUTH_HEADER,
  INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH,
} from "./constants.js";
import {
  InternalIntegrationCredentialErrorResponseSchema,
  InternalIntegrationCredentialUnauthorizedResponseSchema,
  resolveIntegrationCredentialRoute,
  resolveIntegrationTargetSecretsRoute,
  ResolveIntegrationCredentialRequestSchema,
  ResolveIntegrationCredentialResponseSchema,
  ResolveIntegrationTargetSecretsRequestSchema,
  ResolveIntegrationTargetSecretsResponseSchema,
} from "./contracts.js";
import {
  InternalIntegrationCredentialsError,
  InternalIntegrationCredentialsErrorCodes,
} from "./services/errors.js";
import { resolveIntegrationCredential } from "./services/resolve-credential.js";
import { resolveInternalIntegrationTargetSecrets } from "./services/resolve-target-secrets.js";

export function createInternalIntegrationCredentialsRoutes(): AppRoutes<
  typeof INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();
  routes.use(
    "*",
    createRequireInternalAuthMiddleware({
      headerName: CONTROL_PLANE_INTERNAL_AUTH_HEADER,
      errorCode: InternalIntegrationCredentialsErrorCodes.UNAUTHORIZED,
      errorMessage: "Internal service authentication failed.",
    }),
  );

  routes.openapi(resolveIntegrationCredentialRoute, async (ctx) => {
    const requestBody = await ctx.req
      .json()
      .catch((): unknown => ({ __parseError: "invalid_json_body" }));
    const parsedInput = ResolveIntegrationCredentialRequestSchema.safeParse(requestBody);
    if (!parsedInput.success) {
      const responseBody: z.infer<typeof InternalIntegrationCredentialErrorResponseSchema> = {
        code: InternalIntegrationCredentialsErrorCodes.INVALID_RESOLVE_INPUT,
        message: "Credential resolve request body is invalid.",
      };
      return ctx.json(responseBody, 400);
    }

    try {
      const resolvedCredential = await resolveIntegrationCredential(
        ctx.get("db"),
        ctx.get("integrationRegistry"),
        ctx.get("config").integrations,
        {
          connectionId: parsedInput.data.connectionId,
          secretType: parsedInput.data.secretType,
          ...(parsedInput.data.bindingId === undefined
            ? {}
            : { bindingId: parsedInput.data.bindingId }),
          ...(parsedInput.data.purpose === undefined ? {} : { purpose: parsedInput.data.purpose }),
          ...(parsedInput.data.resolverKey === undefined
            ? {}
            : { resolverKey: parsedInput.data.resolverKey }),
        },
      );

      const responseBody: z.infer<typeof ResolveIntegrationCredentialResponseSchema> = {
        value: resolvedCredential.value,
        ...(resolvedCredential.expiresAt === undefined
          ? {}
          : { expiresAt: resolvedCredential.expiresAt }),
      };
      return ctx.json(responseBody, 200);
    } catch (error) {
      return handleResolveIntegrationCredentialError(ctx, error);
    }
  });

  routes.openapi(resolveIntegrationTargetSecretsRoute, async (ctx) => {
    const requestBody = await ctx.req
      .json()
      .catch((): unknown => ({ __parseError: "invalid_json_body" }));
    const parsedInput = ResolveIntegrationTargetSecretsRequestSchema.safeParse(requestBody);
    if (!parsedInput.success) {
      const responseBody: z.infer<typeof InternalIntegrationCredentialErrorResponseSchema> = {
        code: InternalIntegrationCredentialsErrorCodes.INVALID_RESOLVE_INPUT,
        message: "Target secrets resolve request body is invalid.",
      };
      return ctx.json(responseBody, 400);
    }

    try {
      const resolvedTargetSecrets = resolveInternalIntegrationTargetSecrets(
        ctx.get("config").integrations,
        parsedInput.data,
      );
      const responseBody: z.infer<typeof ResolveIntegrationTargetSecretsResponseSchema> =
        resolvedTargetSecrets;
      return ctx.json(responseBody, 200);
    } catch (error) {
      return handleResolveTargetSecretsError(ctx, error);
    }
  });

  return {
    basePath: INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH,
    routes,
  };
}

function handleResolveIntegrationCredentialError(ctx: AppContext, error: unknown) {
  if (error instanceof InternalIntegrationCredentialsError) {
    if (error.statusCode === 401) {
      const unauthorizedResponseBody: z.infer<
        typeof InternalIntegrationCredentialUnauthorizedResponseSchema
      > = {
        code: InternalIntegrationCredentialsErrorCodes.UNAUTHORIZED,
        message: error.message,
      };
      return ctx.json(unauthorizedResponseBody, 401);
    }

    const responseBody: z.infer<typeof InternalIntegrationCredentialErrorResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, error.statusCode);
  }

  throw error;
}

function handleResolveTargetSecretsError(ctx: AppContext, error: unknown) {
  if (error instanceof InternalIntegrationCredentialsError) {
    if (error.statusCode === 401) {
      const unauthorizedResponseBody: z.infer<
        typeof InternalIntegrationCredentialUnauthorizedResponseSchema
      > = {
        code: InternalIntegrationCredentialsErrorCodes.UNAUTHORIZED,
        message: error.message,
      };
      return ctx.json(unauthorizedResponseBody, 401);
    }

    const responseBody: z.infer<typeof InternalIntegrationCredentialErrorResponseSchema> = {
      code: error.code,
      message: error.message,
    };
    return ctx.json(responseBody, 400);
  }

  throw error;
}
