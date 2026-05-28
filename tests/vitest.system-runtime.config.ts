import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const TimingSetupFilePath = fileURLToPath(
  new URL("../packages/test-harness/src/integration/vitest-timing-setup.ts", import.meta.url),
);
const RuntimeTimingSetupFilePath = fileURLToPath(
  new URL("./system-runtime/setup-timing.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    include: [
      "system-runtime/*.runtime-system.test.ts",
      "system-runtime/**/*.runtime-system.test.ts",
    ],
    globalSetup: "./system-runtime/global-setup.ts",
    setupFiles: [TimingSetupFilePath, RuntimeTimingSetupFilePath],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 180_000,
  },
});
