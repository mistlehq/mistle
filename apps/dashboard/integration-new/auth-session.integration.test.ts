/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createHmac } from "node:crypto";

import { MemberRoles, members, organizations, sessions, users } from "@mistle/db/control-plane";
import { TestEnvironmentIdHeader, createIntegrationTest } from "@mistle/test-harness/integration";
import { expect } from "vitest";

import { resetDashboardConfigForTest } from "../src/config.js";
import { resolveSessionFromAuthPayload } from "../src/features/shell/session-query-result.js";
import { authClient, resetAuthClientForTest } from "../src/lib/auth/client.js";
import { resetControlPlaneApiClientForTest } from "../src/lib/control-plane-api/client.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

const BetterAuthSessionCookieName = "better-auth.session_token";
const ControlPlaneAuthSecret = "integration-new-auth-secret";

it("resolves the dashboard session from the real control-plane API", async ({ env }) => {
  const sessionToken = `dashboard-integration-${env.id}`;
  const userId = `usr_${env.id}`;
  const organizationId = `org_${env.id}`;
  const sessionId = `ses_${env.id}`;
  const memberId = `mbr_${env.id}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000);

  await env.controlPlaneDb.insert(users).values({
    id: userId,
    name: "Dashboard Integration User",
    email: `${userId}@mistle.test`,
    emailVerified: true,
  });
  await env.controlPlaneDb.insert(organizations).values({
    id: organizationId,
    name: "Dashboard Integration",
    slug: organizationId,
  });
  await env.controlPlaneDb.insert(members).values({
    id: memberId,
    organizationId,
    userId,
    role: MemberRoles.OWNER,
  });
  await env.controlPlaneDb.insert(sessions).values({
    id: sessionId,
    token: sessionToken,
    userId,
    activeOrganizationId: organizationId,
    expiresAt,
  });

  const cookie = createBetterAuthSessionCookie(sessionToken);
  const backendSessionResponse = await env.controlPlaneApi.http.fetch("/v1/auth/get-session", {
    headers: {
      cookie,
    },
  });

  expect(backendSessionResponse.status).toBe(200);
  await expect(backendSessionResponse.json()).resolves.toMatchObject({
    session: {
      id: sessionId,
      userId,
      activeOrganizationId: organizationId,
    },
    user: {
      id: userId,
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
        cookie,
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
      id: sessionId,
      userId,
      activeOrganizationId: organizationId,
    },
    user: {
      id: userId,
    },
  });
});

function createBetterAuthSessionCookie(sessionToken: string): string {
  const signature = createHmac("sha256", ControlPlaneAuthSecret)
    .update(sessionToken)
    .digest("base64");
  const signedValue = encodeURIComponent(`${sessionToken}.${signature}`);
  return `${BetterAuthSessionCookieName}=${signedValue}`;
}
