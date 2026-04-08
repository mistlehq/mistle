import { startSeaweedfsS3 } from "@mistle/test-harness";

import { createControlPlaneApiRuntime } from "../../src/main.js";
import type { ControlPlaneApiConfig } from "../../src/types.js";

const IntegrationConnectionTokenConfig = {
  secret: "integration-connection-secret",
  issuer: "integration-issuer",
  audience: "integration-audience",
} as const;

const IntegrationSandboxRuntimeConfig = {
  defaultBaseImage: "127.0.0.1:5001/mistle/sandbox-base:dev",
  gatewayWsUrl: "ws://127.0.0.1:5202/tunnel/sandbox",
} as const;

export async function createRuntimeWithObjectStore(input: {
  config: ControlPlaneApiConfig;
  internalAuthServiceToken: string;
  seaweedfs: Awaited<ReturnType<typeof startSeaweedfsS3>>;
}) {
  return createControlPlaneApiRuntime({
    app: {
      ...input.config,
      objectStore: {
        bucketName: input.seaweedfs.bucketName,
        region: input.seaweedfs.region,
        endpoint: input.seaweedfs.endpoint,
        forcePathStyle: true,
        accessKeyId: input.seaweedfs.accessKeyId,
        secretAccessKey: input.seaweedfs.secretAccessKey,
      },
    },
    internalAuthServiceToken: input.internalAuthServiceToken,
    connectionToken: IntegrationConnectionTokenConfig,
    sandbox: IntegrationSandboxRuntimeConfig,
  });
}
