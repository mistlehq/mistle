import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const TimeSourcePath = fileURLToPath(new URL("../packages/time/src/index.ts", import.meta.url));
const TimeTestingSourcePath = fileURLToPath(
  new URL("../packages/time/src/testing/index.ts", import.meta.url),
);
const IntegrationsDefinitionsCodexServerPath = fileURLToPath(
  new URL(
    "../packages/integrations-definitions/src/agent-runtimes/codex/server.ts",
    import.meta.url,
  ),
);

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "@mistle/integrations-definitions/agent-runtimes/codex/server":
        IntegrationsDefinitionsCodexServerPath,
      "@mistle/time": TimeSourcePath,
      "@mistle/time/testing": TimeTestingSourcePath,
    },
  },
  test: {
    include: ["system/**/*.system.test.ts"],
    globalSetup: "./system/global-setup.ts",
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 180_000,
    fileParallelism: false,
    maxWorkers: 1,
  },
});
