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
import tokenizerProxyConfig from "./apps/tokenizer-proxy/vitest.integration.config.ts";
import configConfig from "./packages/config/vitest.integration.config.ts";
import dbConfig from "./packages/db/vitest.integration.config.ts";
import emailsConfig from "./packages/emails/vitest.integration.config.ts";
import integrationsCoreConfig from "./packages/integrations-core/vitest.integration.config.ts";
import sandboxConfig from "./packages/sandbox/vitest.integration.config.ts";
import testHarnessConfig from "./packages/test-harness/vitest.integration.config.ts";

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
        name: "@mistle/tokenizer-proxy",
        root: "./apps/tokenizer-proxy",
        config: tokenizerProxyConfig,
      }),
      createNamedProject({
        name: "@mistle/config",
        root: "./packages/config",
        config: configConfig,
      }),
      createNamedProject({
        name: "@mistle/db",
        root: "./packages/db",
        config: dbConfig,
      }),
      createNamedProject({
        name: "@mistle/emails",
        root: "./packages/emails",
        config: emailsConfig,
      }),
      createNamedProject({
        name: "@mistle/integrations-core",
        root: "./packages/integrations-core",
        config: integrationsCoreConfig,
      }),
      createNamedProject({
        name: "@mistle/sandbox",
        root: "./packages/sandbox",
        config: sandboxConfig,
      }),
      createNamedProject({
        name: "@mistle/test-harness",
        root: "./packages/test-harness",
        config: testHarnessConfig,
      }),
    ],
  },
});
