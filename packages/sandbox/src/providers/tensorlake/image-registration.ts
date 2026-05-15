import { createSandboxImage } from "tensorlake";

import type { SandboxSdkImageBaseImageSource } from "../../types.js";
import { createTensorlakeSandboxBaseImage } from "./base-image-definition.js";

const TensorlakeApiKeyEnv = "TENSORLAKE_API_KEY";

export type RegisterTensorlakeSandboxBaseImageInput = {
  readonly apiKey: string;
  readonly contextPath: string;
  readonly source: Omit<SandboxSdkImageBaseImageSource, "contextPath" | "kind">;
};

export async function registerTensorlakeSandboxBaseImage(
  input: RegisterTensorlakeSandboxBaseImageInput,
): Promise<void> {
  await withTensorlakeApiKey(input.apiKey, async () => {
    await createSandboxImage(
      createTensorlakeSandboxBaseImage({
        baseImageRef: input.source.baseImageRef,
        name: input.source.imageId,
        ...(input.source.sandboxd === undefined ? {} : { sandboxd: input.source.sandboxd }),
      }),
      {
        registeredName: input.source.imageId,
        contextDir: input.contextPath,
        verbose: true,
      },
    );
  });
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
