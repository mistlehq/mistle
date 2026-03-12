import { defineConfig } from "@openworkflow/cli";

import { registerWorkflowContextShutdownHandlers } from "./src/openworkflow/context.js";
import { getOpenWorkflowRuntime } from "./src/openworkflow/runtime.js";

registerWorkflowContextShutdownHandlers();
const openWorkflowRuntime = await getOpenWorkflowRuntime();

export default defineConfig({
  backend: openWorkflowRuntime.backend,
  worker: {
    concurrency: openWorkflowRuntime.workerConfig.workflow.concurrency,
  },
  dirs: "./openworkflow",
  ignorePatterns: ["**/*.test.*"],
});
