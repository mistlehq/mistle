import { SandboxConfigurationError } from "../../errors.js";
import {
  SandboxBaseImageSourceKinds,
  SandboxProvider,
  type SandboxBaseImageBuilder,
  type SandboxEnsureBaseImageRequest,
  type SandboxImageHandle,
} from "../../types.js";
import { validateE2BSandboxConfig, type E2BSandboxConfig } from "./config.js";
import { ensureE2BTemplateAlias } from "./template-build.js";

export type E2BBaseImageBuilderOptions = {
  readonly config: E2BSandboxConfig;
  readonly lockDirectoryPath?: string;
};

export class E2BBaseImageBuilder implements SandboxBaseImageBuilder {
  readonly #options: E2BBaseImageBuilderOptions;

  constructor(options: E2BBaseImageBuilderOptions) {
    this.#options = options;
  }

  async ensureBaseImage(request: SandboxEnsureBaseImageRequest): Promise<SandboxImageHandle> {
    if (request.source.kind !== SandboxBaseImageSourceKinds.IMAGE) {
      throw new SandboxConfigurationError("E2B base image builder requires an image source.");
    }

    const config = validateE2BSandboxConfig(this.#options.config);
    const result = await ensureE2BTemplateAlias({
      baseRef: request.source.imageId,
      connectionOptions: {
        apiKey: config.apiKey,
        ...(config.domain === undefined ? {} : { domain: config.domain }),
      },
      cpuCount: config.cpuCount,
      memoryMb: config.memoryMb,
      ...(this.#options.lockDirectoryPath === undefined
        ? {}
        : { lockDirectoryPath: this.#options.lockDirectoryPath }),
    });

    return {
      provider: SandboxProvider.E2B,
      imageId: result.alias,
      createdAt: new Date().toISOString(),
    };
  }
}

export function createE2BBaseImageBuilder(
  options: E2BBaseImageBuilderOptions,
): E2BBaseImageBuilder {
  return new E2BBaseImageBuilder(options);
}
