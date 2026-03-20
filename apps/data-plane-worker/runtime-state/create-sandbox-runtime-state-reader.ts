import { GatewayHttpSandboxRuntimeStateReader } from "./adapters/gateway-http-sandbox-runtime-state-reader.js";
import type { SandboxRuntimeStateReader } from "./sandbox-runtime-state-reader.js";

/**
 * Creates the worker runtime-state reader from app and global config.
 *
 * The worker always reads runtime-state snapshots through the gateway's
 * internal HTTP route. Gateway-owned backend selection remains opaque to the
 * worker.
 */
export function createSandboxRuntimeStateReader(input: {
  gatewayBaseUrl: string;
  serviceToken: string;
}): SandboxRuntimeStateReader {
  return new GatewayHttpSandboxRuntimeStateReader({
    baseUrl: input.gatewayBaseUrl,
    serviceToken: input.serviceToken,
  });
}
