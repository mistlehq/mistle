import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@mistle\/test-harness\/integration$/,
        replacement: fileURLToPath(
          new URL("../../packages/test-harness/src/integration/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/control-plane-api\/runtime$/,
        replacement: fileURLToPath(new URL("../control-plane-api/src/main.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/control-plane-api\/types$/,
        replacement: fileURLToPath(new URL("../control-plane-api/src/types.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/data-plane-api\/runtime$/,
        replacement: fileURLToPath(new URL("../data-plane-api/src/main.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/data-plane-api\/types$/,
        replacement: fileURLToPath(new URL("../data-plane-api/src/types.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/data-plane-gateway\/runtime$/,
        replacement: fileURLToPath(
          new URL("../data-plane-gateway/src/runtime/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/data-plane-gateway\/types$/,
        replacement: fileURLToPath(new URL("../data-plane-gateway/src/types.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/tokenizer-proxy\/runtime$/,
        replacement: fileURLToPath(new URL("./src/runtime/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/tokenizer-proxy\/types$/,
        replacement: fileURLToPath(new URL("./src/types.ts", import.meta.url)),
      },
    ],
  },
  test: {
    include: ["integration-new/**/*.integration.test.ts"],
    fileParallelism: true,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 180_000,
  },
});
