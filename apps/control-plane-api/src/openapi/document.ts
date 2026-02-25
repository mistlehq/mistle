import { OpenAPIHono } from "@hono/zod-openapi";

import type { AppContextBindings } from "../types.js";

import { registerApiRouteModules } from "../runtime/routes.js";
import { CONTROL_PLANE_OPENAPI_INFO } from "./constants.js";

export function createControlPlaneOpenApiDocument(): ReturnType<
  OpenAPIHono<AppContextBindings>["getOpenAPI31Document"]
> {
  const app = new OpenAPIHono<AppContextBindings>();
  registerApiRouteModules(app);

  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: CONTROL_PLANE_OPENAPI_INFO,
  });
}
