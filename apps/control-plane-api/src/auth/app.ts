import { Hono } from "hono";

import type { AppContextBindings, AppRoutes } from "../types.js";

import { AUTH_ROUTE_BASE_PATH } from "./constants.js";

export function createAuthApp(): AppRoutes<typeof AUTH_ROUTE_BASE_PATH> {
  const routes = new Hono<AppContextBindings>();
  routes.all("*", (ctx) => {
    return ctx.get("services").auth.handler(ctx.req.raw);
  });

  return {
    basePath: AUTH_ROUTE_BASE_PATH,
    routes,
  };
}
