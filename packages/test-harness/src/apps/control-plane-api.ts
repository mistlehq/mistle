import { existsSync } from "node:fs";
import { resolve } from "node:path";

import type { StartDockerHttpAppInput, DockerHttpAppDefinition } from "./http-app.js";
import { startDockerHttpApp } from "./http-app.js";
import type { StartedWorkspaceApp } from "./shared.js";

const IntegrationTargetsProvisionManifestFileName = "integration-targets.provision.json";
const IntegrationTargetsProvisionManifestContainerPath = `/workspace/${IntegrationTargetsProvisionManifestFileName}`;

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

function resolveControlPlaneApiBindMounts(
  input: StartControlPlaneApiInput,
): StartDockerHttpAppInput["bindMounts"] {
  const provisionManifestHostPath = resolve(
    input.buildContextHostPath,
    IntegrationTargetsProvisionManifestFileName,
  );
  if (!existsSync(provisionManifestHostPath)) {
    return input.bindMounts;
  }

  if (
    input.bindMounts?.some(
      (bindMount) => bindMount.target === IntegrationTargetsProvisionManifestContainerPath,
    ) ??
    false
  ) {
    return input.bindMounts;
  }

  const bindMounts = input.bindMounts ?? [];
  return [
    ...bindMounts,
    {
      source: provisionManifestHostPath,
      target: IntegrationTargetsProvisionManifestContainerPath,
      mode: "ro",
    },
  ];
}

export async function startControlPlaneApi(
  input: StartControlPlaneApiInput,
): Promise<ControlPlaneApiService> {
  const bindMounts = resolveControlPlaneApiBindMounts(input);

  return startDockerHttpApp(ControlPlaneApiDefinition, {
    ...input,
    ...(bindMounts === undefined
      ? {}
      : {
          bindMounts,
        }),
  });
}
