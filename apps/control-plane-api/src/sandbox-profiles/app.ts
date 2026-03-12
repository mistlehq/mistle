import { OpenAPIHono, z } from "@hono/zod-openapi";

import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";
import { SANDBOX_PROFILES_ROUTE_BASE_PATH } from "./constants.js";
import {
  PutSandboxProfileVersionIntegrationBindingsBadRequestResponseSchema,
  SandboxProfileVersionNotFoundResponseSchema,
  StartSandboxProfileInstanceBadRequestResponseSchema,
  BadRequestResponseSchema,
  createSandboxProfileRoute,
  deleteSandboxProfileRoute,
  getSandboxProfileVersionIntegrationBindingsRoute,
  getSandboxProfileRoute,
  listSandboxProfileVersionsRoute,
  listSandboxProfilesRoute,
  NotFoundResponseSchema,
  StartSandboxProfileInstanceNotFoundResponseSchema,
  putSandboxProfileVersionIntegrationBindingsRoute,
  startSandboxProfileInstanceRoute,
  updateSandboxProfileRoute,
} from "./contracts.js";
import {
  SandboxProfilesBadRequestError,
  SandboxProfilesCompileError,
  SandboxProfilesIntegrationBindingsBadRequestCodes,
  SandboxProfilesIntegrationBindingsBadRequestError,
  SandboxProfilesNotFoundError,
  SandboxProfilesNotFoundCodes,
} from "./services/factory.js";

export function createSandboxProfilesApp(): AppRoutes<typeof SANDBOX_PROFILES_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>();

  routes.openapi(listSandboxProfilesRoute, async (ctx) => {
    try {
      const query = ctx.req.valid("query");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }
      const result = await ctx.get("services").sandboxProfiles.listProfiles({
        ...query,
        organizationId: session.session.activeOrganizationId,
      });
      return ctx.json(result, 200);
    } catch (error) {
      return handleListProfilesError(ctx, error);
    }
  });

  routes.openapi(createSandboxProfileRoute, async (ctx) => {
    const body = ctx.req.valid("json");
    const session = ctx.get("session");
    if (session === null) {
      throw new Error("Expected authenticated session to be available.");
    }
    const createProfileInput = {
      ...body,
      organizationId: session.session.activeOrganizationId,
    };

    const profile = await ctx.get("services").sandboxProfiles.createProfile(createProfileInput);
    return ctx.json(profile, 201);
  });

  routes.openapi(getSandboxProfileRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }
      const profile = await ctx.get("services").sandboxProfiles.getProfile({
        organizationId: session.session.activeOrganizationId,
        profileId: params.profileId,
      });
      return ctx.json(profile, 200);
    } catch (error) {
      return handleProfileNotFoundError(ctx, error);
    }
  });

  routes.openapi(updateSandboxProfileRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const body = ctx.req.valid("json");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const updateInput = {
        ...body,
        organizationId: session.session.activeOrganizationId,
        profileId: params.profileId,
      };

      const profile = await ctx.get("services").sandboxProfiles.updateProfile(updateInput);
      return ctx.json(profile, 200);
    } catch (error) {
      return handleProfileNotFoundError(ctx, error);
    }
  });

  routes.openapi(deleteSandboxProfileRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }
      const deletionRequest = await ctx.get("services").sandboxProfiles.requestDeleteProfile({
        organizationId: session.session.activeOrganizationId,
        profileId: params.profileId,
      });

      const acceptedResponse = {
        status: "accepted",
        profileId: deletionRequest.profileId,
      } as const;

      return ctx.json(acceptedResponse, 202);
    } catch (error) {
      return handleProfileNotFoundError(ctx, error);
    }
  });

  routes.openapi(listSandboxProfileVersionsRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const versions = await ctx.get("services").sandboxProfiles.listProfileVersions({
        organizationId: session.session.activeOrganizationId,
        profileId: params.profileId,
      });

      return ctx.json(versions, 200);
    } catch (error) {
      return handleProfileNotFoundError(ctx, error);
    }
  });

  routes.openapi(getSandboxProfileVersionIntegrationBindingsRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const bindings = await ctx
        .get("services")
        .sandboxProfiles.getProfileVersionIntegrationBindings({
          organizationId: session.session.activeOrganizationId,
          profileId: params.profileId,
          profileVersion: params.version,
        });

      return ctx.json(bindings, 200);
    } catch (error) {
      return handleSandboxProfileVersionNotFoundError(ctx, error);
    }
  });

  routes.openapi(putSandboxProfileVersionIntegrationBindingsRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const body = ctx.req.valid("json");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const normalizedBindings = body.bindings.map((binding) => {
        if (binding.id === undefined) {
          return {
            ...(binding.clientRef === undefined ? {} : { clientRef: binding.clientRef }),
            connectionId: binding.connectionId,
            kind: binding.kind,
            config: binding.config,
          };
        }

        return {
          id: binding.id,
          ...(binding.clientRef === undefined ? {} : { clientRef: binding.clientRef }),
          connectionId: binding.connectionId,
          kind: binding.kind,
          config: binding.config,
        };
      });

      const updatedBindings = await ctx
        .get("services")
        .sandboxProfiles.putProfileVersionIntegrationBindings({
          organizationId: session.session.activeOrganizationId,
          profileId: params.profileId,
          profileVersion: params.version,
          bindings: normalizedBindings,
        });

      return ctx.json(updatedBindings, 200);
    } catch (error) {
      return handlePutIntegrationBindingsError(ctx, error);
    }
  });

  routes.openapi(startSandboxProfileInstanceRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const body = ctx.req.valid("json");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }

      const startedSandboxInstance = await ctx
        .get("services")
        .sandboxProfiles.startProfileInstance({
          organizationId: session.session.activeOrganizationId,
          profileId: params.profileId,
          profileVersion: params.version,
          startedBy: {
            kind: "user",
            id: session.user.id,
          },
          source: "dashboard",
          ...(body.idempotencyKey === undefined
            ? {}
            : {
                idempotencyKey: body.idempotencyKey,
              }),
          image: {
            imageId: ctx.get("sandboxConfig").defaultBaseImage,
            kind: "base",
            createdAt: new Date().toISOString(),
          },
        });

      return ctx.json(startedSandboxInstance, 201);
    } catch (error) {
      return handleStartInstanceError(ctx, error);
    }
  });

  return {
    basePath: SANDBOX_PROFILES_ROUTE_BASE_PATH,
    routes,
  };
}

