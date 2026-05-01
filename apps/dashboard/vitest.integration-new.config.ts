import { defineConfig } from "vitest/config";

import { WorkspaceAliases as ControlPlaneWorkspaceAliases } from "../control-plane-api/vitest.integration.config.js";
import { WorkspaceAliases as DashboardWorkspaceAliases } from "./vitest.integration.config.js";

export default defineConfig({
  resolve: {
    alias: [...DashboardWorkspaceAliases, ...ControlPlaneWorkspaceAliases],
    tsconfigPaths: true,
  },
  test: {
    include: [
      "integration-new/**/*.integration.test.ts",
      "integration-new/**/*.integration.test.tsx",
    ],
    fileParallelism: true,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 180_000,
  },
});
