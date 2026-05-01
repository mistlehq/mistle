/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import { randomUUID } from "node:crypto";

import {
  createIntegrationTest,
  type IntegrationAuthenticatedSession,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

const firstEnvironmentIt = createIntegrationTest({
  services: ["control-plane-api"],
});
const secondEnvironmentIt = createIntegrationTest({
  services: ["control-plane-api"],
});

const sharedEmail = `integration-new-auth-isolation-${randomUUID()}@example.com`;
const sharedOrganizationSlug = `integration-new-auth-isolation-${randomUUID()}`;
let firstSession: IntegrationAuthenticatedSession | undefined;

describe.sequential("auth session isolation", () => {
  firstEnvironmentIt("creates auth state in one logical test environment", async ({ env }) => {
    firstSession = await env.auth.createSession({
      email: sharedEmail,
      organizationName: "Auth Isolation",
      organizationSlug: sharedOrganizationSlug,
    });

    const user = await env.controlPlaneDb.query.users.findFirst({
      columns: {
        id: true,
      },
      where: (table, { eq }) => eq(table.email, sharedEmail),
    });
    expect(user?.id).toBe(firstSession.userId);
  });

  secondEnvironmentIt(
    "does not see auth state created by another logical test environment",
    async ({ env }) => {
      const existingUser = await env.controlPlaneDb.query.users.findFirst({
        columns: {
          id: true,
        },
        where: (table, { eq }) => eq(table.email, sharedEmail),
      });
      expect(existingUser).toBeUndefined();

      const secondSession = await env.auth.createSession({
        email: sharedEmail,
        organizationName: "Auth Isolation",
        organizationSlug: sharedOrganizationSlug,
      });

      expect(secondSession.userId).not.toBe(firstSession?.userId);
      expect(secondSession.organizationId).not.toBe(firstSession?.organizationId);
    },
  );
});
