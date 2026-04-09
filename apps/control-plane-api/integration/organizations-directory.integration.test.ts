import { invitations, members, users } from "@mistle/db/control-plane";
import { startSeaweedfsS3 } from "@mistle/test-harness";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { createRuntimeWithObjectStore } from "./helpers/control-plane-runtime-with-object-store.js";
import { createTestObjectStore, getStoredWebpFixtureBytes } from "./helpers/test-object-store.js";
import { it } from "./test-context.js";

describe("organization directory integration", () => {
  it("returns paginated mixed directory entries with member avatars", async ({ fixture }) => {
    const ownerSession = await fixture.authSession({
      email: "integration-org-directory-owner@example.com",
    });
    const memberOneSession = await fixture.authSession({
      email: "directory-case-alpha@example.com",
    });
    const memberTwoSession = await fixture.authSession({
      email: "directory-case-beta@example.com",
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
    const memberOneObjectKey = `avatars/users/${memberOneSession.userId}/directory_case_alpha.webp`;

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
          name: "Directory Case Alpha",
          imageObjectKey: memberOneObjectKey,
        })
        .where(eq(users.id, memberOneSession.userId));
      await runtime.db
        .update(users)
        .set({
          name: "Directory Case Beta",
        })
        .where(eq(users.id, memberTwoSession.userId));
      await objectStore.putObject({
        Body: await getStoredWebpFixtureBytes(),
        ContentType: "image/webp",
        objectKey: memberOneObjectKey,
      });
      await runtime.db.insert(invitations).values([
        {
          organizationId: ownerSession.organizationId,
          email: "directory-case-invite@example.com",
          role: "member",
          inviterId: ownerSession.userId,
          status: "pending",
          expiresAt: new Date("2026-03-10T00:00:00.000Z"),
          createdAt: new Date("2026-03-04T00:00:00.000Z"),
        },
        {
          organizationId: ownerSession.organizationId,
          email: "directory-case-revoked@example.com",
          role: "admin",
          inviterId: ownerSession.userId,
          status: "revoked",
          expiresAt: new Date("2026-03-11T00:00:00.000Z"),
          createdAt: new Date("2026-03-05T00:00:00.000Z"),
        },
      ]);

      const firstPageResponse = await runtime.request(
        `/v1/organizations/${encodeURIComponent(ownerSession.organizationId)}/directory?limit=2&offset=0&filter=all&search=directory-case`,
        {
          headers: {
            cookie: ownerSession.cookie,
          },
        },
      );

      expect(firstPageResponse.status).toBe(200);
      const firstPagePayload: unknown = await firstPageResponse.json();
      expect(firstPagePayload).toEqual({
        entries: [
          {
            kind: "invitation",
            id: expect.any(String),
            organizationId: ownerSession.organizationId,
            email: "directory-case-invite@example.com",
            role: "member",
            inviterId: ownerSession.userId,
            status: "pending",
            rawStatus: null,
            expiresAt: "2026-03-10T00:00:00.000Z",
            createdAt: "2026-03-04T00:00:00.000Z",
          },
          {
            kind: "member",
            id: expect.any(String),
            userId: memberTwoSession.userId,
            name: "Directory Case Beta",
            email: "directory-case-beta@example.com",
            role: "admin",
            joinedAt: "2026-03-03T00:00:00.000Z",
            avatar: {
              hasImage: false,
              imageUrl: null,
            },
          },
        ],
        limit: 2,
        offset: 0,
        total: 3,
      });

      const secondPageResponse = await runtime.request(
        `/v1/organizations/${encodeURIComponent(ownerSession.organizationId)}/directory?limit=2&offset=2&filter=all&search=directory-case`,
        {
          headers: {
            cookie: ownerSession.cookie,
          },
        },
      );

      expect(secondPageResponse.status).toBe(200);
      const secondPagePayload: unknown = await secondPageResponse.json();
      expect(secondPagePayload).toEqual({
        entries: [
          {
            kind: "member",
            id: expect.any(String),
            userId: memberOneSession.userId,
            name: "Directory Case Alpha",
            email: "directory-case-alpha@example.com",
            role: "member",
            joinedAt: "2026-03-02T00:00:00.000Z",
            avatar: {
              hasImage: true,
              imageUrl: expect.any(String),
            },
          },
        ],
        limit: 2,
        offset: 2,
        total: 3,
      });

      if (
        typeof secondPagePayload !== "object" ||
        secondPagePayload === null ||
        !("entries" in secondPagePayload) ||
        !Array.isArray(secondPagePayload.entries)
      ) {
        throw new Error("Expected a directory payload with an entries array.");
      }

      const [memberEntry] = secondPagePayload.entries;
      if (
        typeof memberEntry !== "object" ||
        memberEntry === null ||
        !("kind" in memberEntry) ||
        memberEntry.kind !== "member" ||
        !("avatar" in memberEntry) ||
        typeof memberEntry.avatar !== "object" ||
        memberEntry.avatar === null ||
        !("imageUrl" in memberEntry.avatar) ||
        typeof memberEntry.avatar.imageUrl !== "string"
      ) {
        throw new Error("Expected second page member entry to include an avatar image url.");
      }

      const imageResponse = await fetch(memberEntry.avatar.imageUrl);
      expect(imageResponse.status).toBe(200);
      expect(imageResponse.headers.get("content-type")).toBe("image/webp");
    } finally {
      objectStore.destroy();
      await runtime.stop();
      await seaweedfs.stop();
    }
  });
});
