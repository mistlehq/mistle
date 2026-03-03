import type { StartDockerHttpAppInput, DockerHttpAppDefinition } from "./http-app.js";
import { startDockerHttpApp } from "./http-app.js";
import type { StartedWorkspaceApp } from "./shared.js";

const DataPlaneWorkerDefinition: DockerHttpAppDefinition = {
  appName: "data-plane-worker",
  distEntrypointRelativePath: "apps/data-plane-worker/dist/index.js",
  dockerfileRelativePath: "Dockerfile.test",
  dockerTarget: "data-plane-worker-test-runtime",
  containerPort: 5201,
  networkAlias: "data-plane-worker",
  healthPath: "/__healthz",
  hostEnvVar: "MISTLE_APPS_DATA_PLANE_WORKER_HOST",
  portEnvVar: "MISTLE_APPS_DATA_PLANE_WORKER_PORT",
};
const DockerSocketPath = "/var/run/docker.sock";

export type StartDataPlaneWorkerInput = StartDockerHttpAppInput;
export type DataPlaneWorkerService = StartedWorkspaceApp;

export async function startDataPlaneWorker(
  input: StartDataPlaneWorkerInput,
): Promise<DataPlaneWorkerService> {
  return startDockerHttpApp(DataPlaneWorkerDefinition, {
    ...input,
    bindMounts: [
      {
        source: DockerSocketPath,
        target: DockerSocketPath,
        mode: "rw",
      },
      ...(input.bindMounts ?? []),
    ],
  });
}
