/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("OpenAPI reference", () => {
  it("serves a Scalar reference page for the control-plane OpenAPI document", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch("/openapi");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const html = await response.text();
    expect(html).toContain("Mistle Control Plane API Reference");
    expect(html).toContain("/openapi.json");
  });
});
