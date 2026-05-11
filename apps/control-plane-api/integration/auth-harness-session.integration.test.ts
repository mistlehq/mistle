/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("integration auth session helper", () => {
  it("keeps repeated sessions for one user scoped to their bootstrapped organizations", async ({
    env,
  }) => {
    const email = `integration-auth-same-user-${randomUUID()}@example.com`;
    const firstSession = await env.auth.createSession({
      email,
      organizationName: "First Harness Organization",
      organizationSlug: `first-harness-${randomUUID()}`,
    });
    const secondSession = await env.auth.createSession({
      email,
      organizationName: "Second Harness Organization",
      organizationSlug: `second-harness-${randomUUID()}`,
    });

    await expectActiveOrganizationId(env, firstSession.cookie, firstSession.organizationId);
    await expectActiveOrganizationId(env, secondSession.cookie, secondSession.organizationId);
  });
});

async function expectActiveOrganizationId(
  env: IntegrationTestEnvironment,
  cookie: string,
  expectedOrganizationId: string,
): Promise<void> {
  const response = await env.controlPlaneApi.http.fetch("/v1/auth/get-session", {
    headers: {
      cookie,
    },
  });
  expect(response.status).toBe(200);

  const payload: unknown = await response.json();
  expect(readActiveOrganizationId(payload)).toBe(expectedOrganizationId);
}

function readActiveOrganizationId(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    throw new Error("Expected session response payload to be an object.");
  }

  const session = Reflect.get(payload, "session");
  if (typeof session !== "object" || session === null) {
    throw new Error("Expected session response payload to include a session object.");
  }

  const activeOrganizationId = Reflect.get(session, "activeOrganizationId");
  if (activeOrganizationId === null || typeof activeOrganizationId === "string") {
    return activeOrganizationId;
  }

  throw new Error("Expected session response active organization id to be a string or null.");
}
