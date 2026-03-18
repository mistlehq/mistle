import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_SHARED_SYSTEM_INFRA_KEY,
  type SandboxBaseImageBuild,
  removeTestContext,
  startFullSystemEnvironment,
  writeTestContext,
} from "@mistle/test-harness";

const PROJECT_ROOT_HOST_PATH = fileURLToPath(new URL("../..", import.meta.url));
const CONFIG_PATH_IN_CONTAINER = "/app/config/config.development.toml";
const APP_STARTUP_TIMEOUT_MS = 120_000;
const AUTH_ORIGIN = "http://localhost:5100";
const TestContextId = "system";

export function createSystemGlobalSetup(input: {
  sandboxBaseImageBuild: SandboxBaseImageBuild;
}): () => Promise<() => Promise<void>> {
  return async function setup(): Promise<() => Promise<void>> {
    const environment = await startFullSystemEnvironment({
      buildContextHostPath: PROJECT_ROOT_HOST_PATH,
      configPathInContainer: CONFIG_PATH_IN_CONTAINER,
      startupTimeoutMs: APP_STARTUP_TIMEOUT_MS,
      sharedInfraKey: DEFAULT_SHARED_SYSTEM_INFRA_KEY,
      postgres: {},
      controlPlaneWorkflowNamespaceId: `system_cp_${randomUUID().replaceAll("-", "_")}`,
      dataPlaneWorkflowNamespaceId: `system_dp_${randomUUID().replaceAll("-", "_")}`,
      authBaseUrl: AUTH_ORIGIN,
      dashboardBaseUrl: "http://localhost:5173",
      authTrustedOrigins:
        "http://localhost:5100,http://127.0.0.1:5100,http://localhost:5173,http://127.0.0.1:5173",
      sandboxBaseImageBuild: input.sandboxBaseImageBuild,
    });

    try {
      await writeTestContext({
        id: TestContextId,
        value: {
          controlPlaneApiBaseUrl: environment.controlPlaneApi.hostBaseUrl,
          controlPlaneWorkerBaseUrl: environment.controlPlaneWorker.hostBaseUrl,
          dataPlaneApiBaseUrl: environment.dataPlaneApi.hostBaseUrl,
          dataPlaneWorkerBaseUrl: environment.dataPlaneWorker.hostBaseUrl,
          dataPlaneGatewayBaseUrl: environment.dataPlaneGateway.hostBaseUrl,
          tokenizerProxyBaseUrl: environment.tokenizerProxy.hostBaseUrl,
          mailpitHttpBaseUrl: environment.mailpit.httpBaseUrl,
          controlPlaneDatabaseUrl: environment.database.hostDatabaseUrl,
        },
      });
    } catch (error) {
      await removeTestContext(TestContextId);
      await environment.stop();
      throw error;
    }

    return async () => {
      await removeTestContext(TestContextId);
      await environment.stop();
    };
  };
}
