/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { MembersPageResponseSchema } from "../src/organizations/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
  extraInfra: ["seaweedfs"],
});

describe.concurrent("organization members list integration", () => {
  it("returns paginated members and matches search against email and role labels", async ({
    env,
  }) => {
    const ownerSession = await env.auth.createSession({
      email: "integration-new-org-members-owner@example.com",
    });
    const memberOneSession = await env.auth.createSession({
      email: "members-case-alpha@example.com",
    });
    const memberTwoSession = await env.auth.createSession({
      email: "members-case-beta@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.members).values([
      {
        organizationId: ownerSession.organizationId,
        userId: memberOneSession.userId,
        role: "member",
        createdAt: new Date("2026-03-02T00:00:00.000Z"),
      },
      {
        organizationId: ownerSession.organizationId,
        userId: memberTwoSession.userId,
        role: "admin",
        createdAt: new Date("2026-03-03T00:00:00.000Z"),
      },
    ]);
    await renameUser({
      env,
      name: "Members Case Alpha",
      userId: memberOneSession.userId,
    });
    await renameUser({
      env,
      name: "Completely Different Name",
      userId: memberTwoSession.userId,
    });
    await putMemberAvatar({
      env,
      objectKey: `avatars/users/${memberOneSession.userId}/members_case_alpha.webp`,
      userId: memberOneSession.userId,
    });

    const firstPage = await listMembers({
      cookie: ownerSession.cookie,
      env,
      query: "limit=1&offset=0&search=members-case",
    });

    expect(firstPage).toEqual({
      members: [
        {
          id: expect.any(String),
          userId: memberTwoSession.userId,
          name: "Completely Different Name",
          email: "members-case-beta@example.com",
          role: "admin",
          joinedAt: "2026-03-03T00:00:00.000Z",
          avatar: {
            hasImage: false,
            imageUrl: null,
          },
        },
      ],
      limit: 1,
      offset: 0,
      total: 2,
    });

    await expectMemberSearch({
      cookie: ownerSession.cookie,
      env,
      expectedEmail: "members-case-beta@example.com",
      search: "members-case-beta@example.com",
    });
    await expectMemberSearch({
      cookie: ownerSession.cookie,
      env,
      expectedEmail: "members-case-beta@example.com",
      search: "admin",
    });

    const avatarPage = await listMembers({
      cookie: ownerSession.cookie,
      env,
      query: "limit=1&offset=0&search=members-case-alpha@example.com",
    });
    const avatarUrl = avatarPage.members[0]?.avatar.imageUrl;
    if (avatarUrl === undefined || avatarUrl === null) {
      throw new Error("Expected member with stored avatar to include an avatar URL.");
    }

    const avatarResponse = await fetch(avatarUrl);
    expect(avatarResponse.status).toBe(200);
    expect(avatarResponse.headers.get("content-type")).toBe("image/webp");
  });

  it("paginates members by the normalized display name returned to clients", async ({ env }) => {
    const ownerSession = await env.auth.createSession({
      email: "integration-new-org-members-sort-owner@example.com",
    });
    const blankNameSession = await env.auth.createSession({
      email: "alpha@example.com",
    });
    const aliceSession = await env.auth.createSession({
      email: "alice@example.com",
    });
    const namedSession = await env.auth.createSession({
      email: "zeta@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.members).values([
      {
        organizationId: ownerSession.organizationId,
        userId: blankNameSession.userId,
        role: "member",
        createdAt: new Date("2026-03-05T00:00:00.000Z"),
      },
      {
        organizationId: ownerSession.organizationId,
        userId: aliceSession.userId,
        role: "member",
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
      },
      {
        organizationId: ownerSession.organizationId,
        userId: namedSession.userId,
        role: "member",
        createdAt: new Date("2026-03-05T00:00:00.000Z"),
      },
    ]);
    await renameUser({
      env,
      name: "   ",
      userId: blankNameSession.userId,
    });
    await renameUser({
      env,
      name: "Alice Person",
      userId: aliceSession.userId,
    });
    await renameUser({
      env,
      name: "Beta Person",
      userId: namedSession.userId,
    });

    const firstPage = await listMembers({
      cookie: ownerSession.cookie,
      env,
      query: "limit=1&offset=0&search=",
    });
    expect(firstPage.members).toEqual([
      {
        id: expect.any(String),
        userId: aliceSession.userId,
        name: "Alice Person",
        email: "alice@example.com",
        role: "member",
        joinedAt: "2026-03-01T00:00:00.000Z",
        avatar: {
          hasImage: false,
          imageUrl: null,
        },
      },
    ]);
    expect(firstPage.total).toBe(4);

    const secondPage = await listMembers({
      cookie: ownerSession.cookie,
      env,
      query: "limit=1&offset=1&search=",
    });
    expect(secondPage.members).toEqual([
      {
        id: expect.any(String),
        userId: namedSession.userId,
        name: "Beta Person",
        email: "zeta@example.com",
        role: "member",
        joinedAt: "2026-03-05T00:00:00.000Z",
        avatar: {
          hasImage: false,
          imageUrl: null,
        },
      },
    ]);

    const thirdPage = await listMembers({
      cookie: ownerSession.cookie,
      env,
      query: "limit=1&offset=2&search=",
    });
    expect(thirdPage.members).toEqual([
      {
        id: expect.any(String),
        userId: blankNameSession.userId,
        name: "alpha@example.com",
        email: "alpha@example.com",
        role: "member",
        joinedAt: "2026-03-05T00:00:00.000Z",
        avatar: {
          hasImage: false,
          imageUrl: null,
        },
      },
    ]);
  });
});

type MembersPage = ReturnType<typeof MembersPageResponseSchema.parse>;

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

async function putMemberAvatar(input: {
  env: IntegrationTestEnvironment;
  userId: string;
  objectKey: string;
}): Promise<void> {
  await input.env.objectStore.putObject({
    Body: Buffer.from("integration-new-member-avatar"),
    ContentType: "image/webp",
    objectKey: input.objectKey,
  });
  await input.env.controlPlaneDb
    .update(input.env.controlPlaneTables.users)
    .set({
      imageObjectKey: input.objectKey,
    })
    .where(eq(input.env.controlPlaneTables.users.id, input.userId));
}

async function listMembers(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  query: string;
}): Promise<MembersPage> {
  const response = await input.env.controlPlaneApi.http.fetch(
    `/v1/organization/members?${input.query}`,
    {
      headers: {
        cookie: input.cookie,
      },
    },
  );

  expect(response.status).toBe(200);

  return MembersPageResponseSchema.parse(await response.json());
}

async function expectMemberSearch(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  search: string;
  expectedEmail: string;
}): Promise<void> {
  const body = await listMembers({
    cookie: input.cookie,
    env: input.env,
    query: `limit=25&offset=0&search=${encodeURIComponent(input.search)}`,
  });

  expect(body.members.map((member) => member.email)).toEqual([input.expectedEmail]);
  expect(body.total).toBe(1);
}
