import { users } from "@mistle/db/control-plane";
import { BadRequestError, ForbiddenError } from "@mistle/http/errors.js";
import { S3CompatibleObjectStore } from "@mistle/object-store";
import { startSeaweedfsS3 } from "@mistle/test-harness";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { describe, expect } from "vitest";

import { uploadOrganizationLogo } from "../src/organizations/services/upload-organization-logo.js";
import { uploadUserAvatar } from "../src/users/services/upload-user-avatar.js";
import { it } from "./test-context.js";

type ObjectStoreTestContext = {
  objectStore: S3CompatibleObjectStore;
};

describe("avatar storage services integration", () => {
  it("uploads a normalized user avatar and persists a durable object key", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "avatar-upload-user@example.com",
    });

    await withObjectStoreTestContext(async ({ objectStore }) => {
      const result = await uploadUserAvatar(
        {
          db: fixture.db,
          objectStore,
        },
        {
          actorUserId: authenticatedSession.userId,
          body: await createTestImage({
            width: 1024,
            height: 768,
            format: "png",
          }),
          contentType: "image/png",
        },
      );

      expect(result.imageObjectKey).toMatch(
        new RegExp(`^avatars/users/${authenticatedSession.userId}/img_[^/]+-avatar\\.webp$`, "u"),
      );

      const storedUser = await fixture.db.query.users.findFirst({
        columns: {
          image: true,
          imageObjectKey: true,
        },
        where: (table, { eq }) => eq(table.id, authenticatedSession.userId),
      });

      expect(storedUser).toEqual({
        image: null,
        imageObjectKey: result.imageObjectKey,
      });

      const storedImage = await readStoredObjectBytes(objectStore, result.imageObjectKey);
      const storedImageMetadata = await sharp(storedImage).metadata();

      expect(storedImageMetadata.format).toBe("webp");
      expect(storedImageMetadata.width).toBe(512);
      expect(storedImageMetadata.height).toBe(512);
    });
  });

  it("deletes the previous avatar object after a replacement succeeds", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "avatar-upload-replace@example.com",
    });

    await withObjectStoreTestContext(async ({ objectStore }) => {
      const previousImageObjectKey = `avatars/users/${authenticatedSession.userId}/img_existing-avatar.webp`;
      await objectStore.putObject({
        objectKey: previousImageObjectKey,
        Body: await createTestImage({
          width: 512,
          height: 512,
          format: "webp",
        }),
        ContentType: "image/webp",
      });
      await fixture.db
        .update(users)
        .set({
          imageObjectKey: previousImageObjectKey,
          updatedAt: sql`now()`,
        })
        .where(eq(users.id, authenticatedSession.userId));

      const result = await uploadUserAvatar(
        {
          db: fixture.db,
          objectStore,
        },
        {
          actorUserId: authenticatedSession.userId,
          body: await createTestImage({
            width: 900,
            height: 900,
            format: "jpeg",
          }),
          contentType: "image/jpeg",
        },
      );

      expect(result.imageObjectKey).not.toBe(previousImageObjectKey);
      await expect(objectStore.headObject(previousImageObjectKey)).rejects.toThrow();
    });
  });

  it("rejects user avatar uploads smaller than the minimum dimensions", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "avatar-upload-too-small@example.com",
    });

    await withObjectStoreTestContext(async ({ objectStore }) => {
      await expect(
        uploadUserAvatar(
          {
            db: fixture.db,
            objectStore,
          },
          {
            actorUserId: authenticatedSession.userId,
            body: await createTestImage({
              width: 96,
              height: 96,
              format: "png",
            }),
            contentType: "image/png",
          },
        ),
      ).rejects.toBeInstanceOf(BadRequestError);

      const storedUser = await fixture.db.query.users.findFirst({
        columns: {
          imageObjectKey: true,
        },
        where: (table, { eq }) => eq(table.id, authenticatedSession.userId),
      });
      expect(storedUser?.imageObjectKey).toBeNull();
    });
  });

  it("uploads a normalized organization logo and persists a durable object key", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "organization-logo-owner@example.com",
    });

    await withObjectStoreTestContext(async ({ objectStore }) => {
      const result = await uploadOrganizationLogo(
        {
          db: fixture.db,
          objectStore,
        },
        {
          actorUserId: authenticatedSession.userId,
          organizationId: authenticatedSession.organizationId,
          body: await createTestImage({
            width: 720,
            height: 640,
            format: "png",
          }),
          contentType: "image/png",
        },
      );

      expect(result.logoObjectKey).toMatch(
        new RegExp(
          `^avatars/organizations/${authenticatedSession.organizationId}/img_[^/]+-logo\\.webp$`,
          "u",
        ),
      );

      const storedOrganization = await fixture.db.query.organizations.findFirst({
        columns: {
          logo: true,
          logoObjectKey: true,
        },
        where: (table, { eq }) => eq(table.id, authenticatedSession.organizationId),
      });

      expect(storedOrganization).toEqual({
        logo: null,
        logoObjectKey: result.logoObjectKey,
      });

      const storedLogo = await readStoredObjectBytes(objectStore, result.logoObjectKey);
      const storedLogoMetadata = await sharp(storedLogo).metadata();

      expect(storedLogoMetadata.format).toBe("webp");
      expect(storedLogoMetadata.width).toBe(512);
      expect(storedLogoMetadata.height).toBe(512);
    });
  });

  it("requires an owner or admin to upload an organization logo", async ({ fixture }) => {
    const authenticatedSession = await fixture.authSession({
      email: "organization-logo-member@example.com",
    });

    await fixture.db.execute(sql`
      update control_plane.members
      set role = 'member'
      where organization_id = ${authenticatedSession.organizationId}
        and user_id = ${authenticatedSession.userId}
    `);

    await withObjectStoreTestContext(async ({ objectStore }) => {
      await expect(
        uploadOrganizationLogo(
          {
            db: fixture.db,
            objectStore,
          },
          {
            actorUserId: authenticatedSession.userId,
            organizationId: authenticatedSession.organizationId,
            body: await createTestImage({
              width: 600,
              height: 600,
              format: "png",
            }),
            contentType: "image/png",
          },
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    });
  });
});

