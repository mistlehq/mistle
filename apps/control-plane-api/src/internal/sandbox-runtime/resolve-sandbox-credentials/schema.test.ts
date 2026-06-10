import { SandboxProvider } from "@mistle/sandbox";
import { describe, expect, it } from "vitest";

import { InternalSandboxRuntimeResolveCredentialsResponseSchema } from "./schema.js";

describe("InternalSandboxRuntimeResolveCredentialsResponseSchema", () => {
  it("rejects Modal sandbox timeouts above the provider maximum", () => {
    expect(() =>
      InternalSandboxRuntimeResolveCredentialsResponseSchema.parse({
        provider: SandboxProvider.MODAL,
        source: "managed",
        tokenId: "ak-test-token-id",
        tokenSecret: "as-test-token-secret",
        appName: "mistle-modal-sandboxes",
        defaultTimeoutMs: 86_400_001,
      }),
    ).toThrow(/<=86400000/u);
  });
});
