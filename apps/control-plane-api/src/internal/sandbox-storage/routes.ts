import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import { createRequireInternalAuthMiddleware } from "../../middleware/require-internal-auth.js";
import type { AppContextBindings, AppRoutes } from "../../types.js";
import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../constants.js";
import { INTERNAL_SANDBOX_STORAGE_ROUTE_BASE_PATH } from "./constants.js";
import * as encryptStorageCredential from "./encrypt-storage-credential/index.js";
import * as resolveStorageConfiguration from "./resolve-storage-configuration/index.js";
import * as resolveStorageCredential from "./resolve-storage-credential/index.js";
import * as resolveStoragePersistenceMode from "./resolve-storage-persistence-mode/index.js";

const InternalSandboxStorageErrorCodes = {
  UNAUTHORIZED: "UNAUTHORIZED",
} as const;

export function createInternalSandboxStorageRoutes(): AppRoutes<
  typeof INTERNAL_SANDBOX_STORAGE_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.use(
    "*",
    createRequireInternalAuthMiddleware({
      headerName: CONTROL_PLANE_INTERNAL_AUTH_HEADER,
      errorCode: InternalSandboxStorageErrorCodes.UNAUTHORIZED,
      errorMessage: "Internal service authentication failed.",
    }),
  );

  routes.openapi(resolveStoragePersistenceMode.route, resolveStoragePersistenceMode.handler);
  routes.openapi(resolveStorageConfiguration.route, resolveStorageConfiguration.handler);
  routes.openapi(encryptStorageCredential.route, encryptStorageCredential.handler);
  routes.openapi(resolveStorageCredential.route, resolveStorageCredential.handler);

  return {
    basePath: INTERNAL_SANDBOX_STORAGE_ROUTE_BASE_PATH,
    routes,
  };
}
