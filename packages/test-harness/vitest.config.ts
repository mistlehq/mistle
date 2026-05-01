import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@mistle\/control-plane-api\/runtime$/,
        replacement: fileURLToPath(
          new URL("../../apps/control-plane-api/src/main.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/control-plane-api\/types$/,
        replacement: fileURLToPath(
          new URL("../../apps/control-plane-api/src/types.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/data-plane-api\/runtime$/,
        replacement: fileURLToPath(
          new URL("../../apps/data-plane-api/src/main.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/data-plane-api\/types$/,
        replacement: fileURLToPath(
          new URL("../../apps/data-plane-api/src/types.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/data-plane-gateway\/runtime$/,
        replacement: fileURLToPath(
          new URL("../../apps/data-plane-gateway/src/runtime/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/data-plane-gateway\/types$/,
        replacement: fileURLToPath(
          new URL("../../apps/data-plane-gateway/src/types.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/tokenizer-proxy\/runtime$/,
        replacement: fileURLToPath(
          new URL("../../apps/tokenizer-proxy/src/runtime/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/tokenizer-proxy\/types$/,
        replacement: fileURLToPath(
          new URL("../../apps/tokenizer-proxy/src/types.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
