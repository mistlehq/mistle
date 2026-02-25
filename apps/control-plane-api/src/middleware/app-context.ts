import type { MiddlewareHandler } from "hono";

import type { AppContextBindings, AppContextVariables } from "../types.js";

export function createAppContextMiddleware(
  appContext: AppContextVariables,
): MiddlewareHandler<AppContextBindings> {
  return async (ctx, next) => {
    ctx.set("config", appContext.config);
    ctx.set("db", appContext.db);
    ctx.set("services", appContext.services);
    await next();
  };
}
