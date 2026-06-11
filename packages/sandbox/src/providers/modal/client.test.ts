import { describe, expect, it } from "vitest";

import {
  isModalNativeImageId,
  ModalDefaultSandboxTimeoutMs,
  resolveModalSandboxTimeoutMs,
} from "./client.js";

describe("resolveModalSandboxTimeoutMs", () => {
  it("uses the configured Modal sandbox timeout when present", () => {
    expect(resolveModalSandboxTimeoutMs({ defaultTimeoutMs: 60_000 })).toBe(60_000);
  });

  it("uses Mistle's explicit Modal sandbox timeout when config omits one", () => {
    expect(resolveModalSandboxTimeoutMs({ defaultTimeoutMs: undefined })).toBe(
      ModalDefaultSandboxTimeoutMs,
    );
  });
});

describe("isModalNativeImageId", () => {
  it("recognizes Modal image IDs captured from Modal snapshots", () => {
    expect(isModalNativeImageId("im-01KTR17PYRRQ46XM4HGJANJDZ0")).toBe(true);
  });

  it("does not classify registry image references as Modal-native image IDs", () => {
    expect(isModalNativeImageId("ghcr.io/mistlehq/sandbox-base:dev-test")).toBe(false);
  });
});
