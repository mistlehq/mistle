import { OpenAPIHono } from "@hono/zod-openapi";
import { readRepositoryVersion } from "@mistle/config";

import { registerInternalApiRouteModules } from "../../src/app.js";
import type { AppContextBindings } from "../../src/types.js";

const DataPlaneReleaseVersion = readRepositoryVersion(import.meta.url);

const DataPlaneInternalOpenApiInfo = {
  title: "Mistle Data Plane Internal API",
  version: DataPlaneReleaseVersion,
};

export function createDataPlaneInternalOpenApiDocument(): ReturnType<
  OpenAPIHono<AppContextBindings>["getOpenAPI31Document"]
> {
  const app = new OpenAPIHono<AppContextBindings>();
  registerInternalApiRouteModules(app);

  return app.getOpenAPI31Document({
    openapi: "3.1.0",
    info: DataPlaneInternalOpenApiInfo,
  });
}
