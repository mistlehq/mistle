import { OpenAPIHono } from "@hono/zod-openapi";
import { OpenApiValidationHook } from "@mistle/http/errors.js";

import { createRequireInternalAuthMiddleware } from "../../middleware/require-internal-auth.js";
import type { AppContextBindings, AppRoutes } from "../../types.js";
import { CONTROL_PLANE_INTERNAL_AUTH_HEADER } from "../constants.js";
import * as claimSnapshotJob from "./claim-sandbox-profile-version-snapshot-job/index.js";
import { INTERNAL_SANDBOX_PROFILE_VERSION_SNAPSHOT_JOBS_ROUTE_BASE_PATH } from "./constants.js";
import * as markSnapshotJobFailed from "./mark-sandbox-profile-version-snapshot-job-failed/index.js";
import * as markSnapshotJobSucceeded from "./mark-sandbox-profile-version-snapshot-job-succeeded/index.js";

export function createInternalSandboxProfileVersionSnapshotJobRoutes(): AppRoutes<
  typeof INTERNAL_SANDBOX_PROFILE_VERSION_SNAPSHOT_JOBS_ROUTE_BASE_PATH
> {
  const routes = new OpenAPIHono<AppContextBindings>({
    defaultHook: OpenApiValidationHook,
  });

  routes.use(
    "*",
    createRequireInternalAuthMiddleware({
      headerName: CONTROL_PLANE_INTERNAL_AUTH_HEADER,
      errorCode: "UNAUTHORIZED",
      errorMessage: "Internal service authentication failed.",
    }),
  );

  routes.openapi(claimSnapshotJob.route, claimSnapshotJob.handler);
  routes.openapi(markSnapshotJobSucceeded.route, markSnapshotJobSucceeded.handler);
  routes.openapi(markSnapshotJobFailed.route, markSnapshotJobFailed.handler);

  return {
    basePath: INTERNAL_SANDBOX_PROFILE_VERSION_SNAPSHOT_JOBS_ROUTE_BASE_PATH,
    routes,
  };
}
