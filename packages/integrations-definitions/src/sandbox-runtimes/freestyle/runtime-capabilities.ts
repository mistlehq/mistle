import type { SandboxRuntimeResourceCapabilities } from "@mistle/integrations-core";

const FreestyleAllowedVcpuCounts: number[] = [1, 2, 4, 8, 16, 32];
const FreestyleAllowedMemoryMb: number[] = [1024, 2048, 4096, 8192, 16_384, 32_768];

export const FreestyleSandboxRuntimeResourceCapabilities: SandboxRuntimeResourceCapabilities = {
  // Source: Freestyle pricing docs list Pro plan custom sizing up to 32 vCPUs,
  // 32 GB memory, and 64 GB disk. Their VM sizing requires vCPU and memory to
  // be powers of two, so Mistle exposes those small valid sets explicitly.
  // Account plan enforcement remains with Freestyle.
  // https://www.freestyle.sh/pricing
  vcpuCount: {
    min: 1,
    max: 32,
    step: 1,
    default: 2,
    allowedValues: FreestyleAllowedVcpuCounts,
  },
  memoryMb: {
    min: 1024,
    max: 32 * 1024,
    step: 1024,
    default: 4096,
    allowedValues: FreestyleAllowedMemoryMb,
  },
  diskMb: {
    min: 1024,
    max: 64 * 1024,
    step: 1024,
    default: 16 * 1024,
  },
};
