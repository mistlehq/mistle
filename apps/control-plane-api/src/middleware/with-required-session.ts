import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";

import type { AppContextBindings, AppSession } from "../types.js";

export function withRequiredSession<R extends RouteConfig>(
  handler: (
    ctx: Parameters<RouteHandler<R, AppContextBindings>>[0],
    session: AppSession,
    next: Parameters<RouteHandler<R, AppContextBindings>>[1],
  ) => ReturnType<RouteHandler<R, AppContextBindings>>,
): RouteHandler<R, AppContextBindings> {
  return (
    ctx: Parameters<RouteHandler<R, AppContextBindings>>[0],
    next: Parameters<RouteHandler<R, AppContextBindings>>[1],
  ) => {
    const session = ctx.get("session");

    if (session === null) {
      throw new Error("Expected authenticated session to be available.");
    }

    return handler(ctx, session, next);
  };
}
