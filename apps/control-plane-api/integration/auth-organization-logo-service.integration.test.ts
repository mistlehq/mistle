import { organizations } from "@mistle/db/control-plane";
import { startSeaweedfsS3 } from "@mistle/test-harness";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { describe, expect } from "vitest";

import { putOrganizationLogo } from "../src/auth/services/put-organization-logo.js";
import { createTestObjectStore, getStoredWebpFixtureBytes } from "./helpers/test-object-store.js";
import { it } from "./test-context.js";

describe("organization logo service integration", () => {
  it("uploads a normalized logo, persists logoObjectKey, and leaves logo unchanged", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-organization-logo-upload@example.com",
    });
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "mistle-assets",
    });
    const objectStore = createTestObjectStore(seaweedfs);

    await fixture.db
      .update(organizations)
      .set({
        logo: "https://example.com/existing-logo.png",
      })
      .where(eq(organizations.id, authenticatedSession.organizationId));

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

      const result = await putOrganizationLogo(
        {
          db: fixture.db,
          objectStore,
        },
        {
          organizationId: authenticatedSession.organizationId,
          imageBytes: new Uint8Array(sourceImage),
        },
      );

      expect(result.organizationId).toBe(authenticatedSession.organizationId);
      expect(result.logoObjectKey).toMatch(
        new RegExp(
          `^logos/organizations/${authenticatedSession.organizationId}/img_[^/]+\\.webp$`,
          "u",
        ),
      );

      const persistedOrganization = await fixture.db.query.organizations.findFirst({
        columns: {
          logo: true,
          logoObjectKey: true,
        },
        where: (table, { eq }) => eq(table.id, authenticatedSession.organizationId),
      });

      expect(persistedOrganization).toEqual({
        logo: "https://example.com/existing-logo.png",
        logoObjectKey: result.logoObjectKey,
      });

      const uploadedObject = await objectStore.readObject(result.logoObjectKey);

      expect(uploadedObject.ContentType).toBe("image/webp");
      if (
        uploadedObject.Body === undefined ||
        typeof uploadedObject.Body.transformToByteArray !== "function"
      ) {
        throw new Error(
          "Expected uploaded organization logo body to support transformToByteArray().",
        );
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

  it("replaces the previous organization logo object and deletes the old object", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-organization-logo-replace@example.com",
    });
    const seaweedfs = await startSeaweedfsS3({
      bucketName: "mistle-assets",
    });
    const objectStore = createTestObjectStore(seaweedfs);
    const previousObjectKey = `logos/organizations/${authenticatedSession.organizationId}/img_previous.webp`;

    try {
      await objectStore.putObject({
        Body: await getStoredWebpFixtureBytes(),
        ContentType: "image/webp",
        objectKey: previousObjectKey,
      });

      await fixture.db
        .update(organizations)
        .set({
          logoObjectKey: previousObjectKey,
        })
        .where(eq(organizations.id, authenticatedSession.organizationId));

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

      const result = await putOrganizationLogo(
        {
          db: fixture.db,
          objectStore,
        },
        {
          organizationId: authenticatedSession.organizationId,
          imageBytes: new Uint8Array(replacementSource),
        },
      );

      expect(result.logoObjectKey).not.toBe(previousObjectKey);

      await expect(objectStore.headObject(previousObjectKey)).rejects.toMatchObject({
        name: "NotFound",
      });

      await expect(objectStore.headObject(result.logoObjectKey)).resolves.toMatchObject({
        ContentType: "image/webp",
      });
    } finally {
      objectStore.destroy();
      await seaweedfs.stop();
    }
  });
});
