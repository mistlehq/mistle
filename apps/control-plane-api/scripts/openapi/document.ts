import { OpenAPIHono } from "@hono/zod-openapi";

import { registerInternalApiRouteModules, registerPublicApiRouteModules } from "../../src/app.js";
import type { AppContextBindings } from "../../src/types.js";

const ControlPlaneOpenApiInfo = {
  title: "Mistle Control Plane API",
  version: "0.0.0",
};

const ControlPlaneInternalOpenApiInfo = {
  title: "Mistle Control Plane Internal API",
  version: "0.0.0",
};

export function createControlPlaneOpenApiDocument(): ReturnType<
  OpenAPIHono<AppContextBindings>["getOpenAPI31Document"]
> {
  const app = new OpenAPIHono<AppContextBindings>();
  registerPublicApiRouteModules(app);

  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: ControlPlaneOpenApiInfo,
  });
}

export function createControlPlaneInternalOpenApiDocument(): ReturnType<
  OpenAPIHono<AppContextBindings>["getOpenAPI31Document"]
> {
  const app = new OpenAPIHono<AppContextBindings>();
  registerInternalApiRouteModules(app);

  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: ControlPlaneInternalOpenApiInfo,
  });
}
