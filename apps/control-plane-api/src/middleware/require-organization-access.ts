import { ForbiddenError, handleHttpError } from "@mistle/http/errors.js";
import type { MiddlewareHandler } from "hono";

import { requireActiveOrganizationAccess } from "../auth/services/organization-authorization.js";
import type { OrganizationPermission } from "../auth/services/organization-policy.js";
import type { AppContextBindings, AppOrganizationActor } from "../types.js";

type RequireOrganizationAccessOptions = {
  permission?: OrganizationPermission;
};

export function createRequireOrganizationAccessMiddleware(
  options: RequireOrganizationAccessOptions = {},
): MiddlewareHandler<AppContextBindings> {
  return async (ctx, next) => {
    const authContext = ctx.get("authContext");

    if (authContext === null) {
      throw new Error("Expected authenticated request context to be available.");
    }

    try {
      const organizationActor = await resolveOrganizationActor({
        authContext,
        db: ctx.get("db"),
      });

      if (
        options.permission !== undefined &&
        !organizationActor.permissions.includes(options.permission)
      ) {
        throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
      }

      ctx.set("organizationActor", organizationActor);
    } catch (error) {
      return handleHttpError(ctx, error);
    }

    await next();
  };
}

async function resolveOrganizationActor(input: {
  authContext: NonNullable<AppContextBindings["Variables"]["authContext"]>;
  db: AppContextBindings["Variables"]["db"];
}): Promise<AppOrganizationActor> {
  if (input.authContext.kind === "api_key") {
    return {
      kind: "api_key",
      apiKeyId: input.authContext.apiKey.id,
      name: input.authContext.apiKey.name,
      organizationId: input.authContext.apiKey.organizationId,
      permissions: input.authContext.permissions,
    };
  }

  if (input.authContext.kind === "mcp_capability") {
    return {
      kind: "mcp_capability",
      organizationId: input.authContext.organizationId,
      capability: input.authContext.capability,
      permissions: input.authContext.permissions,
    };
  }

  if (input.authContext.kind === "oauth") {
    return {
      kind: "oauth",
      grantId: input.authContext.oauth.grantId,
      userId: input.authContext.oauth.userId,
      organizationId: input.authContext.oauth.organizationId,
      permissions: input.authContext.permissions,
    };
  }

  const authorization = await requireActiveOrganizationAccess({
    db: input.db,
    actorUserId: input.authContext.session.user.id,
    activeOrganizationId: input.authContext.session.activeOrganizationId,
  });

  return {
    kind: "user",
    userId: input.authContext.session.user.id,
    sessionId: input.authContext.session.session.id,
    organizationId: input.authContext.session.activeOrganizationId,
    permissions: authorization.permissions,
  };
}
