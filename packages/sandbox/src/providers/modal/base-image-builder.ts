import { SandboxConfigurationError } from "../../errors.js";
import {
  SandboxBaseImageSourceKinds,
  SandboxProvider,
  type SandboxBaseImageBuilder,
  type SandboxEnsureBaseImageRequest,
  type SandboxImageHandle,
} from "../../types.js";
import type { ModalClientApi } from "./client.js";

export type ModalBaseImageBuilderOptions = {
  readonly client: ModalClientApi;
};

export class ModalBaseImageBuilder implements SandboxBaseImageBuilder {
  readonly #client: ModalClientApi;

  constructor(options: ModalBaseImageBuilderOptions) {
    this.#client = options.client;
  }

  async ensureBaseImage(request: SandboxEnsureBaseImageRequest): Promise<SandboxImageHandle> {
    if (request.platform !== undefined) {
      throw new SandboxConfigurationError(
        "Modal base image builder does not support platform overrides.",
      );
    }

    if (request.source.kind !== SandboxBaseImageSourceKinds.IMAGE) {
      throw new SandboxConfigurationError(
        "Modal base image builder requires a registry image source.",
      );
    }

    const response = await this.#client.prepareImage({ imageId: request.source.imageId });
    return {
      provider: SandboxProvider.MODAL,
      imageId: response.imageId,
      createdAt: new Date().toISOString(),
    };
  }
}

export function createModalBaseImageBuilder(
  options: ModalBaseImageBuilderOptions,
): ModalBaseImageBuilder {
  return new ModalBaseImageBuilder(options);
}
