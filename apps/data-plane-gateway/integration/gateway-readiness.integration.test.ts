/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import type { TestServiceHandle } from "@mistle/test-harness";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { expect } from "vitest";

const TestTimeoutMs = 40_000;

const it = createIntegrationTest({
  services: ["data-plane-gateway"],
  __dangerouslyIsolatedServices: {
    reason: "This suite intentionally mutates the data-plane gateway runtime lifecycle state.",
    services: ["data-plane-gateway"],
  },
});

it(
  "keeps liveness healthy while readiness fails after gateway drain starts",
  async ({ env }) => {
    const servingHealthResponse = await env.dataPlaneGateway.http.fetch("/__healthz");
    const servingReadinessResponse = await env.dataPlaneGateway.http.fetch("/__readyz");

    expect(servingHealthResponse.status).toBe(200);
    expect(await servingHealthResponse.json()).toEqual({ ok: true });
    expect(servingReadinessResponse.status).toBe(200);
    expect(await servingReadinessResponse.json()).toEqual({
      ok: true,
      status: "serving",
    });

    startGatewayDrain(env.service("data-plane-gateway"));

    const drainingHealthResponse = await env.dataPlaneGateway.http.fetch("/__healthz");
    const drainingReadinessResponse = await env.dataPlaneGateway.http.fetch("/__readyz");

    expect(drainingHealthResponse.status).toBe(200);
    expect(await drainingHealthResponse.json()).toEqual({ ok: true });
    expect(drainingReadinessResponse.status).toBe(503);
    expect(await drainingReadinessResponse.json()).toMatchObject({
      ok: false,
      status: "draining",
      reason: "service_restart",
    });
  },
  TestTimeoutMs,
);

function startGatewayDrain(service: TestServiceHandle): void {
  if (service.startDrain === undefined) {
    throw new Error("Expected data-plane gateway integration service to expose startDrain.");
  }

  service.startDrain();
}
