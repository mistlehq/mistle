import type { StartDockerHttpAppInput, DockerHttpAppDefinition } from "./http-app.js";
import { startDockerHttpApp } from "./http-app.js";
import type { StartedWorkspaceApp } from "./shared.js";

const ControlPlaneWorkerDefinition: DockerHttpAppDefinition = {
  appName: "control-plane-worker",
  distEntrypointRelativePath: "apps/control-plane/dist/src/worker/index.js",
  dockerfileRelativePath: "Dockerfile.test",
  dockerTarget: "control-plane-worker-test-runtime",
  containerPort: 5101,
  networkAlias: "control-plane-worker",
  healthPath: "/__healthz",
  hostEnvVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_HOST",
  portEnvVar: "MISTLE_APPS_CONTROL_PLANE_WORKER_PORT",
};

export type StartControlPlaneWorkerInput = StartDockerHttpAppInput;
export type ControlPlaneWorkerService = StartedWorkspaceApp;

export async function startControlPlaneWorker(
  input: StartControlPlaneWorkerInput,
): Promise<ControlPlaneWorkerService> {
  return startDockerHttpApp(ControlPlaneWorkerDefinition, input);
}
