import { SandboxConfigurationError } from "../../errors.js";
import {
  SandboxBaseImageSourceKinds,
  SandboxSdkImageSandboxdSourceKinds,
  type SandboxBaseImageBuilder,
  type SandboxEnsureBaseImageRequest,
  type SandboxImageHandle,
} from "../../types.js";
import type { OpenComputerClient } from "./client.js";
import {
  createOpenComputerBaseImage,
  createOpenComputerImageManifest,
} from "./image-definition.js";
import {
  createOpenComputerBaseImageName,
  createOpenComputerDeferredImageHandle,
} from "./image-handle.js";

export type OpenComputerBaseImageBuilderOptions = {
  readonly client: OpenComputerClient;
};

export class OpenComputerBaseImageBuilder implements SandboxBaseImageBuilder {
  constructor(_options: OpenComputerBaseImageBuilderOptions) {}

  async ensureBaseImage(request: SandboxEnsureBaseImageRequest): Promise<SandboxImageHandle> {
    if (request.platform !== undefined) {
      throw new SandboxConfigurationError(
        "OpenComputer base image builder does not support platform overrides.",
      );
    }

    if (request.source.kind === SandboxBaseImageSourceKinds.IMAGE) {
      const image = createOpenComputerBaseImage({
        source: {
          kind: "image",
          imageId: request.source.imageId,
        },
      });
      const manifest = createOpenComputerImageManifest(image);
      return createOpenComputerDeferredImageHandle({
        imageName: createOpenComputerBaseImageName({
          baseImageRef: request.source.imageId,
          manifest,
        }),
        manifest,
      });
    }

    if (request.source.kind !== SandboxBaseImageSourceKinds.SDK_IMAGE) {
      throw new SandboxConfigurationError(
        "OpenComputer base image builder requires an image or SDK image source.",
      );
    }

    const imageId = request.source.imageId.trim();
    if (imageId.length === 0) {
      throw new SandboxConfigurationError(
        "OpenComputer base image builder requires a non-empty SDK image id.",
      );
    }

    if (request.source.sandboxd?.kind === SandboxSdkImageSandboxdSourceKinds.LOCAL) {
      throw new SandboxConfigurationError(
        "OpenComputer base image builder requires a release sandboxd artifact for SDK image sources.",
      );
    }

    const image = createOpenComputerBaseImage({
      source: {
        kind: "sdk_image",
        imageId,
        baseImageRef: request.source.baseImageRef,
      },
      ...(request.source.sandboxd?.kind === SandboxSdkImageSandboxdSourceKinds.RELEASE
        ? {
            sandboxd: {
              kind: SandboxSdkImageSandboxdSourceKinds.RELEASE,
              artifact: request.source.sandboxd.artifact,
            },
          }
        : {}),
    });

    return createOpenComputerDeferredImageHandle({
      imageName: imageId,
      manifest: createOpenComputerImageManifest(image),
    });
  }
}

export function createOpenComputerBaseImageBuilder(
  options: OpenComputerBaseImageBuilderOptions,
): OpenComputerBaseImageBuilder {
  return new OpenComputerBaseImageBuilder(options);
}
