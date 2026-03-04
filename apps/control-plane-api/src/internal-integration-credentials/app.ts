import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";
import {
  CONTROL_PLANE_INTERNAL_AUTH_HEADER,
  INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH,
} from "./constants.js";
import {
  InternalIntegrationCredentialErrorResponseSchema,
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

export function createInternalIntegrationCredentialsApp(): AppRoutes<
  typeof INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>();

  routes.post("/resolve", async (ctx) => {
    const authorizationFailureResponse = resolveAuthorizationFailureResponse(ctx);
    if (authorizationFailureResponse !== null) {
      return authorizationFailureResponse;
    }

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
        parsedInput.data,
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

  routes.post("/resolve-target-secrets", async (ctx) => {
    const authorizationFailureResponse = resolveAuthorizationFailureResponse(ctx);
    if (authorizationFailureResponse !== null) {
      return authorizationFailureResponse;
    }

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
      return handleResolveIntegrationCredentialError(ctx, error);
    }
  });

  return {
    basePath: INTERNAL_INTEGRATION_CREDENTIALS_ROUTE_BASE_PATH,
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

  const responseBody: z.infer<typeof InternalIntegrationCredentialErrorResponseSchema> = {
    code: InternalIntegrationCredentialsErrorCodes.UNAUTHORIZED,
    message: "Internal service authentication failed.",
  };
  return ctx.json(responseBody, 401);
}

function handleResolveIntegrationCredentialError(ctx: AppContext, error: unknown) {
  if (error instanceof InternalIntegrationCredentialsError) {
    const responseBody: z.infer<typeof InternalIntegrationCredentialErrorResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, error.statusCode);
  }

  throw error;
}
