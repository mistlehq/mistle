import { startSeaweedfsS3 } from "@mistle/test-harness";

import { createControlPlaneApiRuntime } from "../../src/main.js";
import type { ControlPlaneApiConfig } from "../../src/types.js";

export async function createRuntimeWithObjectStore(input: {
  config: ControlPlaneApiConfig;
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
  });
}
