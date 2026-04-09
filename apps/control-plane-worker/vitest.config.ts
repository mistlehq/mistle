import { defineConfig } from "vitest/config";

import { WorkspaceAliases } from "./vitest.workspace-aliases.js";

export default defineConfig({
  resolve: {
    alias: WorkspaceAliases,
  },
  test: {
    include: ["src/**/*.test.ts", "openworkflow/**/*.test.ts"],
  },
});
