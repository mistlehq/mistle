import { z, type RouteHandler } from "@hono/zod-openapi";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import {
  SandboxProfilesIntegrationBindingsBadRequestCodes,
  SandboxProfilesIntegrationBindingsBadRequestError,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { putProfileVersionIntegrationBindings } from "../services/put-profile-version-integration-bindings.js";
import { route } from "./route.js";
import { badRequestResponseSchema, notFoundResponseSchema } from "./schema.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const { profileId, version } = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  try {
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

    const updatedBindings = await putProfileVersionIntegrationBindings(
      {
        db,
      },
      {
        organizationId: session.activeOrganizationId,
        profileId,
        profileVersion: version,
        bindings: normalizedBindings,
      },
    );

    return ctx.json(updatedBindings, 200);
  } catch (error) {
    if (
      error instanceof SandboxProfilesIntegrationBindingsBadRequestError &&
      error.code ===
        SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONFIG_REFERENCE
    ) {
      if (error.details === undefined) {
        throw new Error("Expected validation details for invalid binding config reference.");
      }

      const responseBody: z.infer<typeof badRequestResponseSchema> = {
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

    if (error instanceof SandboxProfilesIntegrationBindingsBadRequestError) {
      if (
        error.code ===
        SandboxProfilesIntegrationBindingsBadRequestCodes.INVALID_BINDING_CONFIG_REFERENCE
      ) {
        throw new Error("Expected detailed invalid binding config errors to be handled earlier.");
      }

      const responseBody: z.infer<typeof badRequestResponseSchema> = {
        code: error.code,
        message: error.message,
      };

      return ctx.json(responseBody, 400);
    }

    if (error instanceof SandboxProfilesNotFoundError) {
      const responseBody: z.infer<typeof notFoundResponseSchema> = {
        code: error.code,
        message: error.message,
      };

      return ctx.json(responseBody, 404);
    }

    throw error;
  }
};

export const handler: RouteHandler<typeof route, AppContextBindings> =
  withRequiredSession(routeHandler);
