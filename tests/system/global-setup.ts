import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { DEFAULT_SHARED_SYSTEM_INFRA_KEY, startFullSystemEnvironment } from "@mistle/test-harness";

const PROJECT_ROOT_HOST_PATH = fileURLToPath(new URL("../..", import.meta.url));
const CONFIG_PATH_IN_CONTAINER = "/workspace/config/config.sample.toml";
const APP_STARTUP_TIMEOUT_MS = 120_000;
const AUTH_ORIGIN = "http://localhost:5100";

function setEnv(name: string, value: string): void {
  process.env[name] = value;
}

export default async function setup(): Promise<() => Promise<void>> {
  const environment = await startFullSystemEnvironment({
    buildContextHostPath: PROJECT_ROOT_HOST_PATH,
    configPathInContainer: CONFIG_PATH_IN_CONTAINER,
    startupTimeoutMs: APP_STARTUP_TIMEOUT_MS,
    sharedInfraKey: DEFAULT_SHARED_SYSTEM_INFRA_KEY,
    postgres: {},
    controlPlaneWorkflowNamespaceId: `system_cp_${randomUUID().replaceAll("-", "_")}`,
    dataPlaneWorkflowNamespaceId: `system_dp_${randomUUID().replaceAll("-", "_")}`,
    authBaseUrl: AUTH_ORIGIN,
    authInvitationAcceptBaseUrl: "http://localhost:5173/invitations/accept",
    authTrustedOrigins:
      "http://localhost:5100,http://127.0.0.1:5100,http://localhost:5173,http://127.0.0.1:5173",
  });

  setEnv("MISTLE_SYSTEM_CONTROL_PLANE_API_BASE_URL", environment.controlPlaneApi.hostBaseUrl);
  setEnv("MISTLE_SYSTEM_CONTROL_PLANE_WORKER_BASE_URL", environment.controlPlaneWorker.hostBaseUrl);
  setEnv("MISTLE_SYSTEM_DATA_PLANE_API_BASE_URL", environment.dataPlaneApi.hostBaseUrl);
  setEnv("MISTLE_SYSTEM_DATA_PLANE_WORKER_BASE_URL", environment.dataPlaneWorker.hostBaseUrl);
  setEnv("MISTLE_SYSTEM_DATA_PLANE_GATEWAY_BASE_URL", environment.dataPlaneGateway.hostBaseUrl);
  setEnv("MISTLE_SYSTEM_TOKENIZER_PROXY_BASE_URL", environment.tokenizerProxy.hostBaseUrl);
  setEnv("MISTLE_SYSTEM_MAILPIT_HTTP_BASE_URL", environment.mailpit.httpBaseUrl);
  setEnv("MISTLE_SYSTEM_CONTROL_PLANE_DB_URL", environment.database.hostDatabaseUrl);

  return async () => {
    await environment.stop();
  };
}
