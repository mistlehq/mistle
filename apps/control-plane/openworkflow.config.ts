import { defineConfig } from "@openworkflow/cli";

import "./src/worker/instrument.js";
import { getControlPlaneWorkerConfig } from "./src/worker/config.js";
import { getControlPlaneWorkflowBackend } from "./workflows/runtime-context.js";

const { appConfig } = getControlPlaneWorkerConfig();

export default defineConfig({
  backend: await getControlPlaneWorkflowBackend(),
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
    "runtime/**",
    "README.md",
  ],
  worker: {
    concurrency: appConfig.workflow.concurrency,
  },
});
