import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { validateModalSandboxConfig } from "./config.js";

describe("validateModalSandboxConfig", () => {
  it("returns config when all required fields are non-empty", () => {
    const config = validateModalSandboxConfig({
      tokenId: "modal-token-id",
      tokenSecret: "modal-token-secret",
      appName: "mistle-sandbox-app",
    });

    expect(config).toEqual({
      tokenId: "modal-token-id",
      tokenSecret: "modal-token-secret",
      appName: "mistle-sandbox-app",
    });
  });

  it("throws when token id is empty", () => {
    expect(() =>
      validateModalSandboxConfig({
        tokenId: "   ",
        tokenSecret: "modal-token-secret",
        appName: "mistle-sandbox-app",
      }),
    ).toThrow(ZodError);
  });

  it("throws when token secret is empty", () => {
    expect(() =>
      validateModalSandboxConfig({
        tokenId: "modal-token-id",
        tokenSecret: "",
        appName: "mistle-sandbox-app",
      }),
    ).toThrow(ZodError);
  });

  it("throws when app name is empty", () => {
    expect(() =>
      validateModalSandboxConfig({
        tokenId: "modal-token-id",
        tokenSecret: "modal-token-secret",
        appName: " ",
      }),
    ).toThrow(ZodError);
  });
});
