import type { SandboxRuntimeResourceCapabilities } from "@mistle/integrations-core";

export const E2BSandboxRuntimeResourceCapabilities: SandboxRuntimeResourceCapabilities = {
  // Sources:
  // - E2B billing docs list baseline public limits of 8 vCPUs and 8 GB RAM,
  //   with higher limits available for paid plans.
  //   https://e2b.dev/docs/billing
  // - Mistle's current E2B template defaults are 2 vCPU and 4096 MB.
  //   packages/sandbox/src/providers/e2b/schemas.ts
  vcpuCount: {
    min: 1,
    max: 8,
    step: 1,
    default: 2,
  },
  memoryMb: {
    min: 1024,
    max: 16_384,
    step: 1024,
    default: 4096,
  },
};
