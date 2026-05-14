import { SandboxConfigurationError } from "../../errors.js";
import { SandboxProvider, type SandboxImageHandle } from "../../types.js";
import { TensorlakeStartImageKinds, type TensorlakeStartImageKind } from "./schemas.js";

const TensorlakeImageHandlePrefix = "tensorlake:";

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

function createTensorlakeImageHandle(
  kind: TensorlakeStartImageKind,
  id: string,
): SandboxImageHandle {
  if (id.trim().length === 0) {
    throw new SandboxConfigurationError("Tensorlake image handle id is required.");
  }

  return {
    provider: SandboxProvider.TENSORLAKE,
    imageId: `${TensorlakeImageHandlePrefix}${kind}:${id}`,
    createdAt: new Date().toISOString(),
  };
}
