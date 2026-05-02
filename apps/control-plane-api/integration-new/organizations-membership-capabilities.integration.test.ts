/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { ForbiddenResponseSchema, NotFoundResponseSchema } from "@mistle/http/errors.js";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { and, eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { MembershipCapabilitiesSchema } from "../src/organizations/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("organization membership capabilities integration", () => {
  it("returns capabilities for an authenticated organization member", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-membership-capabilities-owner@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/organization/membership-capabilities",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = MembershipCapabilitiesSchema.parse(await response.json());

    expect(body).toEqual({
      organizationId: session.organizationId,
      actorRole: "owner",
      invite: {
        canExecute: true,
        assignableRoles: ["owner", "admin", "member"],
      },
      memberRoleUpdate: {
        canExecute: true,
        roleTransitionMatrix: {
          owner: ["owner", "admin", "member"],
          admin: ["owner", "admin", "member"],
          member: ["owner", "admin", "member"],
        },
      },
    });
  });

  it("returns 403 when the active organization membership has been revoked", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-membership-capabilities-forbidden@example.com",
    });

    await env.controlPlaneDb
      .delete(env.controlPlaneTables.members)
      .where(
        and(
          eq(env.controlPlaneTables.members.organizationId, session.organizationId),
          eq(env.controlPlaneTables.members.userId, session.userId),
        ),
      );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/organization/membership-capabilities",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(403);
    const body = ForbiddenResponseSchema.parse(await response.json());

    expect(body).toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });

  it("returns 404 when the active organization no longer exists", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-membership-capabilities-not-found@example.com",
    });

    await env.controlPlaneDb
      .delete(env.controlPlaneTables.organizations)
      .where(eq(env.controlPlaneTables.organizations.id, session.organizationId));

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/organization/membership-capabilities",
      {
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(404);
    const body = NotFoundResponseSchema.parse(await response.json());

    expect(body).toEqual({
      code: "NOT_FOUND",
      message: "Organization was not found.",
    });
  });

  it("returns 401 when the actor is unauthenticated", async ({ env }) => {
    const response = await env.controlPlaneApi.http.fetch(
      "/v1/organization/membership-capabilities",
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized API request.",
    });
  });
});
