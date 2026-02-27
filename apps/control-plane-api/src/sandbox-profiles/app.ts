import { OpenAPIHono, z } from "@hono/zod-openapi";
import { StartSandboxInstanceInputSchema } from "@mistle/data-plane-trpc/contracts";
import { SandboxInstanceSources, SandboxInstanceStarterKinds } from "@mistle/db/data-plane";

import type { AppContext, AppContextBindings, AppRoutes } from "../types.js";

import { SANDBOX_PROFILES_ROUTE_BASE_PATH } from "./constants.js";
import {
  createSandboxProfileRoute,
  BadRequestResponseSchema,
  deleteSandboxProfileRoute,
  getSandboxProfileRoute,
  listSandboxProfilesRoute,
  NotFoundResponseSchema,
  StartSandboxProfileInstanceNotFoundResponseSchema,
  startSandboxProfileInstanceRoute,
  updateSandboxProfileRoute,
} from "./contracts.js";
import {
  SandboxProfilesBadRequestError,
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

  routes.openapi(startSandboxProfileInstanceRoute, async (ctx) => {
    try {
      const params = ctx.req.valid("param");
      const session = ctx.get("session");
      if (session === null) {
        throw new Error("Expected authenticated session to be available.");
      }
      const resolvedImage = await resolveSandboxProfileVersionImage({
        db: ctx.get("db"),
        organizationId: session.session.activeOrganizationId,
        profileId: params.profileId,
        profileVersion: params.version,
      });

      const startedSandboxInstance = await ctx
        .get("services")
        .sandboxProfiles.startProfileInstance({
          organizationId: session.session.activeOrganizationId,
          profileId: params.profileId,
          profileVersion: params.version,
          startedBy: {
            kind: SandboxInstanceStarterKinds.USER,
            id: session.user.id,
          },
          source: SandboxInstanceSources.DASHBOARD,
          image: resolvedImage,
        });

      return ctx.json(startedSandboxInstance, 201);
    } catch (error) {
      return handleStartInstanceNotFoundError(ctx, error);
    }
  });

  return {
    basePath: SANDBOX_PROFILES_ROUTE_BASE_PATH,
    routes,
  };
}

async function resolveSandboxProfileVersionImage(input: {
  db: AppContext["var"]["db"];
  organizationId: string;
  profileId: string;
  profileVersion: number;
}): Promise<ReturnType<typeof StartSandboxInstanceInputSchema.shape.image.parse>> {
  const sandboxProfile = await input.db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.id, input.profileId), eq(table.organizationId, input.organizationId)),
  });

  if (sandboxProfile === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  const sandboxProfileVersion = await input.db.query.sandboxProfileVersions.findFirst({
    columns: {
      manifest: true,
    },
    where: (table, { and, eq }) =>
      and(eq(table.sandboxProfileId, input.profileId), eq(table.version, input.profileVersion)),
  });

  if (sandboxProfileVersion === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
      "Sandbox profile version was not found.",
    );
  }

  const parsedManifest = StartSandboxInstanceInputSchema.shape.manifest.safeParse(
    sandboxProfileVersion.manifest,
  );
  if (!parsedManifest.success) {
    throw new Error("Sandbox profile version manifest is invalid.");
  }

  const parsedImage = StartSandboxInstanceInputSchema.shape.image.safeParse(
    parsedManifest.data.image,
  );
  if (!parsedImage.success) {
    throw new Error("Sandbox profile version image is invalid.");
  }

  return parsedImage.data;
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

function handleStartInstanceNotFoundError(ctx: AppContext, error: unknown) {
  if (error instanceof SandboxProfilesNotFoundError) {
    const responseBody: z.infer<typeof StartSandboxProfileInstanceNotFoundResponseSchema> = {
      code: error.code,
      message: error.message,
    };

    return ctx.json(responseBody, 404);
  }

  throw error;
}
