import { SandboxConfigurationError } from "../../errors.js";
import {
  SandboxBaseImageSourceKinds,
  type SandboxBaseImageBuilder,
  type SandboxEnsureBaseImageRequest,
  type SandboxSdkImageBaseImageSource,
  type SandboxImageHandle,
} from "../../types.js";
import { TensorlakeClientOperationIds, mapTensorlakeClientError } from "./client-errors.js";
import { validateTensorlakeSandboxConfig, type TensorlakeSandboxConfig } from "./config.js";
import { createTensorlakeRegisteredImageHandle } from "./image-handle.js";
import { registerTensorlakeSandboxBaseImage } from "./image-registration.js";

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
      await registerTensorlakeSandboxBaseImage({
        apiKey: config.apiKey,
        source: {
          baseImageRef: source.baseImageRef,
          imageId: source.imageId,
        },
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
      "Tensorlake base image import requires a non-empty source context path.",
    );
  }

  if (request.source.baseImageRef.trim() === "") {
    throw new SandboxConfigurationError(
      "Tensorlake base image import requires a non-empty source image ref.",
    );
  }

  if (request.source.imageId.trim() === "") {
    throw new SandboxConfigurationError(
      "Tensorlake base image import requires a non-empty registered image name.",
    );
  }
}
