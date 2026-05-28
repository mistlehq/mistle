import { describe, expect, it } from "vitest";

import {
  MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REGISTRY_STORAGE_DIR_ENV,
  MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REF_ENV,
  readSystemTestSandboxBaseImageRegistryStorageDir,
  resolveSystemTestSandboxBaseImageSource,
} from "./system-test-sandbox-base-image-source.js";

const LocalSandboxBaseImageRef = "mistle/sandbox-base:dev";
const PrepublishedSandboxBaseImageRef =
  "ghcr.io/mistlehq/sandbox-base:sys-1234567890abcdef12345678";

describe("resolveSystemTestSandboxBaseImageSource", () => {
  it("uses the prepublished system image when CI provides one", () => {
    expect(
      resolveSystemTestSandboxBaseImageSource({
        env: {
          [MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REF_ENV]: PrepublishedSandboxBaseImageRef,
        },
        localImageRef: LocalSandboxBaseImageRef,
      }),
    ).toEqual({
      kind: "prepublished",
      imageRef: PrepublishedSandboxBaseImageRef,
    });
  });

  it("trims the prepublished system image reference", () => {
    expect(
      resolveSystemTestSandboxBaseImageSource({
        env: {
          [MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REF_ENV]: ` ${PrepublishedSandboxBaseImageRef} `,
        },
        localImageRef: LocalSandboxBaseImageRef,
      }),
    ).toEqual({
      kind: "prepublished",
      imageRef: PrepublishedSandboxBaseImageRef,
    });
  });

  it("uses the prepared local image when no prepublished image is configured", () => {
    expect(
      resolveSystemTestSandboxBaseImageSource({
        env: {},
        localImageRef: LocalSandboxBaseImageRef,
      }),
    ).toEqual({
      kind: "local",
      imageRef: LocalSandboxBaseImageRef,
    });
  });
});

describe("readSystemTestSandboxBaseImageRegistryStorageDir", () => {
  it("uses no persistent registry storage when no directory is configured", () => {
    expect(readSystemTestSandboxBaseImageRegistryStorageDir({})).toBeUndefined();
  });

  it("trims the configured persistent registry storage directory", () => {
    expect(
      readSystemTestSandboxBaseImageRegistryStorageDir({
        [MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REGISTRY_STORAGE_DIR_ENV]:
          " /tmp/mistle-system-registry ",
      }),
    ).toBe("/tmp/mistle-system-registry");
  });

  it("rejects relative persistent registry storage directories", () => {
    expect(() =>
      readSystemTestSandboxBaseImageRegistryStorageDir({
        [MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REGISTRY_STORAGE_DIR_ENV]: "mistle-system-registry",
      }),
    ).toThrow(
      `${MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REGISTRY_STORAGE_DIR_ENV} must be an absolute path.`,
    );
  });
});
