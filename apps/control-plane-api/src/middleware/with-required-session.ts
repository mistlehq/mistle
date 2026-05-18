import type { RouteConfig, RouteHandler } from "@hono/zod-openapi";
import { ForbiddenError, UnauthorizedError } from "@mistle/http/errors.js";

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
      const authContext = ctx.get("authContext");
      if (authContext?.kind === "api_key") {
        throw new ForbiddenError("FORBIDDEN", "Forbidden API request.");
      }

      throw new UnauthorizedError("UNAUTHORIZED", "Unauthorized API request.");
    }

    return handler(ctx, session, next);
  };
}
