import { members, users } from "@mistle/db/control-plane";
import { startSeaweedfsS3 } from "@mistle/test-harness";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { createRuntimeWithObjectStore } from "./helpers/control-plane-runtime-with-object-store.js";
import { createTestObjectStore, getStoredWebpFixtureBytes } from "./helpers/test-object-store.js";
import { it } from "./test-context.js";

describe("organization members integration", () => {
  it("returns paginated members with avatar metadata and email search", async ({ fixture }) => {
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
      internalAuthServiceToken: fixture.internalAuthServiceToken,
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
        `/v1/organizations/${encodeURIComponent(ownerSession.organizationId)}/members?limit=1&offset=0&search=members-case`,
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
            userId: memberOneSession.userId,
            name: "Members Case Alpha",
            email: "members-case-alpha@example.com",
            role: "member",
            joinedAt: "2026-03-02T00:00:00.000Z",
            avatar: {
              hasImage: true,
              imageUrl: expect.any(String),
            },
          },
        ],
        limit: 1,
        offset: 0,
        total: 1,
      });

      const emailSearchResponse = await runtime.request(
        `/v1/organizations/${encodeURIComponent(ownerSession.organizationId)}/members?limit=25&offset=0&search=${encodeURIComponent(searchedEmail)}`,
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

      const avatarResponse = await runtime.request(
        `/v1/organizations/${encodeURIComponent(ownerSession.organizationId)}/members?limit=1&offset=0&search=members-case-alpha@example.com`,
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
