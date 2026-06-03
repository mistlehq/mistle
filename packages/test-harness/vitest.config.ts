import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@mistle\/control-plane-internal-client$/,
        replacement: fileURLToPath(
          new URL("../control-plane-internal-client/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/control-plane-internal-client\/generated\/schema\.js$/,
        replacement: fileURLToPath(
          new URL("../control-plane-internal-client/src/generated/schema.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/data-plane-internal-client$/,
        replacement: fileURLToPath(
          new URL("../data-plane-internal-client/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/data-plane-internal-client\/generated\/schema\.js$/,
        replacement: fileURLToPath(
          new URL("../data-plane-internal-client/src/generated/schema.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/object-store$/,
        replacement: fileURLToPath(new URL("../object-store/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/cache$/,
        replacement: fileURLToPath(new URL("../cache/src/index.ts", import.meta.url)),
      },
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
    ],
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
