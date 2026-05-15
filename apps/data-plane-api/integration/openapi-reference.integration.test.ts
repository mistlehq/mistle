/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

const it = createIntegrationTest({
  services: ["data-plane-api"],
});

describe.concurrent("OpenAPI reference", () => {
  it("serves a Scalar reference page for the data-plane OpenAPI document", async ({ env }) => {
    const response = await env.dataPlaneApi.http.fetch("/openapi");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");

    const html = await response.text();
    expect(html).toContain("Mistle Data Plane Internal API Reference");
    expect(html).toContain("/openapi.json");
  });
});
