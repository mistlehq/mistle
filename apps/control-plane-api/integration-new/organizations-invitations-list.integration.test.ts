/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { InvitationsPageResponseSchema } from "../src/organizations/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("organization invitations list integration", () => {
  it("returns paginated invitations with inviter names", async ({ env }) => {
    const ownerSession = await env.auth.createSession({
      email: "integration-new-org-invitations-owner@example.com",
    });

    await renameUser({
      env,
      userId: ownerSession.userId,
      name: "Org Owner",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.invitations).values([
      {
        organizationId: ownerSession.organizationId,
        email: "invite-alpha@example.com",
        role: "member",
        inviterId: ownerSession.userId,
        status: "pending",
        expiresAt: new Date("2026-03-10T00:00:00.000Z"),
        createdAt: new Date("2026-03-04T00:00:00.000Z"),
      },
      {
        organizationId: ownerSession.organizationId,
        email: "invite-beta@example.com",
        role: "admin",
        inviterId: ownerSession.userId,
        status: "revoked",
        expiresAt: new Date("2026-03-11T00:00:00.000Z"),
        createdAt: new Date("2026-03-05T00:00:00.000Z"),
      },
    ]);

    const body = await listInvitations({
      cookie: ownerSession.cookie,
      env,
      query: "limit=25&offset=0&search=invite-",
    });

    expect(body).toEqual({
      invitations: [
        {
          id: expect.any(String),
          organizationId: ownerSession.organizationId,
          email: "invite-beta@example.com",
          role: "admin",
          inviterId: ownerSession.userId,
          inviterName: "Org Owner",
          status: "revoked",
          expiresAt: "2026-03-11T00:00:00.000Z",
          createdAt: "2026-03-05T00:00:00.000Z",
        },
        {
          id: expect.any(String),
          organizationId: ownerSession.organizationId,
          email: "invite-alpha@example.com",
          role: "member",
          inviterId: ownerSession.userId,
          inviterName: "Org Owner",
          status: "pending",
          expiresAt: "2026-03-10T00:00:00.000Z",
          createdAt: "2026-03-04T00:00:00.000Z",
        },
      ],
      limit: 25,
      offset: 0,
      total: 2,
    });
  });

  it("matches invitation search against visible role and status semantics", async ({ env }) => {
    const ownerSession = await env.auth.createSession({
      email: "integration-new-org-invitations-search@example.com",
    });

    await renameUser({
      env,
      userId: ownerSession.userId,
      name: "Org Owner",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.invitations).values([
      {
        organizationId: ownerSession.organizationId,
        email: "future-member@example.com",
        role: "member",
        inviterId: ownerSession.userId,
        status: "pending",
        expiresAt: new Date("3026-03-10T00:00:00.000Z"),
        createdAt: new Date("2026-03-04T00:00:00.000Z"),
      },
      {
        organizationId: ownerSession.organizationId,
        email: "expired-admin@example.com",
        role: "admin",
        inviterId: ownerSession.userId,
        status: "pending",
        expiresAt: new Date("2020-03-10T00:00:00.000Z"),
        createdAt: new Date("2026-03-03T00:00:00.000Z"),
      },
    ]);

    await expectInvitationSearch({
      cookie: ownerSession.cookie,
      env,
      expectedEmail: "future-member@example.com",
      search: "pending",
    });
    await expectInvitationSearch({
      cookie: ownerSession.cookie,
      env,
      expectedEmail: "expired-admin@example.com",
      search: "expired",
    });
    await expectInvitationSearch({
      cookie: ownerSession.cookie,
      env,
      expectedEmail: "expired-admin@example.com",
      search: "admin",
    });
    await expectInvitationSearch({
      cookie: ownerSession.cookie,
      env,
      expectedEmail: "future-member@example.com",
      search: "member",
    });
  });

  it("excludes accepted invitations from the listing and total", async ({ env }) => {
    const ownerSession = await env.auth.createSession({
      email: "integration-new-org-invitations-hide-accepted@example.com",
    });

    await renameUser({
      env,
      userId: ownerSession.userId,
      name: "Org Owner",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.invitations).values([
      {
        organizationId: ownerSession.organizationId,
        email: "still-pending@example.com",
        role: "member",
        inviterId: ownerSession.userId,
        status: "pending",
        expiresAt: new Date("3026-03-10T00:00:00.000Z"),
        createdAt: new Date("2026-03-04T00:00:00.000Z"),
      },
      {
        organizationId: ownerSession.organizationId,
        email: "already-accepted@example.com",
        role: "admin",
        inviterId: ownerSession.userId,
        status: "accepted",
        expiresAt: new Date("3026-03-11T00:00:00.000Z"),
        createdAt: new Date("2026-03-05T00:00:00.000Z"),
      },
    ]);

    const body = await listInvitations({
      cookie: ownerSession.cookie,
      env,
      query: "limit=25&offset=0&search=",
    });

    expect(body.invitations).toEqual([
      {
        id: expect.any(String),
        organizationId: ownerSession.organizationId,
        email: "still-pending@example.com",
        role: "member",
        inviterId: ownerSession.userId,
        inviterName: "Org Owner",
        status: "pending",
        expiresAt: "3026-03-10T00:00:00.000Z",
        createdAt: "2026-03-04T00:00:00.000Z",
      },
    ]);
    expect(body.total).toBe(1);
  });

  it("allows admins and members to list invitations", async ({ env }) => {
    const ownerSession = await env.auth.createSession({
      email: "integration-new-org-invitations-authorization-owner@example.com",
    });
    const adminSession = await env.auth.createSession({
      email: "integration-new-org-invitations-authorization-admin@example.com",
    });
    const memberSession = await env.auth.createSession({
      email: "integration-new-org-invitations-authorization-member@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.members).values([
      {
        organizationId: ownerSession.organizationId,
        userId: adminSession.userId,
        role: "admin",
      },
      {
        organizationId: ownerSession.organizationId,
        userId: memberSession.userId,
        role: "member",
      },
    ]);
    await setActiveOrganization({
      env,
      organizationId: ownerSession.organizationId,
      userId: adminSession.userId,
    });
    await setActiveOrganization({
      env,
      organizationId: ownerSession.organizationId,
      userId: memberSession.userId,
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.invitations).values({
      organizationId: ownerSession.organizationId,
      email: "authorization-check@example.com",
      role: "member",
      inviterId: ownerSession.userId,
      status: "pending",
      expiresAt: new Date("3026-03-10T00:00:00.000Z"),
      createdAt: new Date("2026-03-04T00:00:00.000Z"),
    });

    const adminBody = await listInvitations({
      cookie: adminSession.cookie,
      env,
      query: "limit=25&offset=0&search=",
    });
    expect(adminBody.invitations.map((invitation) => invitation.email)).toEqual([
      "authorization-check@example.com",
    ]);
    expect(adminBody.total).toBe(1);

    const memberBody = await listInvitations({
      cookie: memberSession.cookie,
      env,
      query: "limit=25&offset=0&search=",
    });
    expect(memberBody.invitations.map((invitation) => invitation.email)).toEqual([
      "authorization-check@example.com",
    ]);
    expect(memberBody.total).toBe(1);
  });
});

type InvitationsPage = ReturnType<typeof InvitationsPageResponseSchema.parse>;

async function renameUser(input: {
  env: IntegrationTestEnvironment;
  userId: string;
  name: string;
}): Promise<void> {
  await input.env.controlPlaneDb
    .update(input.env.controlPlaneTables.users)
    .set({
      name: input.name,
    })
    .where(eq(input.env.controlPlaneTables.users.id, input.userId));
}

async function setActiveOrganization(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  userId: string;
}): Promise<void> {
  await input.env.controlPlaneDb
    .update(input.env.controlPlaneTables.sessions)
    .set({
      activeOrganizationId: input.organizationId,
    })
    .where(eq(input.env.controlPlaneTables.sessions.userId, input.userId));
}

async function listInvitations(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  query: string;
}): Promise<InvitationsPage> {
  const response = await input.env.controlPlaneApi.http.fetch(
    `/v1/organization/invitations?${input.query}`,
    {
      headers: {
        cookie: input.cookie,
      },
    },
  );

  expect(response.status).toBe(200);

  return InvitationsPageResponseSchema.parse(await response.json());
}

async function expectInvitationSearch(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  search: string;
  expectedEmail: string;
}): Promise<void> {
  const body = await listInvitations({
    cookie: input.cookie,
    env: input.env,
    query: `limit=25&offset=0&search=${encodeURIComponent(input.search)}`,
  });

  expect(body.invitations.map((invitation) => invitation.email)).toEqual([input.expectedEmail]);
  expect(body.total).toBe(1);
}
