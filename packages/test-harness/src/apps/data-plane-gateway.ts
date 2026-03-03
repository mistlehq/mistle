import type { StartDockerHttpAppInput, DockerHttpAppDefinition } from "./http-app.js";
import { startDockerHttpApp } from "./http-app.js";
import type { StartedWorkspaceApp } from "./shared.js";

const DataPlaneGatewayDefinition: DockerHttpAppDefinition = {
  appName: "data-plane-gateway",
  distEntrypointRelativePath: "apps/data-plane-gateway/dist/index.js",
  dockerfileRelativePath: "Dockerfile.test",
  dockerTarget: "data-plane-gateway-test-runtime",
  containerPort: 5202,
  networkAlias: "data-plane-gateway",
  healthPath: "/__healthz",
  hostEnvVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_HOST",
  portEnvVar: "MISTLE_APPS_DATA_PLANE_GATEWAY_PORT",
};

export type StartDataPlaneGatewayInput = StartDockerHttpAppInput;
export type DataPlaneGatewayService = StartedWorkspaceApp;

export async function startDataPlaneGateway(
  input: StartDataPlaneGatewayInput,
): Promise<DataPlaneGatewayService> {
  return startDockerHttpApp(DataPlaneGatewayDefinition, input);
}
