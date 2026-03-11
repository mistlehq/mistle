import { defineConfig } from "@openworkflow/cli";

import "./src/worker/instrument.js";
import { getDataPlaneWorkerConfig } from "./src/worker/config.js";
import { getDataPlaneWorkflowBackend } from "./workflows/runtime-context.js";

const { appConfig } = getDataPlaneWorkerConfig();

export default defineConfig({
  backend: await getDataPlaneWorkflowBackend(),
  dirs: "./workflows",
  ignorePatterns: [
    "**/index.ts",
    "**/spec.ts",
    "**/*.test.ts",
    "**/*.integration.test.ts",
    "backend.ts",
    "client.ts",
    "constants.ts",
    "runtime-context.ts",
    "core/**",
  ],
  worker: {
    concurrency: appConfig.workflow.concurrency,
  },
});