function handleListProfilesError(ctx: AppContext, error: unknown) {
  if (error instanceof SandboxProfilesBadRequestError) {
    const responseBody: z.infer<typeof BadRequestResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 400);
  }

  throw error;
}

function handleProfileNotFoundError(ctx: AppContext, error: unknown) {
  if (error instanceof SandboxProfilesNotFoundError) {
    if (error.code !== SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND) {
      throw error;
    }

    const responseBody: z.infer<typeof NotFoundResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 404);
  }

  throw error;
}

function handleStartInstanceError(ctx: AppContext, error: unknown) {
  if (error instanceof SandboxProfilesCompileError) {
    const responseBody: z.infer<typeof StartSandboxProfileInstanceBadRequestResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 400);
  }

  if (error instanceof SandboxProfilesNotFoundError) {
    const responseBody: z.infer<typeof StartSandboxProfileInstanceNotFoundResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 404);
  }

  throw error;
}

function handleSandboxProfileVersionNotFoundError(ctx: AppContext, error: unknown) {
  if (error instanceof SandboxProfilesNotFoundError) {
    const responseBody: z.infer<typeof SandboxProfileVersionNotFoundResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 404);
  }

  throw error;
}

function handlePutIntegrationBindingsError(ctx: AppContext, error: unknown) {
  if (error instanceof SandboxProfilesIntegrationBindingsBadRequestError) {
    if (
      error.code ===
      SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONFIG_REFERENCE
    ) {
      if (error.details === undefined) {
        throw new Error("Expected validation details for invalid binding config reference.");
      }
      const responseBody: z.infer<
        typeof PutSandboxProfileVersionIntegrationBindingsBadRequestResponseSchema
      > = {
        code: error.code,
        message: error.message,
        details: {
          issues: error.details.issues.map((issue) => ({
            ...(issue.clientRef === undefined ? {} : { clientRef: issue.clientRef }),
            bindingIdOrDraftIndex: issue.bindingIdOrDraftIndex,
            validatorCode: issue.validatorCode,
            field: issue.field,
            safeMessage: issue.safeMessage,
          })),
        },
      };
      return ctx.json(responseBody, 400);
    }

    const responseBody: z.infer<
      typeof PutSandboxProfileVersionIntegrationBindingsBadRequestResponseSchema
    > = {
      code: error.code,
      message: error.message,
    };
    return ctx.json(responseBody, 400);
  }

  if (error instanceof SandboxProfilesNotFoundError) {
    const responseBody: z.infer<typeof SandboxProfileVersionNotFoundResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 404);
  }

  throw error;
}
