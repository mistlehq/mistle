import { users } from "@mistle/db/control-plane";
import { startSeaweedfsS3 } from "@mistle/test-harness";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { describe, expect } from "vitest";

import { putUserAvatar } from "../src/auth/services/put-user-avatar.js";
import { createTestObjectStore, getStoredWebpFixtureBytes } from "./helpers/test-object-store.js";
import { it } from "./test-context.js";

describe("user avatar service integration", () => {
  it("uploads a normalized avatar, persists imageObjectKey, and leaves image unchanged", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-user-avatar-upload@example.com",
    });
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "mistle-assets",
    });
    const objectStore = createTestObjectStore(seaweedfs);

    await fixture.db
      .update(users)
      .set({
        image: "https://example.com/existing-avatar.png",
      })
      .where(eq(users.id, authenticatedSession.userId));

    try {
      const sourceImage = await sharp({
        create: {
          width: 1024,
          height: 640,
          channels: 3,
          background: {
            r: 16,
            g: 72,
            b: 220,
          },
        },
      })
        .jpeg()
        .toBuffer();

      const result = await putUserAvatar(
        {
          db: fixture.db,
          objectStore,
        },
        {
          userId: authenticatedSession.userId,
          imageBytes: new Uint8Array(sourceImage),
        },
      );

      expect(result.userId).toBe(authenticatedSession.userId);
      expect(result.imageObjectKey).toMatch(
        new RegExp(`^avatars/users/${authenticatedSession.userId}/img_[^/]+\\.webp$`, "u"),
      );

      const persistedUser = await fixture.db.query.users.findFirst({
        columns: {
          image: true,
          imageObjectKey: true,
        },
        where: (table, { eq }) => eq(table.id, authenticatedSession.userId),
      });

      expect(persistedUser).toEqual({
        image: "https://example.com/existing-avatar.png",
        imageObjectKey: result.imageObjectKey,
      });

      const uploadedObject = await objectStore.readObject(result.imageObjectKey);

      expect(uploadedObject.ContentType).toBe("image/webp");
      if (
        uploadedObject.Body === undefined ||
        typeof uploadedObject.Body.transformToByteArray !== "function"
      ) {
        throw new Error("Expected uploaded avatar body to support transformToByteArray().");
      }

      const uploadedBytes = await uploadedObject.Body.transformToByteArray();
      const uploadedMetadata = await sharp(uploadedBytes).metadata();

      expect(uploadedMetadata.format).toBe("webp");
      expect(uploadedMetadata.width).toBe(512);
      expect(uploadedMetadata.height).toBe(512);
    } finally {
      objectStore.destroy();
      await seaweedfs.stop();
    }
  });

  it("replaces the previous avatar object and deletes the old object", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-user-avatar-replace@example.com",
    });
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "mistle-assets",
    });
    const objectStore = createTestObjectStore(seaweedfs);
    const previousObjectKey = `avatars/users/${authenticatedSession.userId}/img_previous.webp`;

    try {
      await objectStore.putObject({
        Body: await getStoredWebpFixtureBytes(),
        ContentType: "image/webp",
        objectKey: previousObjectKey,
      });

      await fixture.db
        .update(users)
        .set({
          imageObjectKey: previousObjectKey,
        })
        .where(eq(users.id, authenticatedSession.userId));

      const replacementSource = await sharp({
        create: {
          width: 300,
          height: 600,
          channels: 4,
          background: {
            r: 120,
            g: 40,
            b: 180,
            alpha: 1,
          },
        },
      })
        .png()
        .toBuffer();

      const result = await putUserAvatar(
        {
          db: fixture.db,
          objectStore,
        },
        {
          userId: authenticatedSession.userId,
          imageBytes: new Uint8Array(replacementSource),
        },
      );

      expect(result.imageObjectKey).not.toBe(previousObjectKey);

      await expect(objectStore.headObject(previousObjectKey)).rejects.toMatchObject({
        name: "NotFound",
      });

      await expect(objectStore.headObject(result.imageObjectKey)).resolves.toMatchObject({
        ContentType: "image/webp",
      });
    } finally {
      objectStore.destroy();
      await seaweedfs.stop();
    }
  });
});
