import { OpenAPIHono } from "@hono/zod-openapi";
import { readRepositoryVersion } from "@mistle/config";

import { registerInternalApiRouteModules, registerPublicApiRouteModules } from "../../src/app.js";
import type { AppContextBindings } from "../../src/types.js";

const ControlPlaneReleaseVersion = readRepositoryVersion(import.meta.url);

const ControlPlaneOpenApiInfo = {
  title: "Mistle Control Plane API",
  version: ControlPlaneReleaseVersion,
};

const ControlPlaneInternalOpenApiInfo = {
  title: "Mistle Control Plane Internal API",
  version: ControlPlaneReleaseVersion,
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
