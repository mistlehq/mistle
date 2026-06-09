import { describe, expect, it } from "vitest";

import { validateModalSandboxConfig } from "./config.js";

describe("validateModalSandboxConfig", () => {
  it("accepts Modal credentials with app and runtime options", () => {
    expect(
      validateModalSandboxConfig({
        tokenId: "ak-test-token-id",
        tokenSecret: "as-test-token-secret",
        appName: "mistle-modal-sandboxes",
        environment: "main",
        defaultTimeoutMs: 86_400_000,
      }),
    ).toEqual({
      tokenId: "ak-test-token-id",
      tokenSecret: "as-test-token-secret",
      appName: "mistle-modal-sandboxes",
      environment: "main",
      defaultTimeoutMs: 86_400_000,
    });
  });

  it("rejects missing credentials", () => {
    expect(() =>
      validateModalSandboxConfig({
        tokenId: "",
        tokenSecret: "as-test-token-secret",
        appName: "mistle-modal-sandboxes",
      }),
    ).toThrow("Modal config field `tokenId` is required.");

    expect(() =>
      validateModalSandboxConfig({
        tokenId: "ak-test-token-id",
        tokenSecret: "",
        appName: "mistle-modal-sandboxes",
      }),
    ).toThrow("Modal config field `tokenSecret` is required.");
  });

  it("rejects an empty app name", () => {
    expect(() =>
      validateModalSandboxConfig({
        tokenId: "ak-test-token-id",
        tokenSecret: "as-test-token-secret",
        appName: "",
      }),
    ).toThrow("Modal config field `appName` is required.");
  });
});
