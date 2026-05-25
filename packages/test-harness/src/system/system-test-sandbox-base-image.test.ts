import { describe, expect, it } from "vitest";

import {
  MISTLE_SYSTEM_TEST_SANDBOX_BASE_IMAGE_REF_ENV,
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
