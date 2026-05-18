import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings, AppOrganizationActor } from "../types.js";

export function withRequiredOrganizationActor<R extends RouteConfig>(
  handler: (
    ctx: Parameters<RouteHandler<R, AppContextBindings>>[0],
    organizationActor: AppOrganizationActor,
    next: Parameters<RouteHandler<R, AppContextBindings>>[1],
  ) => ReturnType<RouteHandler<R, AppContextBindings>>,
): RouteHandler<R, AppContextBindings> {
  return (
    ctx: Parameters<RouteHandler<R, AppContextBindings>>[0],
    next: Parameters<RouteHandler<R, AppContextBindings>>[1],
  ) => {
    const organizationActor = ctx.get("organizationActor");

    if (organizationActor === null) {
      throw new Error("Expected organization actor to be available.");
    }

    return handler(ctx, organizationActor, next);
  };
}
