import { describe, expect, it } from "vitest";

import { ControlPlaneApiSandboxRuntimeConfigSchema } from "./schema.js";

describe("ControlPlaneApiSandboxRuntimeConfigSchema", () => {
  it("rejects Modal sandbox timeouts above the provider maximum", () => {
    expect(() =>
      ControlPlaneApiSandboxRuntimeConfigSchema.parse({
        defaultBaseImage: "registry.example.com/sandbox:latest",
        gatewayWsUrl: "wss://gateway.example.test/tunnel/sandbox",
        modal: {
          enabled: true,
          tokenId: "ak-test-token-id",
          tokenSecret: "as-test-token-secret",
          appName: "mistle-modal-sandboxes",
          defaultTimeoutMs: 86_400_001,
        },
      }),
    ).toThrow(/<=86400000/u);
  });
});
