import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { systemSleeper } from "@mistle/time";
import { describe, expect, test } from "vitest";

import {
  DEFAULT_SHARED_SYSTEM_INFRA_KEY,
  DockerIntegrationConfigPathInContainer,
  startFullSystemEnvironment,
} from "../src/index.js";

const PROJECT_ROOT_HOST_PATH = fileURLToPath(new URL("../../..", import.meta.url));
const TEST_TIMEOUT_MS = 240_000;

async function expectHealthz(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/__healthz`);
  expect(response.status).toBe(200);
}

describe("full system environment integration", () => {
  test(
    "starts full-system services and keeps host health endpoints reachable",
    async () => {
      const environment = await startFullSystemEnvironment({
        buildContextHostPath: PROJECT_ROOT_HOST_PATH,
        configPathInContainer: DockerIntegrationConfigPathInContainer,
        startupTimeoutMs: 120_000,
        sharedInfraKey: DEFAULT_SHARED_SYSTEM_INFRA_KEY,
        postgres: {},
        controlPlaneWorkflowNamespaceId: `fsi_cp_${randomUUID().replaceAll("-", "_")}`,
        dataPlaneWorkflowNamespaceId: `fsi_dp_${randomUUID().replaceAll("-", "_")}`,
        authBaseUrl: "http://localhost:5100",
        dashboardBaseUrl: "http://localhost:5173",
        authTrustedOrigins:
          "http://localhost:5100,http://127.0.0.1:5100,http://localhost:5173,http://127.0.0.1:5173",
      });

      try {
        await expectHealthz(environment.controlPlaneApi.hostBaseUrl);
        await expectHealthz(environment.dataPlaneApi.hostBaseUrl);
        await expectHealthz(environment.dataPlaneGateway.hostBaseUrl);
        await expectHealthz(environment.tokenizerProxy.hostBaseUrl);

        await systemSleeper.sleep(10_000);

        await expectHealthz(environment.controlPlaneApi.hostBaseUrl);
        await expectHealthz(environment.dataPlaneApi.hostBaseUrl);
        await expectHealthz(environment.dataPlaneGateway.hostBaseUrl);
        await expectHealthz(environment.tokenizerProxy.hostBaseUrl);
      } finally {
        await environment.stop();
      }
    },
    TEST_TIMEOUT_MS,
  );
});
