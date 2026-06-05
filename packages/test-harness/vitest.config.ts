import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ["workspace-src"],
    },
  },
  resolve: {
    conditions: ["workspace-src", "node", "import", "default"],
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
        find: /^@mistle\/config$/,
        replacement: fileURLToPath(new URL("../config/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/db$/,
        replacement: fileURLToPath(new URL("../db/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/db\/control-plane$/,
        replacement: fileURLToPath(new URL("../db/src/control-plane/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/db\/data-plane$/,
        replacement: fileURLToPath(new URL("../db/src/data-plane/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/db\/migrator$/,
        replacement: fileURLToPath(new URL("../db/src/migrator/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/db\/test-environment$/,
        replacement: fileURLToPath(new URL("../db/src/test-environment.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/gateway-connection-auth$/,
        replacement: fileURLToPath(
          new URL("../gateway-connection-auth/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/gateway-tunnel-auth$/,
        replacement: fileURLToPath(new URL("../gateway-tunnel-auth/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/http$/,
        replacement: fileURLToPath(new URL("../http/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/http\/errors\.js$/,
        replacement: fileURLToPath(new URL("../http/src/errors.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/http\/pagination$/,
        replacement: fileURLToPath(new URL("../http/src/pagination/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/integrations-core$/,
        replacement: fileURLToPath(new URL("../integrations-core/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/integrations-definitions$/,
        replacement: fileURLToPath(
          new URL("../integrations-definitions/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/integrations-definitions\/sandbox-runtimes$/,
        replacement: fileURLToPath(
          new URL("../integrations-definitions/src/sandbox-runtimes/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/integrations-definitions\/server$/,
        replacement: fileURLToPath(
          new URL("../integrations-definitions/src/server.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/logging$/,
        replacement: fileURLToPath(new URL("../logging/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/port-access-auth$/,
        replacement: fileURLToPath(new URL("../port-access-auth/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/sandbox$/,
        replacement: fileURLToPath(new URL("../sandbox/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/sandbox-lifecycle$/,
        replacement: fileURLToPath(new URL("../sandbox-lifecycle/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/sandbox-runtime-contract$/,
        replacement: fileURLToPath(
          new URL("../sandbox-runtime-contract/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/sandbox-session-client$/,
        replacement: fileURLToPath(
          new URL("../sandbox-session-client/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/sandbox-session-client\/node$/,
        replacement: fileURLToPath(
          new URL("../sandbox-session-client/src/node.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/sandbox-session-protocol$/,
        replacement: fileURLToPath(
          new URL("../sandbox-session-protocol/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/sandbox-signing-auth$/,
        replacement: fileURLToPath(
          new URL("../sandbox-signing-auth/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/telemetry$/,
        replacement: fileURLToPath(new URL("../telemetry/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/telemetry\/testing\.js$/,
        replacement: fileURLToPath(new URL("../telemetry/src/testing.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/test-harness$/,
        replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/test-harness\/integration$/,
        replacement: fileURLToPath(new URL("./src/integration/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/time$/,
        replacement: fileURLToPath(new URL("../time/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/time\/testing$/,
        replacement: fileURLToPath(new URL("../time/src/testing/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/webhooks$/,
        replacement: fileURLToPath(new URL("../webhooks/src/index.ts", import.meta.url)),
      },
      {
        find: /^@mistle\/workflow-registry\/control-plane$/,
        replacement: fileURLToPath(
          new URL("../workflow-registry/src/control-plane.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/workflow-registry\/data-plane$/,
        replacement: fileURLToPath(
          new URL("../workflow-registry/src/data-plane.ts", import.meta.url),
        ),
      },
      {
        find: /^@mistle\/workflow-registry\/durable-step-retry\.js$/,
        replacement: fileURLToPath(
          new URL("../workflow-registry/src/durable-step-retry.ts", import.meta.url),
        ),
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
    fileParallelism: false,
    maxWorkers: 1,
  },
});
