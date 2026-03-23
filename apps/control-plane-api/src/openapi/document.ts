import { OpenAPIHono } from "@hono/zod-openapi";

import { registerInternalApiRouteModules, registerPublicApiRouteModules } from "../app.js";
import type { AppContextBindings } from "../types.js";
import { CONTROL_PLANE_INTERNAL_OPENAPI_INFO, CONTROL_PLANE_OPENAPI_INFO } from "./constants.js";

export function createControlPlaneOpenApiDocument(): ReturnType<
  OpenAPIHono<AppContextBindings>["getOpenAPI31Document"]
> {
  const app = new OpenAPIHono<AppContextBindings>();
  registerPublicApiRouteModules(app);

  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: CONTROL_PLANE_OPENAPI_INFO,
  });
}

export function createControlPlaneInternalOpenApiDocument(): ReturnType<
  OpenAPIHono<AppContextBindings>["getOpenAPI31Document"]
> {
  const app = new OpenAPIHono<AppContextBindings>();
  registerInternalApiRouteModules(app);

  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: CONTROL_PLANE_INTERNAL_OPENAPI_INFO,
  });
}
