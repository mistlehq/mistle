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
import cacheConfig from "./packages/cache/vitest.integration.config.ts";
import configConfig from "./packages/config/vitest.integration.config.ts";
import dbConfig from "./packages/db/vitest.integration.config.ts";
import emailsConfig from "./packages/emails/vitest.integration.config.ts";
import integrationsCoreConfig from "./packages/integrations-core/vitest.integration.config.ts";
import integrationsDefinitionsConfig from "./packages/integrations-definitions/vitest.integration.config.ts";
import objectStoreConfig from "./packages/object-store/vitest.integration.config.ts";
import sandboxConfig from "./packages/sandbox/vitest.integration.config.ts";
import testHarnessConfig from "./packages/test-harness/vitest.integration.config.ts";
import {
  IntegrationVitestProjects,
  type IntegrationVitestProjectName,
} from "./scripts/test/integration-vitest-project-registry.ts";

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

function getProjectConfig(projectName: IntegrationVitestProjectName): TestProjectConfiguration {
  switch (projectName) {
    case "@mistle/control-plane-api":
      return controlPlaneApiConfig;
    case "@mistle/control-plane-worker":
      return controlPlaneWorkerConfig;
    case "@mistle/dashboard":
      return dashboardConfig;
    case "@mistle/data-plane-api":
      return dataPlaneApiConfig;
    case "@mistle/data-plane-gateway":
      return dataPlaneGatewayConfig;
    case "@mistle/data-plane-worker":
      return dataPlaneWorkerConfig;
    case "@mistle/cache":
      return cacheConfig;
    case "@mistle/config":
      return configConfig;
    case "@mistle/db":
      return dbConfig;
    case "@mistle/emails":
      return emailsConfig;
    case "@mistle/integrations-core":
      return integrationsCoreConfig;
    case "@mistle/integrations-definitions":
      return integrationsDefinitionsConfig;
    case "@mistle/object-store":
      return objectStoreConfig;
    case "@mistle/sandbox":
      return sandboxConfig;
    case "@mistle/test-harness":
      return testHarnessConfig;
  }

  const exhaustiveProjectName: never = projectName;
  throw new Error(`Missing integration Vitest config for ${exhaustiveProjectName}.`);
}

export default defineConfig({
  test: {
    projects: IntegrationVitestProjects.map((project) =>
      createNamedProject({
        name: project.projectName,
        root: `./${project.packageDir}`,
        config: getProjectConfig(project.projectName),
      }),
    ),
  },
});
