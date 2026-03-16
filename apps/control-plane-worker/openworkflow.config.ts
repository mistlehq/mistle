import { defineConfig } from "@openworkflow/cli";

import { registerWorkflowContextShutdownHandlers } from "./openworkflow/core/context.js";
import { getOpenWorkflowRuntime } from "./openworkflow/core/runtime.js";

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
