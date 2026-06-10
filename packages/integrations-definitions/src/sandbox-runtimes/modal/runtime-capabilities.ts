import type { SandboxRuntimeResourceCapabilities } from "@mistle/integrations-core";

export const ModalSandboxRuntimeResourceCapabilities: SandboxRuntimeResourceCapabilities = {
  // Modal VM sandbox creation accepts cpu and memory controls, and VM memory is
  // provisioned statically. Mistle advertises a conservative selectable subset
  // because account-specific Modal limits can vary.
  // https://modal.com/docs/guide/vm-sandboxes#resource-model
  vcpuCount: {
    min: 1,
    max: 8,
    step: 1,
    default: 1,
  },
  memoryMb: {
    min: 1024,
    max: 32_768,
    step: 1024,
    default: 4096,
  },
};
