/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import { expect } from "vitest";

const it = createIntegrationTest({
  services: ["control-plane-api"],
  __dangerouslyIsolatedServices: {
    reason: "This suite intentionally stops and restarts the control-plane API runtime.",
    services: ["control-plane-api"],
  },
});

it("closes and restarts the control-plane API runtime on a stable HTTP endpoint", async ({
  env,
}) => {
  const baseUrl = env.controlPlaneApi.hostBaseUrl;

  const initialHealthResponse = await env.controlPlaneApi.http.fetch("/__healthz");
  expect(initialHealthResponse.status).toBe(200);

  await Promise.all([
    env.controlPlaneApi.stop(),
    env.controlPlaneApi.stop(),
    env.controlPlaneApi.stop(),
  ]);
  await expect(fetch(new URL("/__healthz", baseUrl))).rejects.toBeInstanceOf(Error);

  await env.controlPlaneApi.start();
  expect(env.controlPlaneApi.hostBaseUrl).toBe(baseUrl);

  const restartedHealthResponse = await env.controlPlaneApi.http.fetch("/__healthz");
  expect(restartedHealthResponse.status).toBe(200);

  await env.controlPlaneApi.restart();
  expect(env.controlPlaneApi.hostBaseUrl).toBe(baseUrl);

  const secondRestartHealthResponse = await env.controlPlaneApi.http.fetch("/__healthz");
  expect(secondRestartHealthResponse.status).toBe(200);
});
