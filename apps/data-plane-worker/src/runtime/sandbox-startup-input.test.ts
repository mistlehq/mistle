import { describe, expect, it } from "vitest";

import { encodeSandboxStartupInput } from "./sandbox-startup-input.js";

const Decoder = new TextDecoder();

describe("encodeSandboxStartupInput", () => {
  it("encodes bootstrap token and tunnel gateway ws url as newline-delimited json", () => {
    const encoded = encodeSandboxStartupInput({
      bootstrapToken: "bootstrap-token-value",
      tunnelGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
    });

    const encodedText = Decoder.decode(encoded);
    expect(encodedText.endsWith("\n")).toBe(true);

    const trimmedText = encodedText.trimEnd();
    expect(trimmedText).toBe(
      '{"bootstrapToken":"bootstrap-token-value","tunnelGatewayWsUrl":"ws://127.0.0.1:5003/tunnel/sandbox"}',
    );
  });
});