async function withObjectStoreTestContext(
  run: (context: ObjectStoreTestContext) => Promise<void>,
): Promise<void> {
  const seaweedfs = await startSeaweedfsS3({
    bucketName: "control-plane-avatar-services",
  });
  const objectStore = new S3CompatibleObjectStore({
    bucketName: seaweedfs.bucketName,
    endpoint: seaweedfs.endpoint,
    region: seaweedfs.region,
    credentials: {
      accessKeyId: seaweedfs.accessKeyId,
      secretAccessKey: seaweedfs.secretAccessKey,
    },
  });

  try {
    await run({
      objectStore,
    });
  } finally {
    objectStore.destroy();
    await seaweedfs.stop();
  }
}

async function createTestImage(input: {
  width: number;
  height: number;
  format: "jpeg" | "png" | "webp";
}): Promise<Uint8Array> {
  const pipeline = sharp({
    create: {
      width: input.width,
      height: input.height,
      channels: 3,
      background: {
        r: 64,
        g: 128,
        b: 192,
      },
    },
  });

  if (input.format === "jpeg") {
    return Uint8Array.from(await pipeline.jpeg().toBuffer());
  }

  if (input.format === "png") {
    return Uint8Array.from(await pipeline.png().toBuffer());
  }

  return Uint8Array.from(await pipeline.webp().toBuffer());
}

async function readStoredObjectBytes(
  objectStore: S3CompatibleObjectStore,
  objectKey: string,
): Promise<Uint8Array> {
  const object = await objectStore.readObject(objectKey);
  if (object.Body === undefined || typeof object.Body.transformToByteArray !== "function") {
    throw new Error(`Expected object body for "${objectKey}" to support transformToByteArray().`);
  }

  return object.Body.transformToByteArray();
}
