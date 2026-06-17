import { SandboxConfigurationError } from "../../errors.js";
import {
  SandboxBaseImageSourceKinds,
  type SandboxBaseImageBuilder,
  type SandboxEnsureBaseImageRequest,
  type SandboxImageHandle,
} from "../../types.js";
import { TensorlakeClientOperationIds, mapTensorlakeClientError } from "./client-errors.js";
import { validateTensorlakeSandboxConfig, type TensorlakeSandboxConfig } from "./config.js";
import {
  createTensorlakeRegisteredBaseImageName,
  createTensorlakeRegisteredImageHandle,
} from "./image-handle.js";
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
    const source = resolveTensorlakeImportSource(request);
    let importError: unknown;

    try {
      await registerTensorlakeSandboxBaseImage({
        apiKey: config.apiKey,
        registeredName: source.registeredName,
        sourceImageRef: source.sourceImageRef,
      });
    } catch (error) {
      importError = mapTensorlakeClientError(TensorlakeClientOperationIds.IMPORT_BASE_IMAGE, error);
    }

    if (importError !== undefined) {
      throw importError;
    }

    return createTensorlakeRegisteredImageHandle(source.registeredName);
  }
}

export function createTensorlakeBaseImageBuilder(
  options: TensorlakeBaseImageBuilderOptions,
): TensorlakeBaseImageBuilder {
  return new TensorlakeBaseImageBuilder(options);
}

export function resolveTensorlakeImportSource(request: SandboxEnsureBaseImageRequest): {
  readonly registeredName: string;
  readonly sourceImageRef: string;
} {
  if (request.platform !== undefined) {
    throw new SandboxConfigurationError(
      "Tensorlake base image import does not support platform overrides.",
    );
  }

  if (request.source.kind === SandboxBaseImageSourceKinds.IMAGE) {
    const sourceImageRef = requireNonEmptyValue({
      field: "source image ref",
      value: request.source.imageId,
    });
    return {
      registeredName: createTensorlakeRegisteredBaseImageName(sourceImageRef),
      sourceImageRef,
    };
  }

  if (request.source.kind === SandboxBaseImageSourceKinds.SDK_IMAGE) {
    return {
      registeredName: requireNonEmptyValue({
        field: "registered image name",
        value: request.source.imageId,
      }),
      sourceImageRef: requireNonEmptyValue({
        field: "source image ref",
        value: request.source.baseImageRef,
      }),
    };
  }

  throw new SandboxConfigurationError(
    "Tensorlake base image builder requires an image source or SDK image source.",
  );
}

function requireNonEmptyValue(input: { readonly field: string; readonly value: string }): string {
  const normalizedValue = input.value.trim();
  if (normalizedValue.length === 0) {
    throw new SandboxConfigurationError(
      `Tensorlake base image import requires a non-empty ${input.field}.`,
    );
  }
  return normalizedValue;
}
