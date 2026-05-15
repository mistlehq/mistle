import { mkdir, mkdtemp, rm, cp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { createSandboxImage } from "tensorlake";

import { SandboxConfigurationError } from "../../errors.js";
import {
  SandboxBaseImageSourceKinds,
  SandboxSdkImageSandboxdSourceKinds,
  type SandboxBaseImageBuilder,
  type SandboxEnsureBaseImageRequest,
  type SandboxSdkImageBaseImageSource,
  type SandboxImageHandle,
} from "../../types.js";
import { createTensorlakeSandboxBaseImage } from "./base-image-definition.js";
import { TensorlakeClientOperationIds, mapTensorlakeClientError } from "./client-errors.js";
import { validateTensorlakeSandboxConfig, type TensorlakeSandboxConfig } from "./config.js";
import { createTensorlakeRegisteredImageHandle } from "./image-handle.js";

const TensorlakeApiKeyEnv = "TENSORLAKE_API_KEY";
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
      await withTensorlakeApiKey(config.apiKey, async () => {
        await createSandboxImage(
          createTensorlakeSandboxBaseImage({
            baseImageRef: source.baseImageRef,
            name: source.imageId,
            ...(source.sandboxd === undefined ? {} : { sandboxd: source.sandboxd }),
          }),
          {
            registeredName: source.imageId,
            contextDir: buildContext.path,
            verbose: true,
          },
        );
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

async function withTensorlakeApiKey<Result>(
  apiKey: string,
  operation: () => Promise<Result>,
): Promise<Result> {
  const previousApiKey = process.env[TensorlakeApiKeyEnv];
  process.env[TensorlakeApiKeyEnv] = apiKey;

  try {
    return await operation();
  } finally {
    if (previousApiKey === undefined) {
      delete process.env[TensorlakeApiKeyEnv];
    } else {
      process.env[TensorlakeApiKeyEnv] = previousApiKey;
    }
  }
}
