import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { SandboxConfigurationError } from "../../errors.js";
import {
  SandboxBaseImageSourceKinds,
  SandboxProvider,
  SandboxSdkImageSandboxdSourceKinds,
  type SandboxBaseImageBuilder,
  type SandboxEnsureBaseImageRequest,
  type SandboxImageHandle,
  type SandboxSdkImageBaseImageSource,
} from "../../types.js";
import type { FreestyleClient } from "./client.js";
import { createFreestyleSnapshotImageHandle } from "./image-handle.js";

const FreestyleCmddirRelativePath = "packages/sandboxd/scripts/cmddir";
const FreestyleBuildBaseImageRequestTimeoutMs = 15 * 60 * 1000;

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

    const cmddirBase64 = await readFreestyleCmddirBase64(request.source);
    const response = await this.#client.createSnapshotImage({
      imageId: request.source.imageId,
      baseImageRef: request.source.baseImageRef,
      cmddirBase64,
      requestTimeoutMs: FreestyleBuildBaseImageRequestTimeoutMs,
      ...(request.source.sandboxd?.kind === SandboxSdkImageSandboxdSourceKinds.RELEASE
        ? { sandboxd: { artifact: request.source.sandboxd.artifact } }
        : {}),
    });

    return {
      provider: SandboxProvider.FREESTYLE,
      imageId: response.snapshotId,
      createdAt: new Date().toISOString(),
    };
  }
}

export function createFreestyleBaseImageBuilder(
  options: FreestyleBaseImageBuilderOptions,
): FreestyleBaseImageBuilder {
  return new FreestyleBaseImageBuilder(options);
}

export async function readFreestyleCmddirBase64(
  source: SandboxSdkImageBaseImageSource,
): Promise<string> {
  const contextPath = await resolveFreestyleSdkImageContextPath(source.contextPath);
  const content = await readFile(resolve(contextPath, FreestyleCmddirRelativePath));
  return content.toString("base64");
}

export async function resolveFreestyleSdkImageContextPath(startDirectory: string): Promise<string> {
  let currentDirectory = resolve(startDirectory);

  while (true) {
    const candidatePath = resolve(currentDirectory, FreestyleCmddirRelativePath);
    try {
      await access(candidatePath);
      return currentDirectory;
    } catch {
      const parentDirectory = dirname(currentDirectory);
      if (parentDirectory === currentDirectory) {
        throw new SandboxConfigurationError(
          `Freestyle SDK image context must contain '${FreestyleCmddirRelativePath}' at or above '${startDirectory}'.`,
        );
      }

      currentDirectory = parentDirectory;
    }
  }
}

function validateSdkImageSource(request: {
  readonly platform?: string;
  readonly source: SandboxSdkImageBaseImageSource;
}): void {
  if (request.platform !== undefined) {
    throw new SandboxConfigurationError(
      "Freestyle base image builder does not support platform overrides.",
    );
  }

  if (request.source.contextPath.trim() === "") {
    throw new SandboxConfigurationError(
      "Freestyle base image builder requires a non-empty SDK image context path.",
    );
  }

  if (request.source.baseImageRef.trim() === "") {
    throw new SandboxConfigurationError(
      "Freestyle base image builder requires a non-empty source image ref.",
    );
  }
}
