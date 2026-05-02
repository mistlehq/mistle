/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest, TestEnvironmentIdHeader } from "@mistle/test-harness/integration";
import { expect } from "vitest";

import { resetDashboardConfigForTest } from "../src/config.js";
import { resolveSessionFromAuthPayload } from "../src/features/shell/session-query-result.js";
import { authClient, resetAuthClientForTest } from "../src/lib/auth/client.js";
import { resetControlPlaneApiClientForTest } from "../src/lib/control-plane-api/client.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

it("resolves the dashboard session from the real control-plane API", async ({ env }) => {
  const session = await env.auth.createSession({
    organizationName: "Dashboard Integration",
  });

  const backendSessionResponse = await env.controlPlaneApi.http.fetch("/v1/auth/get-session", {
    headers: {
      cookie: session.cookie,
    },
  });
  expect(backendSessionResponse.status).toBe(200);

  const backendSessionPayload = await backendSessionResponse.json();
  expect(backendSessionPayload).toMatchObject({
    session: {
      activeOrganizationId: session.organizationId,
    },
    user: {
      email: session.email,
    },
  });

  Object.assign(import.meta.env, {
    VITE_CONTROL_PLANE_API_ORIGIN: env.controlPlaneApi.hostBaseUrl,
  });
  resetDashboardConfigForTest();
  resetAuthClientForTest();
  resetControlPlaneApiClientForTest();

  const dashboardAuthResponse = await authClient.getSession({
    fetchOptions: {
      headers: {
        cookie: session.cookie,
        [TestEnvironmentIdHeader]: env.id,
      },
    },
  });
  const dashboardSession = resolveSessionFromAuthPayload({
    data: dashboardAuthResponse.data,
    error: dashboardAuthResponse.error,
  });

  expect(dashboardSession).toMatchObject({
    session: {
      activeOrganizationId: session.organizationId,
    },
    user: {
      email: session.email,
    },
  });
});
