import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import type { AppContextBindings, AppRoutes } from "../types.js";
import { SANDBOX_PROFILES_ROUTE_BASE_PATH } from "./constants.js";
import * as createSandboxProfile from "./create-sandbox-profile/index.js";
import * as deleteSandboxProfile from "./delete-sandbox-profile/index.js";
import * as getSandboxProfileVersionIntegrationBindings from "./get-sandbox-profile-version-integration-bindings/index.js";
import * as getSandboxProfile from "./get-sandbox-profile/index.js";
import * as listSandboxProfileVersions from "./list-sandbox-profile-versions/index.js";
import * as listSandboxProfiles from "./list-sandbox-profiles/index.js";
import * as putSandboxProfileVersionIntegrationBindings from "./put-sandbox-profile-version-integration-bindings/index.js";
import * as startSandboxProfileInstance from "./start-sandbox-profile-instance/index.js";
import * as updateSandboxProfile from "./update-sandbox-profile/index.js";

export function createSandboxProfilesRoutes(): AppRoutes<typeof SANDBOX_PROFILES_ROUTE_BASE_PATH> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.openapi(listSandboxProfiles.route, listSandboxProfiles.handler);
  routes.openapi(createSandboxProfile.route, createSandboxProfile.handler);
  routes.openapi(getSandboxProfile.route, getSandboxProfile.handler);
  routes.openapi(updateSandboxProfile.route, updateSandboxProfile.handler);
  routes.openapi(deleteSandboxProfile.route, deleteSandboxProfile.handler);
  routes.openapi(listSandboxProfileVersions.route, listSandboxProfileVersions.handler);
  routes.openapi(
    getSandboxProfileVersionIntegrationBindings.route,
    getSandboxProfileVersionIntegrationBindings.handler,
  );
  routes.openapi(
    putSandboxProfileVersionIntegrationBindings.route,
    putSandboxProfileVersionIntegrationBindings.handler,
  );
  routes.openapi(startSandboxProfileInstance.route, startSandboxProfileInstance.handler);

  return {
    basePath: SANDBOX_PROFILES_ROUTE_BASE_PATH,
    routes,
  };
}
