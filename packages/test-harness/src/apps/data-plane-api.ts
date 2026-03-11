import type { StartDockerHttpAppInput, DockerHttpAppDefinition } from "./http-app.js";
import { startDockerHttpApp } from "./http-app.js";
import type { StartedWorkspaceApp } from "./shared.js";

const DataPlaneApiDefinition: DockerHttpAppDefinition = {
  appName: "data-plane-api",
  distEntrypointRelativePath: "apps/data-plane/dist/src/index.js",
  dockerfileRelativePath: "Dockerfile.test",
  dockerTarget: "data-plane-api-test-runtime",
  containerPort: 5200,
  networkAlias: "data-plane-api",
  healthPath: "/__healthz",
  hostEnvVar: "MISTLE_APPS_DATA_PLANE_API_HOST",
  portEnvVar: "MISTLE_APPS_DATA_PLANE_API_PORT",
};

export type StartDataPlaneApiInput = StartDockerHttpAppInput;
export type DataPlaneApiService = StartedWorkspaceApp;

export async function startDataPlaneApi(
  input: StartDataPlaneApiInput,
): Promise<DataPlaneApiService> {
  return startDockerHttpApp(DataPlaneApiDefinition, input);
}
