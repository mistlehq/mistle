import { describe, expect, it } from "vitest";

import { readRequestedSandboxTunnelToken } from "./requested-sandbox-tunnel-token.js";

describe("readRequestedSandboxTunnelToken", () => {
  it("returns missing when neither tunnel token is present", () => {
    const requestedToken = readRequestedSandboxTunnelToken(
      new URL("https://example.test/tunnel/sandbox/sbi_example"),
    );

    expect(requestedToken).toEqual({ kind: "missing" });
  });

  it("returns ambiguous when both tunnel token query params are present", () => {
    const requestedToken = readRequestedSandboxTunnelToken(
      new URL(
        "https://example.test/tunnel/sandbox/sbi_example?bootstrap_token=bootstrap&connect_token=connection",
      ),
    );

    expect(requestedToken).toEqual({ kind: "ambiguous" });
  });

  it("normalizes surrounding whitespace in bootstrap tokens", () => {
    const requestedToken = readRequestedSandboxTunnelToken(
      new URL("https://example.test/tunnel/sandbox/sbi_example?bootstrap_token=%20abc%20"),
    );

    expect(requestedToken).toEqual({
      kind: "bootstrap",
      token: "abc",
    });
  });

  it("treats blank token query params as missing", () => {
    const requestedToken = readRequestedSandboxTunnelToken(
      new URL("https://example.test/tunnel/sandbox/sbi_example?connect_token=%20%20"),
    );

    expect(requestedToken).toEqual({ kind: "missing" });
  });
});
