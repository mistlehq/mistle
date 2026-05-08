import { fileURLToPath } from "node:url";

import {
  defineConfig,
  defineProject,
  mergeConfig,
  type TestProjectConfiguration,
} from "vitest/config";

import controlPlaneApiConfig from "./apps/control-plane-api/vitest.integration.config.ts";
import controlPlaneWorkerConfig from "./apps/control-plane-worker/vitest.integration.config.ts";
import dashboardConfig from "./apps/dashboard/vitest.integration.config.ts";
import dataPlaneApiConfig from "./apps/data-plane-api/vitest.integration.config.ts";
import dataPlaneGatewayConfig from "./apps/data-plane-gateway/vitest.integration.config.ts";
import dataPlaneWorkerConfig from "./apps/data-plane-worker/vitest.integration.config.ts";

const TimingSetupFilePath = fileURLToPath(
  new URL("./packages/test-harness/src/integration/vitest-timing-setup.ts", import.meta.url),
);

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
        setupFiles: [TimingSetupFilePath],
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
        name: "@mistle/control-plane-worker",
        root: "./apps/control-plane-worker",
        config: controlPlaneWorkerConfig,
      }),
      createNamedProject({
        name: "@mistle/dashboard",
        root: "./apps/dashboard",
        config: dashboardConfig,
      }),
      createNamedProject({
        name: "@mistle/data-plane-api",
        root: "./apps/data-plane-api",
        config: dataPlaneApiConfig,
      }),
      createNamedProject({
        name: "@mistle/data-plane-gateway",
        root: "./apps/data-plane-gateway",
        config: dataPlaneGatewayConfig,
      }),
      createNamedProject({
        name: "@mistle/data-plane-worker",
        root: "./apps/data-plane-worker",
        config: dataPlaneWorkerConfig,
      }),
    ],
  },
});
