import { mkdir, mkdtemp, rm, cp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { SandboxConfigurationError } from "../../errors.js";
import {
  SandboxBaseImageSourceKinds,
  SandboxSdkImageSandboxdSourceKinds,
  type SandboxBaseImageBuilder,
  type SandboxEnsureBaseImageRequest,
  type SandboxSdkImageBaseImageSource,
  type SandboxImageHandle,
} from "../../types.js";
import { TensorlakeClientOperationIds, mapTensorlakeClientError } from "./client-errors.js";
import { validateTensorlakeSandboxConfig, type TensorlakeSandboxConfig } from "./config.js";
import { createTensorlakeRegisteredImageHandle } from "./image-handle.js";
import { registerTensorlakeSandboxBaseImage } from "./image-registration.js";

const TensorlakeLocalSandboxdPartsRelativePath =
  "packages/sandboxd/.generated/tensorlake/sandboxd-parts";
const TensorlakeBuildContextPlaceholderFile = ".mistle-tensorlake-context";

export type TensorlakeBaseImageBuilderOptions = {
  readonly config: TensorlakeSandboxConfig;
};

export type TensorlakeSdkImageBuildContext = {
  readonly path: string;
  readonly cleanup: () => Promise<void>;
};

export class TensorlakeBaseImageBuilder implements SandboxBaseImageBuilder {
  readonly #options: TensorlakeBaseImageBuilderOptions;

  constructor(options: TensorlakeBaseImageBuilderOptions) {
    this.#options = options;
  }

  async ensureBaseImage(request: SandboxEnsureBaseImageRequest): Promise<SandboxImageHandle> {
    const config = validateTensorlakeSandboxConfig(this.#options.config);

    if (request.source.kind === SandboxBaseImageSourceKinds.IMAGE) {
      return createTensorlakeRegisteredImageHandle(request.source.imageId);
    }

    if (request.source.kind !== SandboxBaseImageSourceKinds.SDK_IMAGE) {
      throw new SandboxConfigurationError(
        "Tensorlake base image builder requires an SDK image source.",
      );
    }

    const source = request.source;
    validateSdkImageSource({
      ...(request.platform === undefined ? {} : { platform: request.platform }),
      source,
    });

    const buildContext = await createTensorlakeSdkImageBuildContext(source);
    let buildError: unknown;

    try {
      await registerTensorlakeSandboxBaseImage({
        apiKey: config.apiKey,
        contextPath: buildContext.path,
        source: {
          baseImageRef: source.baseImageRef,
          imageId: source.imageId,
          ...(source.sandboxd === undefined ? {} : { sandboxd: source.sandboxd }),
        },
      });
    } catch (error) {
      buildError = mapTensorlakeClientError(TensorlakeClientOperationIds.BUILD_BASE_IMAGE, error);
    }

    try {
      await buildContext.cleanup();
    } catch (cleanupError) {
      if (buildError === undefined) {
        throw cleanupError;
      }

      console.error(`Failed to remove Tensorlake image build context ${buildContext.path}.`);
    }

    if (buildError !== undefined) {
      throw buildError;
    }

    return createTensorlakeRegisteredImageHandle(request.source.imageId);
  }
}

export function createTensorlakeBaseImageBuilder(
  options: TensorlakeBaseImageBuilderOptions,
): TensorlakeBaseImageBuilder {
  return new TensorlakeBaseImageBuilder(options);
}

export async function createTensorlakeSdkImageBuildContext(
  source: SandboxSdkImageBaseImageSource,
): Promise<TensorlakeSdkImageBuildContext> {
  const buildContextPath = await mkdtemp(join(tmpdir(), "mistle-tensorlake-image-context-"));

  try {
    await writeFile(join(buildContextPath, TensorlakeBuildContextPlaceholderFile), "");

    if (source.sandboxd?.kind === SandboxSdkImageSandboxdSourceKinds.LOCAL) {
      const sourcePath = resolve(source.contextPath, TensorlakeLocalSandboxdPartsRelativePath);
      const destinationPath = resolve(buildContextPath, TensorlakeLocalSandboxdPartsRelativePath);
      await mkdir(dirname(destinationPath), { recursive: true });
      await cp(sourcePath, destinationPath, { recursive: true });
    }

    return {
      path: buildContextPath,
      cleanup: async () => {
        await rm(buildContextPath, { force: true, recursive: true });
      },
    };
  } catch (error) {
    await rm(buildContextPath, { force: true, recursive: true });
    throw error;
  }
}

function validateSdkImageSource(request: {
  readonly platform?: string;
  readonly source: SandboxSdkImageBaseImageSource;
}): void {
  if (request.platform !== undefined) {
    throw new SandboxConfigurationError(
      "Tensorlake base image builder does not support platform overrides.",
    );
  }

  if (request.source.contextPath.trim() === "") {
    throw new SandboxConfigurationError(
      "Tensorlake base image builder requires a non-empty SDK image context path.",
    );
  }

  if (request.source.baseImageRef.trim() === "") {
    throw new SandboxConfigurationError(
      "Tensorlake base image builder requires a non-empty source image ref.",
    );
  }
}
