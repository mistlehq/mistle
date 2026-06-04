import { describe, expect, it } from "vitest";

import {
  MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REGISTRY_STORAGE_DIR_ENV,
  MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REF_ENV,
  MISTLE_SYSTEM_TEST_TENSORLAKE_SANDBOX_BASE_IMAGE_REF_ENV,
  readOptionalTensorlakeSystemTestSandboxBaseImageRef,
  readSystemTestSandboxBaseImageRegistryStorageDir,
  resolveSystemTestSandboxBaseImageSource,
} from "./system-test-sandbox-base-image-source.js";
import { createTensorlakeSystemTestSandboxBaseImageRef } from "./system-test-sandbox-base-image.js";

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

describe("readOptionalTensorlakeSystemTestSandboxBaseImageRef", () => {
  it("reads an explicit Tensorlake system image handle override", () => {
    expect(
      readOptionalTensorlakeSystemTestSandboxBaseImageRef({
        [MISTLE_SYSTEM_TEST_TENSORLAKE_SANDBOX_BASE_IMAGE_REF_ENV]:
          " tensorlake:image:mistle-system-test ",
      }),
    ).toBe("tensorlake:image:mistle-system-test");
  });

  it("uses no explicit Tensorlake system image handle when the override is absent", () => {
    expect(readOptionalTensorlakeSystemTestSandboxBaseImageRef({})).toBeUndefined();
  });

  it("requires explicit Tensorlake runtime test overrides to use a Tensorlake image handle", () => {
    expect(() =>
      readOptionalTensorlakeSystemTestSandboxBaseImageRef({
        [MISTLE_SYSTEM_TEST_TENSORLAKE_SANDBOX_BASE_IMAGE_REF_ENV]:
          "ghcr.io/mistlehq/sandbox-base:sys-test",
      }),
    ).toThrow(
      `${MISTLE_SYSTEM_TEST_TENSORLAKE_SANDBOX_BASE_IMAGE_REF_ENV} must be a Tensorlake image handle.`,
    );
  });
});

describe("createTensorlakeSystemTestSandboxBaseImageRef", () => {
  it("derives the deterministic Tensorlake image handle for a shared GHCR system image", () => {
    expect(
      createTensorlakeSystemTestSandboxBaseImageRef(
        "ghcr.io/mistlehq/sandbox-base:sys-d7881d87c319dad668a6f4df",
      ),
    ).toBe("tensorlake:image:mistle-624c0037585d4ef5851b4125");
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
