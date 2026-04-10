import { ForbiddenResponseSchema, NotFoundResponseSchema } from "@mistle/http/errors.js";
import { describe, expect } from "vitest";

import { MembershipCapabilitiesSchema } from "../src/organizations/index.js";
import { it } from "./test-context.js";

describe("organization membership capabilities integration", () => {
  it("returns capabilities for an authenticated organization member", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-membership-capabilities-owner@example.com",
    });

    const response = await fixture.request(
      `/v1/organizations/${encodeURIComponent(authenticatedSession.organizationId)}/membership-capabilities`,
      {
        headers: {
          cookie: authenticatedSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    const body = MembershipCapabilitiesSchema.parse(await response.json());

    expect(body).toEqual({
      organizationId: authenticatedSession.organizationId,
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

  it("returns 403 for an authenticated actor without organization membership", async ({
    fixture,
  }) => {
    const firstSession = await fixture.authSession({
      email: "integration-membership-capabilities-forbidden-a@example.com",
    });
    const secondSession = await fixture.authSession({
      email: "integration-membership-capabilities-forbidden-b@example.com",
    });

    const response = await fixture.request(
      `/v1/organizations/${encodeURIComponent(secondSession.organizationId)}/membership-capabilities`,
      {
        headers: {
          cookie: firstSession.cookie,
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

  it("returns 404 for an organization that does not exist", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-membership-capabilities-not-found@example.com",
    });

    const response = await fixture.request(
      "/v1/organizations/org_missing/membership-capabilities",
      {
        headers: {
          cookie: authenticatedSession.cookie,
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

  it("returns 401 when the actor is unauthenticated", async ({ fixture }) => {
    const response = await fixture.request("/v1/organizations/org_missing/membership-capabilities");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: "UNAUTHORIZED",
      message: "Unauthorized API request.",
    });
  });
});
