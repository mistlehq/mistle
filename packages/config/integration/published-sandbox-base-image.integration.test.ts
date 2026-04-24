import { describe, expect, it } from "vitest";

import { resolveLatestPublishedSandboxBaseImageRef } from "../src/sandbox-base-images.js";

describe("resolveLatestPublishedSandboxBaseImageRef", () => {
  it("resolves the latest published sandbox base image ref from the public publish workflow", async () => {
    await expect(resolveLatestPublishedSandboxBaseImageRef()).resolves.toMatch(
      /^ghcr\.io\/mistlehq\/sandbox-base@sha256:[a-f0-9]{64}$/,
    );
  }, 30_000);
});
