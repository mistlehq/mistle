import type { SandboxRuntimeResourceCapabilities } from "@mistle/integrations-core";

const TensorlakeMinVcpuCount = 1;
const TensorlakeMaxVcpuCount = 8;
const TensorlakeMinMemoryMbPerVcpu = 1024;
const TensorlakeMaxMemoryMbPerVcpu = 8192;
const TensorlakeMinDiskMb = 10240;
const TensorlakeMaxDiskMb = 102400;

export const TensorlakeSandboxRuntimeResourceCapabilities: SandboxRuntimeResourceCapabilities = {
  // Source: Tensorlake sandbox lifecycle docs describe create-time CPU/memory
  // resources, defaulting to 1 CPU and 1024 MB, with memory accepted from
  // 1024-8192 MB per CPU core. They also document root disk size as
  // 10240-102400 MiB, defaulting to 10240 MiB.
  // https://docs.tensorlake.ai/sandboxes/lifecycle#resources
  vcpuCount: {
    min: TensorlakeMinVcpuCount,
    max: TensorlakeMaxVcpuCount,
    step: 1,
    default: 1,
  },
  memoryMb: {
    min: TensorlakeMinVcpuCount * TensorlakeMinMemoryMbPerVcpu,
    max: TensorlakeMaxVcpuCount * TensorlakeMaxMemoryMbPerVcpu,
    step: 1024,
    default: 1024,
    minPerVcpu: TensorlakeMinMemoryMbPerVcpu,
    maxPerVcpu: TensorlakeMaxMemoryMbPerVcpu,
  },
  diskMb: {
    min: TensorlakeMinDiskMb,
    max: TensorlakeMaxDiskMb,
    step: 1024,
    default: TensorlakeMinDiskMb,
  },
};
