import { z, type RouteHandler } from "@hono/zod-openapi";
import { withHttpErrorHandler } from "@mistle/http/errors.js";

import { withRequiredSession } from "../../middleware/with-required-session.js";
import type { AppContextBindings, AppSession } from "../../types.js";
import {
  SandboxProfilesBadRequestCodes,
  SandboxProfilesBadRequestError,
  SandboxProfilesIntegrationBindingsBadRequestCodes,
  SandboxProfilesIntegrationBindingsBadRequestError,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { putProfileVersionDraft } from "../services/put-profile-version-draft.js";
import { route } from "./route.js";
import { badRequestResponseSchema, notFoundResponseSchema } from "./schema.js";

const routeHandler = async (
  ctx: Parameters<RouteHandler<typeof route, AppContextBindings>>[0],
  { session }: AppSession,
) => {
  const db = ctx.get("db");
  const integrationRegistry = ctx.get("integrationRegistry");
  const sandboxConfig = ctx.get("sandboxConfig");
  const { profileId, version } = ctx.req.valid("param");
  const body = ctx.req.valid("json");

  try {
    const updatedDraft = await putProfileVersionDraft(
      { db, integrationRegistry, sandboxConfig },
      {
        organizationId: session.activeOrganizationId,
        profileId,
        profileVersion: version,
        ...(body.setupScript === undefined ? {} : { setupScript: body.setupScript }),
        ...(body.defaultPersistenceMode === undefined
          ? {}
          : { defaultPersistenceMode: body.defaultPersistenceMode }),
        ...(body.agentRuntimeId === undefined ? {} : { agentRuntimeId: body.agentRuntimeId }),
        ...(body.sandboxProvider === undefined ? {} : { sandboxProvider: body.sandboxProvider }),
        ...(body.sandboxConnectionId === undefined
          ? {}
          : { sandboxConnectionId: body.sandboxConnectionId }),
        ...(body.sandboxResources === undefined ? {} : { sandboxResources: body.sandboxResources }),
        ...(body.integrationBindings === undefined
          ? {}
          : {
              integrationBindings: {
                bindings: body.integrationBindings.bindings.map((binding) => ({
                  ...(binding.id === undefined ? {} : { id: binding.id }),
                  ...(binding.clientRef === undefined ? {} : { clientRef: binding.clientRef }),
                  connectionId: binding.connectionId,
                  kind: binding.kind,
                  config: binding.config,
                })),
              },
            }),
      },
    );

    return ctx.json(updatedDraft, 200);
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
      const responseBody: z.infer<typeof badRequestResponseSchema> = {
        code: error.code,
        message: error.message,
      };

      return ctx.json(responseBody, 400);
    }

    if (error instanceof SandboxProfilesBadRequestError) {
      const responseBody: z.infer<typeof badRequestResponseSchema> = {
        code: SandboxProfilesBadRequestCodes.INVALID_SANDBOX_RUNTIME_CONFIG,
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

export const handler: RouteHandler<typeof route, AppContextBindings> = withHttpErrorHandler(
  withRequiredSession(routeHandler),
);
