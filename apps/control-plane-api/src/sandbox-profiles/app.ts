import { OpenAPIHono, z } from "@hono/zod-openapi";

import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";

import { SANDBOX_PROFILES_ROUTE_BASE_PATH } from "./constants.js";
import {
  createSandboxProfileRoute,
  BadRequestResponseSchema,
  deleteSandboxProfileRoute,
  getSandboxProfileRoute,
  listSandboxProfilesRoute,
  NotFoundResponseSchema,
  updateSandboxProfileRoute,
} from "./contracts.js";
import {
  SandboxProfilesBadRequestError,
  SandboxProfilesNotFoundError,
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
      return handleNotFoundError(ctx, error);
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
      return handleNotFoundError(ctx, error);
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
      return handleNotFoundError(ctx, error);
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

function handleNotFoundError(ctx: AppContext, error: unknown) {
  if (error instanceof SandboxProfilesNotFoundError) {
    const responseBody: z.infer<typeof NotFoundResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 404);
  }

  throw error;
}
