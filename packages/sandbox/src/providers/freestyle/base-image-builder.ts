import { SandboxConfigurationError } from "../../errors.js";
import {
  SandboxBaseImageSourceKinds,
  SandboxProvider,
  SandboxSdkImageSandboxdSourceKinds,
  type SandboxBaseImageBuilder,
  type SandboxEnsureBaseImageRequest,
  type SandboxImageHandle,
} from "../../types.js";
import { createFreestyleBaseImageSetupCommands } from "./base-image-definition.js";
import { FreestyleClientOperationIds } from "./client-errors.js";
import type { FreestyleClient } from "./client.js";
import { createFreestyleSnapshotImageHandle } from "./image-handle.js";

const FreestyleBuildBaseImageRequestTimeoutMs = 15 * 60 * 1000;
const FreestyleBuilderVmIdleTimeoutSeconds = 15 * 60;

export type FreestyleBaseImageBuilderOptions = {
  readonly client: FreestyleClient;
};

export class FreestyleBaseImageBuilder implements SandboxBaseImageBuilder {
  readonly #client: FreestyleClient;

  constructor(options: FreestyleBaseImageBuilderOptions) {
    this.#client = options.client;
  }

  async ensureBaseImage(request: SandboxEnsureBaseImageRequest): Promise<SandboxImageHandle> {
    if (request.source.kind === SandboxBaseImageSourceKinds.IMAGE) {
      return createFreestyleSnapshotImageHandle(request.source.imageId);
    }

    if (request.source.kind !== SandboxBaseImageSourceKinds.SDK_IMAGE) {
      throw new SandboxConfigurationError(
        "Freestyle base image builder requires an image or SDK image source.",
      );
    }

    validateSdkImageSource({
      ...(request.platform === undefined ? {} : { platform: request.platform }),
      source: request.source,
    });

    const createImageRequest = {
      imageId: request.source.imageId,
      baseImageRef: request.source.baseImageRef,
      requestTimeoutMs: FreestyleBuildBaseImageRequestTimeoutMs,
      ...(request.source.sandboxd?.kind === SandboxSdkImageSandboxdSourceKinds.RELEASE
        ? { sandboxd: { artifact: request.source.sandboxd.artifact } }
        : {}),
    };
    const builderSandbox = await this.#client.createBuilderSandbox({
      name: request.source.imageId,
      idleTimeoutSeconds: FreestyleBuilderVmIdleTimeoutSeconds,
    });
    let buildError: unknown;
    let capturedSnapshot: { snapshotId: string } | undefined;

    try {
      for (const command of createFreestyleBaseImageSetupCommands(createImageRequest)) {
        await this.#client.runCommand({
          vmId: builderSandbox.vmId,
          command,
          operation: FreestyleClientOperationIds.BUILD_BASE_IMAGE,
          commandDescription: "Install Mistle base image dependencies in Freestyle builder VM",
          timeoutMs: FreestyleBuildBaseImageRequestTimeoutMs,
        });
      }

      capturedSnapshot = await this.#client.captureSandboxSnapshot({
        vmId: builderSandbox.vmId,
        requestTimeoutMs: FreestyleBuildBaseImageRequestTimeoutMs,
      });
    } catch (error) {
      buildError = error;
    }

    try {
      await this.#client.destroySandbox({ vmId: builderSandbox.vmId });
    } catch (cleanupError) {
      if (buildError === undefined) {
        throw cleanupError;
      }

      console.error(`Failed to delete Freestyle base image builder VM ${builderSandbox.vmId}.`);
    }

    if (buildError !== undefined) {
      throw buildError;
    }
    if (capturedSnapshot === undefined) {
      throw new Error("Freestyle base image builder did not capture a snapshot.");
    }

    return {
      provider: SandboxProvider.FREESTYLE,
      imageId: capturedSnapshot.snapshotId,
      createdAt: new Date().toISOString(),
    };
  }
}

export function createFreestyleBaseImageBuilder(
  options: FreestyleBaseImageBuilderOptions,
): FreestyleBaseImageBuilder {
  return new FreestyleBaseImageBuilder(options);
}

function validateSdkImageSource(request: {
  readonly platform?: string;
  readonly source: Extract<SandboxEnsureBaseImageRequest["source"], { kind: "sdk_image" }>;
}): void {
  if (request.platform !== undefined) {
    throw new SandboxConfigurationError(
      "Freestyle base image builder does not support platform overrides.",
    );
  }

  if (request.source.baseImageRef.trim() === "") {
    throw new SandboxConfigurationError(
      "Freestyle base image builder requires a non-empty source image ref.",
    );
  }

  if (request.source.imageId.trim() === "") {
    throw new SandboxConfigurationError(
      "Freestyle base image builder requires a non-empty image id.",
    );
  }

  if (
    request.source.sandboxd !== undefined &&
    request.source.sandboxd.kind !== SandboxSdkImageSandboxdSourceKinds.RELEASE
  ) {
    throw new SandboxConfigurationError(
      "Freestyle base image builder only supports release sandboxd artifacts.",
    );
  }
}
