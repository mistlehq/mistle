import { Hono } from "hono";

import type { AppContextBindings, AppRoutes } from "../types.js";

import { createRequireAuthSessionMiddleware } from "./require-auth-session.js";

export function withAuthSession<BasePath>(appRoutes: AppRoutes<BasePath>): AppRoutes<BasePath> {
  const routes = new Hono<AppContextBindings>();
  routes.use("*", createRequireAuthSessionMiddleware());
  routes.route("/", appRoutes.routes);

  return {
    basePath: appRoutes.basePath,
    routes,
  };
}
