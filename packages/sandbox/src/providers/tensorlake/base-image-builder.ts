import { createSandboxImage } from "tensorlake";

import { SandboxConfigurationError } from "../../errors.js";
import {
  SandboxBaseImageSourceKinds,
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

export type TensorlakeBaseImageBuilderOptions = {
  readonly config: TensorlakeSandboxConfig;
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

    try {
      await withTensorlakeApiKey(config.apiKey, async () => {
        await createSandboxImage(
          createTensorlakeSandboxBaseImage({
            name: source.imageId,
            sandboxd: source.sandboxd,
          }),
          {
            registeredName: source.imageId,
            contextDir: source.contextPath,
            verbose: true,
          },
        );
      });
    } catch (error) {
      throw mapTensorlakeClientError(TensorlakeClientOperationIds.BUILD_BASE_IMAGE, error);
    }

    return createTensorlakeRegisteredImageHandle(request.source.imageId);
  }
}

export function createTensorlakeBaseImageBuilder(
  options: TensorlakeBaseImageBuilderOptions,
): TensorlakeBaseImageBuilder {
  return new TensorlakeBaseImageBuilder(options);
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
