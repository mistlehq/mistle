import { describe, expect } from "vitest";

import {
  buildOrganizationActor,
  buildOrganizationInvitationSeed,
  createPersistedOrganizationDirectoryFixture,
} from "./helpers/organization-fixture.js";
import { it } from "./test-context.js";

describe("organization invitations integration", () => {
  it("returns paginated invitations with inviter names", async ({ fixture }) => {
    const directoryFixture = await createPersistedOrganizationDirectoryFixture({
      fixture,
      owner: buildOrganizationActor({
        email: "integration-org-invitations-owner@example.com",
        name: "Org Owner",
      }),
      invitations: [
        buildOrganizationInvitationSeed({
          email: "invite-alpha@example.com",
          role: "member",
          inviter: buildOrganizationActor({
            email: "integration-org-invitations-owner@example.com",
            name: "Org Owner",
          }),
          status: "pending",
          expiresAt: new Date("2026-03-10T00:00:00.000Z"),
          createdAt: new Date("2026-03-04T00:00:00.000Z"),
        }),
        buildOrganizationInvitationSeed({
          email: "invite-beta@example.com",
          role: "admin",
          inviter: buildOrganizationActor({
            email: "integration-org-invitations-owner@example.com",
            name: "Org Owner",
          }),
          status: "revoked",
          expiresAt: new Date("2026-03-11T00:00:00.000Z"),
          createdAt: new Date("2026-03-05T00:00:00.000Z"),
        }),
      ],
    });
    const ownerSession = directoryFixture.owner;

    const response = await fixture.request(
      `/v1/organizations/${encodeURIComponent(ownerSession.organizationId)}/invitations?limit=25&offset=0&search=invite-`,
      {
        headers: {
          cookie: ownerSession.cookie,
        },
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
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

  it("matches invitation search against visible role and status semantics", async ({ fixture }) => {
    const directoryFixture = await createPersistedOrganizationDirectoryFixture({
      fixture,
      owner: buildOrganizationActor({
        email: "integration-org-invitations-search@example.com",
        name: "Org Owner",
      }),
      invitations: [
        buildOrganizationInvitationSeed({
          email: "future-member@example.com",
          role: "member",
          inviter: buildOrganizationActor({
            email: "integration-org-invitations-search@example.com",
            name: "Org Owner",
          }),
          status: "pending",
          expiresAt: new Date("3026-03-10T00:00:00.000Z"),
          createdAt: new Date("2026-03-04T00:00:00.000Z"),
        }),
        buildOrganizationInvitationSeed({
          email: "expired-admin@example.com",
          role: "admin",
          inviter: buildOrganizationActor({
            email: "integration-org-invitations-search@example.com",
            name: "Org Owner",
          }),
          status: "pending",
          expiresAt: new Date("2020-03-10T00:00:00.000Z"),
          createdAt: new Date("2026-03-03T00:00:00.000Z"),
        }),
      ],
    });
    const ownerSession = directoryFixture.owner;

    const pendingResponse = await fixture.request(
      `/v1/organizations/${encodeURIComponent(ownerSession.organizationId)}/invitations?limit=25&offset=0&search=pending`,
      {
        headers: {
          cookie: ownerSession.cookie,
        },
      },
    );
    expect(pendingResponse.status).toBe(200);
    await expect(pendingResponse.json()).resolves.toMatchObject({
      invitations: [
        expect.objectContaining({
          email: "future-member@example.com",
          role: "member",
          status: "pending",
        }),
      ],
      total: 1,
    });

    const expiredResponse = await fixture.request(
      `/v1/organizations/${encodeURIComponent(ownerSession.organizationId)}/invitations?limit=25&offset=0&search=expired`,
      {
        headers: {
          cookie: ownerSession.cookie,
        },
      },
    );
    expect(expiredResponse.status).toBe(200);
    await expect(expiredResponse.json()).resolves.toMatchObject({
      invitations: [
        expect.objectContaining({
          email: "expired-admin@example.com",
          role: "admin",
          status: "pending",
        }),
      ],
      total: 1,
    });

    const roleResponse = await fixture.request(
      `/v1/organizations/${encodeURIComponent(ownerSession.organizationId)}/invitations?limit=25&offset=0&search=admin`,
      {
        headers: {
          cookie: ownerSession.cookie,
        },
      },
    );
    expect(roleResponse.status).toBe(200);
    await expect(roleResponse.json()).resolves.toMatchObject({
      invitations: [
        expect.objectContaining({
          email: "expired-admin@example.com",
          role: "admin",
        }),
      ],
      total: 1,
    });

    const memberRoleResponse = await fixture.request(
      `/v1/organizations/${encodeURIComponent(ownerSession.organizationId)}/invitations?limit=25&offset=0&search=member`,
      {
        headers: {
          cookie: ownerSession.cookie,
        },
      },
    );
    expect(memberRoleResponse.status).toBe(200);
    await expect(memberRoleResponse.json()).resolves.toMatchObject({
      invitations: [
        expect.objectContaining({
          email: "future-member@example.com",
          role: "member",
        }),
      ],
      total: 1,
    });
  });

  it("fails when invitations contain an unexpected status", async ({ fixture }) => {
    const directoryFixture = await createPersistedOrganizationDirectoryFixture({
      fixture,
      owner: buildOrganizationActor({
        email: "integration-org-invitations-invalid-status@example.com",
        name: "Org Owner",
      }),
      invitations: [
        buildOrganizationInvitationSeed({
          email: "broken-invite@example.com",
          role: "member",
          inviter: buildOrganizationActor({
            email: "integration-org-invitations-invalid-status@example.com",
            name: "Org Owner",
          }),
          status: "queued",
          expiresAt: new Date("3026-03-10T00:00:00.000Z"),
          createdAt: new Date("2026-03-04T00:00:00.000Z"),
        }),
      ],
    });
    const ownerSession = directoryFixture.owner;

    const response = await fixture.request(
      `/v1/organizations/${encodeURIComponent(ownerSession.organizationId)}/invitations?limit=25&offset=0&search=`,
      {
        headers: {
          cookie: ownerSession.cookie,
        },
      },
    );

    expect(response.status).toBe(500);
  });

  it("fails when invitations contain an unexpected role", async ({ fixture }) => {
    const directoryFixture = await createPersistedOrganizationDirectoryFixture({
      fixture,
      owner: buildOrganizationActor({
        email: "integration-org-invitations-invalid-role@example.com",
        name: "Org Owner",
      }),
      invitations: [
        buildOrganizationInvitationSeed({
          email: "broken-role-invite@example.com",
          role: null,
          inviter: buildOrganizationActor({
            email: "integration-org-invitations-invalid-role@example.com",
            name: "Org Owner",
          }),
          status: "pending",
          expiresAt: new Date("3026-03-10T00:00:00.000Z"),
          createdAt: new Date("2026-03-04T00:00:00.000Z"),
        }),
      ],
    });
    const ownerSession = directoryFixture.owner;

    const response = await fixture.request(
      `/v1/organizations/${encodeURIComponent(ownerSession.organizationId)}/invitations?limit=25&offset=0&search=`,
      {
        headers: {
          cookie: ownerSession.cookie,
        },
      },
    );

    expect(response.status).toBe(500);
  });
});
