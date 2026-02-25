import type { ControlPlaneApiConfig } from "../src/types.js";

export function createRuntimeConfigWithPort(input: {
  config: ControlPlaneApiConfig;
  host: string;
  port: number;
}): ControlPlaneApiConfig {
  const baseUrl = `http://${input.host}:${String(input.port)}`;

  return {
    ...input.config,
    server: {
      ...input.config.server,
      host: input.host,
      port: input.port,
    },
    auth: {
      ...input.config.auth,
      baseUrl,
      trustedOrigins: [baseUrl],
    },
  };
}
