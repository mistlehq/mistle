import type { MiddlewareHandler } from "hono";

import type { AppContextBindings, AppContextVariables } from "../types.js";

type CreateAppContextInput = Omit<AppContextVariables, "session">;

export function createAppContextMiddleware(
  appContext: CreateAppContextInput,
): MiddlewareHandler<AppContextBindings> {
  return async (ctx, next) => {
    ctx.set("config", appContext.config);
    ctx.set("sandboxConfig", appContext.sandboxConfig);
    ctx.set("internalAuthServiceToken", appContext.internalAuthServiceToken);
    ctx.set("db", appContext.db);
    ctx.set("integrationRegistry", appContext.integrationRegistry);
    ctx.set("dataPlaneClient", appContext.dataPlaneClient);
    ctx.set("connectionTokenConfig", appContext.connectionTokenConfig);
    ctx.set("openWorkflow", appContext.openWorkflow);
    ctx.set("auth", appContext.auth);
    ctx.set("session", null);
    await next();
  };
}
