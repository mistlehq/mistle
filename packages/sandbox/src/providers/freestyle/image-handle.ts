import { createHash } from "node:crypto";

import { SandboxConfigurationError } from "../../errors.js";
import { SandboxProvider, type SandboxImageHandle } from "../../types.js";

const FreestyleSandboxBaseImageNamePrefix = "mistle";
const FreestyleSha256DigestPrefix = "@sha256:";
const FreestyleBaseImageDigestLength = 24;

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

export function createFreestyleSnapshotBaseImageName(baseImageRef: string): string {
  return `${FreestyleSandboxBaseImageNamePrefix}-${createFreestyleBaseImageNameDigest(baseImageRef)}`;
}

function createFreestyleBaseImageNameDigest(baseImageRef: string): string {
  const normalizedBaseImageRef = requireNonEmptyFreestyleImageId(baseImageRef);
  const digestIndex = normalizedBaseImageRef.indexOf(FreestyleSha256DigestPrefix);
  if (digestIndex >= 0) {
    const digest = normalizedBaseImageRef.slice(digestIndex + FreestyleSha256DigestPrefix.length);
    if (/^[a-f0-9]{64}$/u.test(digest)) {
      return digest.slice(0, FreestyleBaseImageDigestLength);
    }
  }

  return createHash("sha256")
    .update(normalizedBaseImageRef)
    .digest("hex")
    .slice(0, FreestyleBaseImageDigestLength);
}

function requireNonEmptyFreestyleImageId(imageId: string): string {
  const normalizedImageId = imageId.trim();
  if (normalizedImageId.length === 0) {
    throw new SandboxConfigurationError("Freestyle image handle id is required.");
  }
  return normalizedImageId;
}
