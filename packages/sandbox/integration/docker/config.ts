import { z } from "zod";

const DOCKER_INTEGRATION_ENABLEMENT_MESSAGE =
  'MISTLE_TEST_SANDBOX_INTEGRATION=1 and MISTLE_TEST_SANDBOX_INTEGRATION_PROVIDERS includes "docker"';

const DockerAdapterIntegrationConfigSchema = z
  .object({
    MISTLE_SANDBOX_DOCKER_SOCKET_PATH: z
      .string()
      .trim()
      .min(1, {
        message: `MISTLE_SANDBOX_DOCKER_SOCKET_PATH must be non-empty when ${DOCKER_INTEGRATION_ENABLEMENT_MESSAGE}.`,
      })
      .default("/var/run/docker.sock"),
  })
  .strip();

type DockerAdapterIntegrationConfig = z.output<typeof DockerAdapterIntegrationConfigSchema>;

export type DockerAdapterIntegrationSettings =
  | {
      enabled: false;
    }
  | {
      enabled: true;
      socketPath: string;
    };

export function resolveDockerAdapterIntegrationSettings(input: {
  env: NodeJS.ProcessEnv;
  enabled: boolean;
}): DockerAdapterIntegrationSettings {
  if (!input.enabled) {
    return {
      enabled: false,
    };
  }

  const parsed: DockerAdapterIntegrationConfig = DockerAdapterIntegrationConfigSchema.parse(
    input.env,
  );

  return {
    enabled: true,
    socketPath: parsed.MISTLE_SANDBOX_DOCKER_SOCKET_PATH,
  };
}
