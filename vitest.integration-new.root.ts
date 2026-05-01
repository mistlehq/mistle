import {
  defineConfig,
  defineProject,
  mergeConfig,
  type TestProjectConfiguration,
} from "vitest/config";

import controlPlaneApiConfig from "./apps/control-plane-api/vitest.integration-new.config.ts";
import dashboardConfig from "./apps/dashboard/vitest.integration-new.config.ts";
import dataPlaneGatewayConfig from "./apps/data-plane-gateway/vitest.integration-new.config.ts";

function createNamedProject(input: {
  name: string;
  root: string;
  config: TestProjectConfiguration;
}): TestProjectConfiguration {
  return mergeConfig(
    input.config,
    defineProject({
      root: input.root,
      test: {
        name: input.name,
      },
    }),
  );
}

export default defineConfig({
  test: {
    projects: [
      createNamedProject({
        name: "@mistle/control-plane-api",
        root: "./apps/control-plane-api",
        config: controlPlaneApiConfig,
      }),
      createNamedProject({
        name: "@mistle/data-plane-gateway",
        root: "./apps/data-plane-gateway",
        config: dataPlaneGatewayConfig,
      }),
      createNamedProject({
        name: "@mistle/dashboard",
        root: "./apps/dashboard",
        config: dashboardConfig,
      }),
    ],
  },
});
