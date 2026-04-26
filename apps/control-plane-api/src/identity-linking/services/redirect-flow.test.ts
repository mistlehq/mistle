import { describe, expect, it } from "vitest";

import { buildIdentityLinkCallbackUrl } from "./redirect-flow.js";

describe("buildIdentityLinkCallbackUrl", () => {
  it("builds a provider-family callback URL", () => {
    expect(
      buildIdentityLinkCallbackUrl({
        controlPlaneBaseUrl: "https://control-plane.mistle.test",
        providerFamily: "github",
      }),
    ).toBe("https://control-plane.mistle.test/p/identity-linking/callbacks/github");
  });

  it("preserves configured control-plane base path prefixes", () => {
    expect(
      buildIdentityLinkCallbackUrl({
        controlPlaneBaseUrl: "https://control-plane.mistle.test/base?x=1#frag",
        providerFamily: "slack",
      }),
    ).toBe("https://control-plane.mistle.test/base/p/identity-linking/callbacks/slack");
  });

  it("encodes provider families as a single path segment", () => {
    expect(
      buildIdentityLinkCallbackUrl({
        controlPlaneBaseUrl: "https://control-plane.mistle.test",
        providerFamily: "github/enterprise",
      }),
    ).toBe("https://control-plane.mistle.test/p/identity-linking/callbacks/github%2Fenterprise");
  });
});
