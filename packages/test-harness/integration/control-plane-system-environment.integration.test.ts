import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  DEFAULT_SHARED_SYSTEM_INFRA_KEY,
  startControlPlaneSystemEnvironment,
} from "../src/index.js";

const PROJECT_ROOT_HOST_PATH = fileURLToPath(new URL("../../..", import.meta.url));
const TEST_TIMEOUT_MS = 180_000;

describe("control-plane system environment integration", () => {
  test(
    "starts control-plane services and serves the host health endpoint",
    async () => {
      const environment = await startControlPlaneSystemEnvironment({
        buildContextHostPath: PROJECT_ROOT_HOST_PATH,
        configPathInContainer: "/app/config/config.development.toml",
        startupTimeoutMs: 120_000,
        sharedInfraKey: DEFAULT_SHARED_SYSTEM_INFRA_KEY,
        postgres: {},
        workflowNamespaceId: `cp_it_${randomUUID().replaceAll("-", "_")}`,
        authBaseUrl: "http://localhost:5100",
        dashboardBaseUrl: "http://localhost:5173",
        authTrustedOrigins:
          "http://localhost:5100,http://127.0.0.1:5100,http://localhost:5173,http://127.0.0.1:5173",
      });

      try {
        const response = await fetch(`${environment.controlPlaneApi.hostBaseUrl}/__healthz`);
        expect(response.status).toBe(200);
      } finally {
        await environment.stop();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
