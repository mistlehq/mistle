import type { ControlPlaneWorkerConfig } from "../src/types.js";

export function createRuntimeConfigWithPort(input: {
  config: ControlPlaneWorkerConfig;
  host: string;
  port: number;
}): ControlPlaneWorkerConfig {
  return {
    ...input.config,
    server: {
      ...input.config.server,
      host: input.host,
      port: input.port,
    },
  };
}
