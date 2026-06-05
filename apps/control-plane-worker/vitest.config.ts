import { defineConfig } from "vitest/config";

import { WorkspaceAliases } from "./vitest.workspace-aliases.js";

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ["workspace-src"],
    },
  },
  resolve: {
    conditions: ["workspace-src", "node", "import", "default"],
    alias: WorkspaceAliases,
  },
  test: {
    include: ["src/**/*.test.ts", "openworkflow/**/*.test.ts"],
  },
});
