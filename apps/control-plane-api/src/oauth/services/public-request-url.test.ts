import { describe, expect, it } from "vitest";

import { buildPublicRequestUrl } from "./public-request-url.js";

describe("buildPublicRequestUrl", () => {
  it("keeps the public API origin when the runtime receives a proxied HTTP request", () => {
    const publicRequestUrl = buildPublicRequestUrl({
      publicBaseUrl: "https://api.mistle.dev",
      requestUrl:
        "http://api.mistle.dev/oauth/authorize?response_type=code&client_id=mistle-cli&state=state_123",
    });

    expect(publicRequestUrl).toBe(
      "https://api.mistle.dev/oauth/authorize?response_type=code&client_id=mistle-cli&state=state_123",
    );
  });

  it("preserves configured public API base path prefixes", () => {
    const publicRequestUrl = buildPublicRequestUrl({
      publicBaseUrl: "https://control-plane.mistle.test/base?x=1#frag",
      requestUrl:
        "http://control-plane.mistle.test/oauth/authorize?response_type=code&client_id=mistle-cli&state=state_123",
    });

    expect(publicRequestUrl).toBe(
      "https://control-plane.mistle.test/base/oauth/authorize?response_type=code&client_id=mistle-cli&state=state_123",
    );
  });
});
