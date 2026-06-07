import { SandboxConfigurationError } from "../../errors.js";
import { SandboxProvider, type SandboxImageHandle } from "../../types.js";

export function createFreestyleSnapshotImageHandle(snapshotId: string): SandboxImageHandle {
  if (snapshotId.trim().length === 0) {
    throw new SandboxConfigurationError("Freestyle snapshot id is required.");
  }

  return {
    provider: SandboxProvider.FREESTYLE,
    imageId: snapshotId,
    createdAt: new Date().toISOString(),
  };
}

export function parseFreestyleImageHandle(handle: SandboxImageHandle): { snapshotId: string } {
  if (handle.provider !== SandboxProvider.FREESTYLE) {
    throw new SandboxConfigurationError(
      `Expected Freestyle image handle, received provider '${handle.provider}'.`,
    );
  }

  if (handle.imageId.trim().length === 0) {
    throw new SandboxConfigurationError("Freestyle image handle requires a snapshot id.");
  }

  return { snapshotId: handle.imageId };
}
