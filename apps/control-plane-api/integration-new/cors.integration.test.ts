/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe("cors integration", () => {
  it("adds CORS headers for trusted origins on standard requests", async ({ env }) => {
    const trustedOrigin = env.controlPlaneApi.hostBaseUrl;
    const response = await env.controlPlaneApi.http.fetch("/__healthz", {
      method: "GET",
      headers: {
        origin: trustedOrigin,
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(trustedOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("does not allow untrusted origins on standard requests", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch("/__healthz", {
      method: "GET",
      headers: {
        origin: "http://malicious.example",
      },
    });
    expect(response.status).toBe(200);

    const allowOrigin = response.headers.get("access-control-allow-origin");
    expect(allowOrigin === null || allowOrigin === "").toBe(true);
  });

  it("handles preflight requests for trusted origins", async ({ env }) => {
    const trustedOrigin = env.controlPlaneApi.hostBaseUrl;
    const response = await env.controlPlaneApi.http.fetch("/__healthz", {
      method: "OPTIONS",
      headers: {
        origin: trustedOrigin,
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type,authorization",
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(trustedOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-methods")).toContain("PUT");
    expect(response.headers.get("access-control-allow-methods")).toContain("OPTIONS");
    expect(response.headers.get("access-control-max-age")).toBe("600");

    const allowHeaders = response.headers.get("access-control-allow-headers");
    expect(allowHeaders).toContain("Content-Type");
    expect(allowHeaders).toContain("Authorization");
  });
});
