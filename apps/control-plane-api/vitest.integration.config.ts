import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export const WorkspaceAliases = [
  {
    find: /^@mistle\/config$/,
    replacement: fileURLToPath(new URL("../../packages/config/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/data-plane-internal-client$/,
    replacement: fileURLToPath(
      new URL("../../packages/data-plane-internal-client/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/gateway-connection-auth$/,
    replacement: fileURLToPath(
      new URL("../../packages/gateway-connection-auth/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/gateway-tunnel-auth$/,
    replacement: fileURLToPath(
      new URL("../../packages/gateway-tunnel-auth/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/db\/control-plane$/,
    replacement: fileURLToPath(
      new URL("../../packages/db/src/control-plane/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/db\/data-plane$/,
    replacement: fileURLToPath(
      new URL("../../packages/db/src/data-plane/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/db\/migrator$/,
    replacement: fileURLToPath(new URL("../../packages/db/src/migrator/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/http$/,
    replacement: fileURLToPath(new URL("../../packages/http/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/http\/errors\.js$/,
    replacement: fileURLToPath(new URL("../../packages/http/src/errors.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/http\/pagination$/,
    replacement: fileURLToPath(
      new URL("../../packages/http/src/pagination/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/integrations-core$/,
    replacement: fileURLToPath(
      new URL("../../packages/integrations-core/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/integrations-definitions$/,
    replacement: fileURLToPath(
      new URL("../../packages/integrations-definitions/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/integrations-definitions\/server$/,
    replacement: fileURLToPath(
      new URL("../../packages/integrations-definitions/src/server.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/logging$/,
    replacement: fileURLToPath(new URL("../../packages/logging/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/object-store$/,
    replacement: fileURLToPath(
      new URL("../../packages/object-store/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/port-access-auth$/,
    replacement: fileURLToPath(
      new URL("../../packages/port-access-auth/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/sandbox$/,
    replacement: fileURLToPath(new URL("../../packages/sandbox/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/sandbox-session-client\/browser$/,
    replacement: fileURLToPath(
      new URL("../../packages/sandbox-session-client/src/browser.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/sandbox-session-client\/node$/,
    replacement: fileURLToPath(
      new URL("../../packages/sandbox-session-client/src/node.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/sandbox-session-client$/,
    replacement: fileURLToPath(
      new URL("../../packages/sandbox-session-client/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/sandbox-session-protocol$/,
    replacement: fileURLToPath(
      new URL("../../packages/sandbox-session-protocol/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/sandbox-signing-auth$/,
    replacement: fileURLToPath(
      new URL("../../packages/sandbox-signing-auth/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/telemetry$/,
    replacement: fileURLToPath(new URL("../../packages/telemetry/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/test-harness$/,
    replacement: fileURLToPath(
      new URL("../../packages/test-harness/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/test-harness\/integration$/,
    replacement: fileURLToPath(
      new URL("../../packages/test-harness/src/integration/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/control-plane-api\/runtime$/,
    replacement: fileURLToPath(new URL("./src/main.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/control-plane-api\/types$/,
    replacement: fileURLToPath(new URL("./src/types.ts", import.meta.url)),
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
    find: /^@mistle\/time$/,
    replacement: fileURLToPath(new URL("../../packages/time/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/webhooks$/,
    replacement: fileURLToPath(new URL("../../packages/webhooks/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/workflow-registry$/,
    replacement: fileURLToPath(
      new URL("../../packages/workflow-registry/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/workflow-registry\/control-plane$/,
    replacement: fileURLToPath(
      new URL("../../packages/workflow-registry/src/control-plane.ts", import.meta.url),
    ),
  },
];

export default defineConfig({
  resolve: {
    alias: WorkspaceAliases,
  },
  test: {
    include: ["integration/**/*.integration.test.ts"],
    fileParallelism: true,
    testTimeout: 180_000,
    hookTimeout: 180_000,
    teardownTimeout: 180_000,
  },
});
