import { fileURLToPath } from "node:url";

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const TimeSourcePath = fileURLToPath(new URL("../packages/time/src/index.ts", import.meta.url));
const TimeTestingSourcePath = fileURLToPath(
  new URL("../packages/time/src/testing/index.ts", import.meta.url),
);
const IntegrationsDefinitionsOpenAiAgentServerPath = fileURLToPath(
  new URL("../packages/integrations-definitions/src/openai/agent.server.ts", import.meta.url),
);

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      "@mistle/integrations-definitions/openai/agent/server":
        IntegrationsDefinitionsOpenAiAgentServerPath,
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
