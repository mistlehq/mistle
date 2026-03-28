export const IntegrationConfigContainerPaths = {
  DOCKER: "/app/config/config.integration.docker.toml",
  E2B: "/app/config/config.integration.e2b.toml",
} as const;

export const DockerIntegrationConfigPathInContainer = IntegrationConfigContainerPaths.DOCKER;
export const E2BIntegrationConfigPathInContainer = IntegrationConfigContainerPaths.E2B;
