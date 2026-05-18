import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import { ForbiddenError } from "@mistle/http/errors.js";

import type { OrganizationPermission } from "../auth/services/organization-policy.js";
import type { AppContextBindings, AppOrganizationActor } from "../types.js";

type WithRequiredOrganizationActorOptions = {
  permission?: OrganizationPermission;
};

export function withRequiredOrganizationActor<R extends RouteConfig>(
  handler: (
    ctx: Parameters<RouteHandler<R, AppContextBindings>>[0],
    organizationActor: AppOrganizationActor,
    next: Parameters<RouteHandler<R, AppContextBindings>>[1],
  ) => ReturnType<RouteHandler<R, AppContextBindings>>,
  options: WithRequiredOrganizationActorOptions = {},
): RouteHandler<R, AppContextBindings> {
  return (
    ctx: Parameters<RouteHandler<R, AppContextBindings>>[0],
    next: Parameters<RouteHandler<R, AppContextBindings>>[1],
  ) => {
    const organizationActor = ctx.get("organizationActor");

    if (organizationActor === null) {
      throw new Error("Expected organization actor to be available.");
    }

    if (
      options.permission !== undefined &&
      !organizationActor.permissions.includes(options.permission)
    ) {
      throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
    }

    return handler(ctx, organizationActor, next);
  };
}
