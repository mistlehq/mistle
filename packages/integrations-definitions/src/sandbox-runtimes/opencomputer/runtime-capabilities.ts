import type { SandboxRuntimeResourceCapabilities } from "@mistle/integrations-core";

const OpenComputerValidResourceTiers = [
  { vcpuCount: 1, memoryMb: 1024 },
  { vcpuCount: 1, memoryMb: 4096 },
  { vcpuCount: 2, memoryMb: 8192 },
  { vcpuCount: 4, memoryMb: 16_384 },
] as const;

export const OpenComputerSandboxRuntimeResourceCapabilities: SandboxRuntimeResourceCapabilities = {
  // Source: OpenComputer requires a supported CPU/memory tier pair for VM binpacking.
  // packages/sandbox/src/providers/opencomputer/schemas.ts
  vcpuCount: {
    min: 1,
    max: 4,
    step: 1,
    default: 1,
  },
  memoryMb: {
    min: 1024,
    max: 16_384,
    step: 1024,
    default: 4096,
  },
  validResourcePairs: OpenComputerValidResourceTiers.map((tier) => ({
    vcpuCount: tier.vcpuCount,
    memoryMb: tier.memoryMb,
  })),
};
