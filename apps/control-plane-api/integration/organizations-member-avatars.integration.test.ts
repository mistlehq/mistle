import { members, users } from "@mistle/db/control-plane";
import { startSeaweedfsS3 } from "@mistle/test-harness";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { createRuntimeWithObjectStore } from "./helpers/control-plane-runtime-with-object-store.js";
import { createTestObjectStore, getStoredWebpFixtureBytes } from "./helpers/test-object-store.js";
import { it } from "./test-context.js";

describe("organization member avatars integration", () => {
  it("returns batched member avatars with presigned image urls and omits non-members", async ({
    fixture,
  }) => {
    const ownerSession = await fixture.authSession({
      email: "integration-org-member-avatars-owner@example.com",
    });
    const memberSession = await fixture.authSession({
      email: "integration-org-member-avatars-member@example.com",
    });
    const otherOrgSession = await fixture.authSession({
      email: "integration-org-member-avatars-other@example.com",
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
    const memberObjectKey = `avatars/users/${memberSession.userId}/img_existing.webp`;

    try {
      await runtime.db.insert(members).values({
        organizationId: ownerSession.organizationId,
        userId: memberSession.userId,
        role: "member",
      });
      await runtime.db
        .update(users)
        .set({
          imageObjectKey: memberObjectKey,
        })
        .where(eq(users.id, memberSession.userId));
      await objectStore.putObject({
        Body: await getStoredWebpFixtureBytes(),
        ContentType: "image/webp",
        objectKey: memberObjectKey,
      });

      const response = await runtime.request(
        `/v1/organizations/${encodeURIComponent(ownerSession.organizationId)}/member-avatars`,
        {
          method: "POST",
          headers: {
            cookie: ownerSession.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            userIds: [
              ownerSession.userId,
              memberSession.userId,
              memberSession.userId,
              otherOrgSession.userId,
              "usr_missing",
            ],
          }),
        },
      );

      expect(response.status).toBe(200);
      const payload: unknown = await response.json();
      expect(payload).toEqual([
        {
          userId: ownerSession.userId,
          hasImage: false,
          imageUrl: null,
        },
        {
          userId: memberSession.userId,
          hasImage: true,
          imageUrl: expect.any(String),
        },
      ]);

      if (!Array.isArray(payload)) {
        throw new Error("Expected member avatars payload to be an array.");
      }

      const memberAvatar = payload[1];
      if (
        typeof memberAvatar !== "object" ||
        memberAvatar === null ||
        !("imageUrl" in memberAvatar) ||
        typeof memberAvatar.imageUrl !== "string"
      ) {
        throw new Error("Expected member avatar payload to include an imageUrl.");
      }

      const imageResponse = await fetch(memberAvatar.imageUrl);
      expect(imageResponse.status).toBe(200);
      expect(imageResponse.headers.get("content-type")).toBe("image/webp");
    } finally {
      objectStore.destroy();
      await runtime.stop();
      await seaweedfs.stop();
    }
  });

  it("returns validation error when the request exceeds the batch cap", async ({ fixture }) => {
    const ownerSession = await fixture.authSession({
      email: "integration-org-member-avatars-cap@example.com",
    });
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "mistle-assets",
    });
    const runtime = await createRuntimeWithObjectStore({
      config: fixture.config,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      seaweedfs,
    });

    try {
      const response = await runtime.request(
        `/v1/organizations/${encodeURIComponent(ownerSession.organizationId)}/member-avatars`,
        {
          method: "POST",
          headers: {
            cookie: ownerSession.cookie,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            userIds: Array.from({ length: 101 }, (_, index) => `usr_${String(index)}`),
          }),
        },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        code: "VALIDATION_ERROR",
        message: "Invalid request.",
      });
    } finally {
      await runtime.stop();
      await seaweedfs.stop();
    }
  });
});
