import { createHash } from "node:crypto";

import { SandboxConfigurationError } from "../../errors.js";
import { SandboxProvider, type SandboxImageHandle } from "../../types.js";
import { TensorlakeStartImageKinds, type TensorlakeStartImageKind } from "./schemas.js";

const TensorlakeImageHandlePrefix = "tensorlake:";
const TensorlakeSandboxBaseImageNamePrefix = "mistle";
const TensorlakeSha256DigestPrefix = "@sha256:";
const TensorlakeBaseImageDigestLength = 24;

export type TensorlakeStartImage = {
  readonly kind: TensorlakeStartImageKind;
  readonly id: string;
};

export function createTensorlakeRegisteredImageHandle(imageName: string): SandboxImageHandle {
  return createTensorlakeImageHandle(TensorlakeStartImageKinds.IMAGE, imageName);
}

export function createTensorlakeSnapshotImageHandle(snapshotId: string): SandboxImageHandle {
  return createTensorlakeImageHandle(TensorlakeStartImageKinds.SNAPSHOT, snapshotId);
}

export function parseTensorlakeImageHandle(handle: SandboxImageHandle): TensorlakeStartImage {
  if (handle.provider !== SandboxProvider.TENSORLAKE) {
    throw new SandboxConfigurationError(
      "Tensorlake adapter received a non-Tensorlake image handle.",
    );
  }

  if (!handle.imageId.startsWith(TensorlakeImageHandlePrefix)) {
    throw new SandboxConfigurationError(
      "Tensorlake image handle must be encoded with a Tensorlake image kind.",
    );
  }

  const raw = handle.imageId.slice(TensorlakeImageHandlePrefix.length);
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) {
    throw new SandboxConfigurationError("Tensorlake image handle is malformed.");
  }

  const kind = raw.slice(0, separatorIndex);
  const id = raw.slice(separatorIndex + 1);

  if (kind === TensorlakeStartImageKinds.IMAGE || kind === TensorlakeStartImageKinds.SNAPSHOT) {
    return { kind, id };
  }

  throw new SandboxConfigurationError(`Unsupported Tensorlake image handle kind "${kind}".`);
}

export function resolveTensorlakeStartImage(handle: SandboxImageHandle): TensorlakeStartImage {
  if (handle.provider !== SandboxProvider.TENSORLAKE) {
    throw new SandboxConfigurationError(
      "Tensorlake adapter received a non-Tensorlake image handle.",
    );
  }

  if (handle.imageId.startsWith(TensorlakeImageHandlePrefix)) {
    return parseTensorlakeImageHandle(handle);
  }

  if (isGhcrImageRef(handle.imageId)) {
    return {
      kind: TensorlakeStartImageKinds.IMAGE,
      id: createTensorlakeRegisteredBaseImageName(handle.imageId),
    };
  }

  return {
    kind: TensorlakeStartImageKinds.IMAGE,
    id: requireNonEmptyTensorlakeImageId(handle.imageId),
  };
}

export function createTensorlakeRegisteredBaseImageName(baseImageRef: string): string {
  return `${TensorlakeSandboxBaseImageNamePrefix}-${createTensorlakeBaseImageNameDigest(baseImageRef)}`;
}

function createTensorlakeImageHandle(
  kind: TensorlakeStartImageKind,
  id: string,
): SandboxImageHandle {
  return {
    provider: SandboxProvider.TENSORLAKE,
    imageId: `${TensorlakeImageHandlePrefix}${kind}:${requireNonEmptyTensorlakeImageId(id)}`,
    createdAt: new Date().toISOString(),
  };
}

function isGhcrImageRef(imageId: string): boolean {
  return imageId.trim().startsWith("ghcr.io/");
}

function requireNonEmptyTensorlakeImageId(imageId: string): string {
  const normalizedImageId = imageId.trim();
  if (normalizedImageId.length === 0) {
    throw new SandboxConfigurationError("Tensorlake image handle id is required.");
  }
  return normalizedImageId;
}

function createTensorlakeBaseImageNameDigest(baseImageRef: string): string {
  const normalizedBaseImageRef = requireNonEmptyTensorlakeImageId(baseImageRef);
  const digestIndex = normalizedBaseImageRef.indexOf(TensorlakeSha256DigestPrefix);
  if (digestIndex >= 0) {
    const digest = normalizedBaseImageRef.slice(digestIndex + TensorlakeSha256DigestPrefix.length);
    if (/^[a-f0-9]{64}$/u.test(digest)) {
      return digest.slice(0, TensorlakeBaseImageDigestLength);
    }
  }

  return createHash("sha256").update(normalizedBaseImageRef).digest("hex").slice(0, 24);
}
