import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const WorkspaceAliases = [
  {
    find: /^@mistle\/config$/,
    replacement: fileURLToPath(new URL("../../packages/config/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/data-plane-gateway$/,
    replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/data-plane-internal-client$/,
    replacement: fileURLToPath(
      new URL("../../packages/data-plane-internal-client/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/db\/data-plane$/,
    replacement: fileURLToPath(
      new URL("../../packages/db/src/data-plane/index.ts", import.meta.url),
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
    find: /^@mistle\/logging$/,
    replacement: fileURLToPath(new URL("../../packages/logging/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/sandbox-session-protocol$/,
    replacement: fileURLToPath(
      new URL("../../packages/sandbox-session-protocol/src/index.ts", import.meta.url),
    ),
  },
  {
    find: /^@mistle\/telemetry$/,
    replacement: fileURLToPath(new URL("../../packages/telemetry/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/time$/,
    replacement: fileURLToPath(new URL("../../packages/time/src/index.ts", import.meta.url)),
  },
  {
    find: /^@mistle\/time\/testing$/,
    replacement: fileURLToPath(
      new URL("../../packages/time/src/testing/index.ts", import.meta.url),
    ),
  },
];

export default defineConfig({
  resolve: {
    alias: WorkspaceAliases,
  },
  test: {
    include: ["src/**/*.property.test.ts"],
  },
});
