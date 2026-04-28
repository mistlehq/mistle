import { members, users } from "@mistle/db/control-plane";
import { startSeaweedfsS3 } from "@mistle/test-harness";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { listMembers } from "../src/organizations/services/list-members.js";
import { createRuntimeWithObjectStore } from "./helpers/control-plane-runtime-with-object-store.js";
import { createTestObjectStore, getStoredWebpFixtureBytes } from "./helpers/test-object-store.js";
import { it } from "./test-context.js";

describe("organization members integration", () => {
  it("returns paginated members with avatar metadata and searchable role labels", async ({
    fixture,
  }) => {
    const searchedEmail = "members-case-beta@example.com";
    const ownerSession = await fixture.authSession({
      email: "integration-org-members-owner@example.com",
    });
    const memberOneSession = await fixture.authSession({
      email: "members-case-alpha@example.com",
    });
    const memberTwoSession = await fixture.authSession({
      email: searchedEmail,
    });
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "mistle-assets",
    });
    const runtime = await createRuntimeWithObjectStore({
      config: fixture.config,
      seaweedfs,
    });
    const objectStore = createTestObjectStore(seaweedfs);
    const memberOneObjectKey = `avatars/users/${memberOneSession.userId}/members_case_alpha.webp`;

    try {
      await runtime.db.insert(members).values([
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
      await runtime.db
        .update(users)
        .set({
          name: "Members Case Alpha",
          imageObjectKey: memberOneObjectKey,
        })
        .where(eq(users.id, memberOneSession.userId));
      await runtime.db
        .update(users)
        .set({
          name: "Completely Different Name",
        })
        .where(eq(users.id, memberTwoSession.userId));
      await objectStore.putObject({
        Body: await getStoredWebpFixtureBytes(),
        ContentType: "image/webp",
        objectKey: memberOneObjectKey,
      });

      const firstPageResponse = await runtime.request(
        "/v1/organization/members?limit=1&offset=0&search=members-case",
        {
          headers: {
            cookie: ownerSession.cookie,
          },
        },
      );

      expect(firstPageResponse.status).toBe(200);
      await expect(firstPageResponse.json()).resolves.toEqual({
        members: [
          {
            id: expect.any(String),
            userId: memberTwoSession.userId,
            name: "Completely Different Name",
            email: searchedEmail,
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

      const emailSearchResponse = await runtime.request(
        `/v1/organization/members?limit=25&offset=0&search=${encodeURIComponent(searchedEmail)}`,
        {
          headers: {
            cookie: ownerSession.cookie,
          },
        },
      );

      expect(emailSearchResponse.status).toBe(200);
      const emailSearchPayload: unknown = await emailSearchResponse.json();
      expect(emailSearchPayload).toEqual({
        members: [
          {
            id: expect.any(String),
            userId: memberTwoSession.userId,
            name: "Completely Different Name",
            email: searchedEmail,
            role: "admin",
            joinedAt: "2026-03-03T00:00:00.000Z",
            avatar: {
              hasImage: false,
              imageUrl: null,
            },
          },
        ],
        limit: 25,
        offset: 0,
        total: 1,
      });

      const roleSearchResponse = await runtime.request(
        "/v1/organization/members?limit=25&offset=0&search=admin",
        {
          headers: {
            cookie: ownerSession.cookie,
          },
        },
      );

      expect(roleSearchResponse.status).toBe(200);
      await expect(roleSearchResponse.json()).resolves.toEqual({
        members: [
          {
            id: expect.any(String),
            userId: memberTwoSession.userId,
            name: "Completely Different Name",
            email: searchedEmail,
            role: "admin",
            joinedAt: "2026-03-03T00:00:00.000Z",
            avatar: {
              hasImage: false,
              imageUrl: null,
            },
          },
        ],
        limit: 25,
        offset: 0,
        total: 1,
      });

      const avatarResponse = await runtime.request(
        "/v1/organization/members?limit=1&offset=0&search=members-case-alpha@example.com",
        {
          headers: {
            cookie: ownerSession.cookie,
          },
        },
      );
      const avatarPayload: unknown = await avatarResponse.json();
      const imageUrl = extractMemberAvatarUrl(avatarPayload);
      const imageResponse = await fetch(imageUrl);
      expect(imageResponse.status).toBe(200);
      expect(imageResponse.headers.get("content-type")).toBe("image/webp");
    } finally {
      objectStore.destroy();
      await runtime.stop();
      await seaweedfs.stop();
    }
  });

  it("returns members when avatar presigning fails", async ({ fixture }) => {
    const ownerSession = await fixture.authSession({
      email: "integration-org-members-avatar-failure-owner@example.com",
    });
    const memberSession = await fixture.authSession({
      email: "members-avatar-failure@example.com",
    });
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "mistle-assets-avatar-failure",
    });
    const objectStore = createTestObjectStore(seaweedfs);
    const memberObjectKey = `avatars/users/${memberSession.userId}/members_avatar_failure.webp`;

    try {
      await fixture.db.insert(members).values({
        organizationId: ownerSession.organizationId,
        userId: memberSession.userId,
        role: "member",
        createdAt: new Date("2026-03-04T00:00:00.000Z"),
      });
      await fixture.db
        .update(users)
        .set({
          name: "Avatar Failure Member",
          imageObjectKey: memberObjectKey,
        })
        .where(eq(users.id, memberSession.userId));
      await objectStore.putObject({
        Body: await getStoredWebpFixtureBytes(),
        ContentType: "image/webp",
        objectKey: memberObjectKey,
      });

      await expect(
        listMembers(
          {
            db: fixture.db,
            objectStore,
            presignedUrlTtlSeconds: 0,
          },
          {
            organizationId: ownerSession.organizationId,
            limit: 25,
            offset: 0,
            search: "members-avatar-failure@example.com",
          },
        ),
      ).resolves.toEqual({
        members: [
          {
            id: expect.any(String),
            userId: memberSession.userId,
            name: "Avatar Failure Member",
            email: "members-avatar-failure@example.com",
            role: "member",
            joinedAt: "2026-03-04T00:00:00.000Z",
            avatar: {
              hasImage: true,
              imageUrl: null,
            },
          },
        ],
        limit: 25,
        offset: 0,
        total: 1,
      });
    } finally {
      objectStore.destroy();
      await seaweedfs.stop();
    }
  });

  it("paginates members by the normalized display name returned to clients", async ({
    fixture,
  }) => {
    const ownerSession = await fixture.authSession({
      email: "integration-org-members-sort-owner@example.com",
    });
    const blankNameSession = await fixture.authSession({
      email: "alpha@example.com",
    });
    const aliceSession = await fixture.authSession({
      email: "alice@example.com",
    });
    const namedSession = await fixture.authSession({
      email: "zeta@example.com",
    });

    await fixture.db.insert(members).values([
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
    await fixture.db
      .update(users)
      .set({
        name: "   ",
      })
      .where(eq(users.id, blankNameSession.userId));
    await fixture.db
      .update(users)
      .set({
        name: "Alice Person",
      })
      .where(eq(users.id, aliceSession.userId));
    await fixture.db
      .update(users)
      .set({
        name: "Beta Person",
      })
      .where(eq(users.id, namedSession.userId));

    const firstPageResponse = await fixture.request(
      "/v1/organization/members?limit=1&offset=0&search=",
      {
        headers: {
          cookie: ownerSession.cookie,
        },
      },
    );
    expect(firstPageResponse.status).toBe(200);
    await expect(firstPageResponse.json()).resolves.toEqual({
      members: [
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
      ],
      limit: 1,
      offset: 0,
      total: 4,
    });

    const secondPageResponse = await fixture.request(
      "/v1/organization/members?limit=1&offset=1&search=",
      {
        headers: {
          cookie: ownerSession.cookie,
        },
      },
    );
    expect(secondPageResponse.status).toBe(200);
    await expect(secondPageResponse.json()).resolves.toEqual({
      members: [
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
      ],
      limit: 1,
      offset: 1,
      total: 4,
    });

    const thirdPageResponse = await fixture.request(
      "/v1/organization/members?limit=1&offset=2&search=",
      {
        headers: {
          cookie: ownerSession.cookie,
        },
      },
    );
    expect(thirdPageResponse.status).toBe(200);
    await expect(thirdPageResponse.json()).resolves.toEqual({
      members: [
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
      ],
      limit: 1,
      offset: 2,
      total: 4,
    });
  });
});

function extractMemberAvatarUrl(payload: unknown): string {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("members" in payload) ||
    !Array.isArray(payload.members)
  ) {
    throw new Error("Expected members payload.");
  }

  const [firstMember] = payload.members;
  if (
    typeof firstMember !== "object" ||
    firstMember === null ||
    !("avatar" in firstMember) ||
    typeof firstMember.avatar !== "object" ||
    firstMember.avatar === null ||
    !("imageUrl" in firstMember.avatar) ||
    typeof firstMember.avatar.imageUrl !== "string"
  ) {
    throw new Error("Expected member avatar image url.");
  }

  return firstMember.avatar.imageUrl;
}
