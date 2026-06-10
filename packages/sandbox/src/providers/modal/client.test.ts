import { describe, expect, it } from "vitest";

import { ModalDefaultSandboxTimeoutMs, resolveModalSandboxTimeoutMs } from "./client.js";

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
