import { describe, expect } from "vitest";

import { it } from "./test-context.js";

function getTrustedOrigin(trustedOrigins: readonly string[]): string {
  const trustedOrigin = trustedOrigins[0];

  if (trustedOrigin === undefined) {
    throw new Error("Expected at least one trusted origin in test fixture config.");
  }

  return trustedOrigin;
}

describe("cors integration", () => {
  it("adds CORS headers for trusted origins on standard requests", async ({ fixture }) => {
    const trustedOrigin = getTrustedOrigin(fixture.config.auth.trustedOrigins);

    const response = await fixture.request("/__healthz", {
      method: "GET",
      headers: {
        origin: trustedOrigin,
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(trustedOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("does not allow untrusted origins on standard requests", async ({ fixture }) => {
    const response = await fixture.request("/__healthz", {
      method: "GET",
      headers: {
        origin: "http://malicious.example",
      },
    });
    expect(response.status).toBe(200);

    const allowOrigin = response.headers.get("access-control-allow-origin");
    expect(allowOrigin === null || allowOrigin === "").toBe(true);
  });

  it("handles preflight requests for trusted origins", async ({ fixture }) => {
    const trustedOrigin = getTrustedOrigin(fixture.config.auth.trustedOrigins);

    const response = await fixture.request("/__healthz", {
      method: "OPTIONS",
      headers: {
        origin: trustedOrigin,
        "access-control-request-method": "GET",
        "access-control-request-headers": "content-type,authorization",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(trustedOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
    expect(response.headers.get("access-control-allow-methods")).toContain("OPTIONS");
    expect(response.headers.get("access-control-max-age")).toBe("600");

    const allowHeaders = response.headers.get("access-control-allow-headers");
    expect(allowHeaders).toContain("Content-Type");
    expect(allowHeaders).toContain("Authorization");
  });
});
