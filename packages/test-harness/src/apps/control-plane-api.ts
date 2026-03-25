import type { StartDockerHttpAppInput, DockerHttpAppDefinition } from "./http-app.js";
import { startDockerHttpApp } from "./http-app.js";
import type { StartedWorkspaceApp } from "./shared.js";

const ControlPlaneApiDefinition: DockerHttpAppDefinition = {
  appName: "control-plane-api",
  distEntrypointRelativePath: "apps/control-plane-api/dist/index.js",
  dockerfileRelativePath: "Dockerfile.test",
  dockerTarget: "control-plane-api-test-runtime",
  containerPort: 5100,
  networkAlias: "control-plane-api",
  healthPath: "/__healthz",
  hostEnvVar: "MISTLE_APPS_CONTROL_PLANE_API_HOST",
  portEnvVar: "MISTLE_APPS_CONTROL_PLANE_API_PORT",
};

export type StartControlPlaneApiInput = StartDockerHttpAppInput;
export type ControlPlaneApiService = StartedWorkspaceApp;

export async function startControlPlaneApi(
  input: StartControlPlaneApiInput,
): Promise<ControlPlaneApiService> {
  return startDockerHttpApp(ControlPlaneApiDefinition, input);
}
