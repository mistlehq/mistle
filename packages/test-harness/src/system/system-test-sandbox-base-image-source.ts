export const MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REF_ENV =
  "MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REF";

export type SystemTestSandboxBaseImageSource =
  | {
      kind: "prepublished";
      imageRef: string;
    }
  | {
      kind: "local";
      imageRef: string;
    };

export function resolveSystemTestSandboxBaseImageSource(input: {
  env: NodeJS.ProcessEnv;
  localImageRef: string;
}): SystemTestSandboxBaseImageSource {
  const prepublishedImageRef = readPrepublishedSystemTestSandboxBaseImageRef(input.env);
  if (prepublishedImageRef !== undefined) {
    return {
      kind: "prepublished",
      imageRef: prepublishedImageRef,
    };
  }

  return {
    kind: "local",
    imageRef: input.localImageRef,
  };
}

export function readPrepublishedSystemTestSandboxBaseImageRef(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env[MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REF_ENV];
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
}
