import { users } from "@mistle/db/control-plane";
import { startSeaweedfsS3 } from "@mistle/test-harness";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { describe, expect } from "vitest";

import { createRuntimeWithObjectStore } from "./helpers/control-plane-runtime-with-object-store.js";
import { readImageMetadata } from "./helpers/image-metadata.js";
import { createTestObjectStore, getStoredWebpFixtureBytes } from "./helpers/test-object-store.js";
import { it } from "./test-context.js";

describe("user avatar endpoints integration", () => {
  it("returns null from the authenticated read endpoint when no profile image is stored", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-user-avatar-endpoint-read-empty@example.com",
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
      const response = await runtime.request("/v1/me/profile-image", {
        method: "GET",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        hasImage: false,
        imageVersion: null,
      });
    } finally {
      await runtime.stop();
      await seaweedfs.stop();
    }
  });

  it("uploads a profile image through the authenticated endpoint and returns image metadata", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-user-avatar-endpoint-upload@example.com",
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
      const sourceImage = await sharp({
        create: {
          width: 960,
          height: 640,
          channels: 3,
          background: {
            r: 24,
            g: 96,
            b: 220,
          },
        },
      })
        .jpeg()
        .toBuffer();
      const formData = new FormData();

      formData.set(
        "file",
        new File([new Uint8Array(sourceImage)], "avatar.jpg", { type: "image/jpeg" }),
      );

      const response = await runtime.request("/v1/me/profile-image", {
        method: "PUT",
        headers: {
          cookie: authenticatedSession.cookie,
        },
        body: formData,
      });

      expect(response.status).toBe(200);

      const payload = readImageMetadata(await response.json());
      expect(payload.hasImage).toBe(true);
      expect(payload.imageVersion).not.toBeNull();

      const persistedUser = await runtime.db.query.users.findFirst({
        columns: {
          imageObjectKey: true,
        },
        where: (table, { eq }) => eq(table.id, authenticatedSession.userId),
      });

      expect(persistedUser?.imageObjectKey).toMatch(
        new RegExp(`^avatars/users/${authenticatedSession.userId}/img_[^/]+\\.webp$`, "u"),
      );

      if (payload.imageVersion === null) {
        throw new Error("Expected profile image response to include imageVersion.");
      }

      expect(payload.imageVersion).toBe(persistedUser?.imageObjectKey ?? null);

      const contentResponse = await runtime.request(
        `/v1/me/profile-image/content?v=${encodeURIComponent(payload.imageVersion)}`,
        {
          method: "GET",
          headers: {
            cookie: authenticatedSession.cookie,
          },
          redirect: "manual",
        },
      );

      expect(contentResponse.status).toBe(302);
      const imageUrl = contentResponse.headers.get("location");
      expect(imageUrl).not.toBeNull();
      if (imageUrl === null) {
        throw new Error("Expected profile image content response to include location.");
      }

      const imageResponse = await fetch(imageUrl);

      expect(imageResponse.status).toBe(200);
      expect(imageResponse.headers.get("content-type")).toBe("image/webp");

      const imageMetadata = await sharp(await imageResponse.bytes()).metadata();

      expect(imageMetadata.format).toBe("webp");
      expect(imageMetadata.width).toBe(512);
      expect(imageMetadata.height).toBe(512);
    } finally {
      await runtime.stop();
      await seaweedfs.stop();
    }
  });

  it("returns not found from the authenticated content endpoint when no profile image is stored", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-user-avatar-endpoint-content-missing@example.com",
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
      const response = await runtime.request("/v1/me/profile-image/content", {
        method: "GET",
        headers: {
          cookie: authenticatedSession.cookie,
        },
        redirect: "manual",
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        code: "NOT_FOUND",
        message: "Profile image was not found.",
      });
    } finally {
      await runtime.stop();
      await seaweedfs.stop();
    }
  });

  it("returns not found from the authenticated content endpoint when the requested profile image version is missing", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-user-avatar-endpoint-content-version-missing@example.com",
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
    const objectKey = `avatars/users/${authenticatedSession.userId}/img_existing.webp`;

    try {
      await objectStore.putObject({
        Body: await getStoredWebpFixtureBytes(),
        ContentType: "image/webp",
        objectKey,
      });
      await runtime.db
        .update(users)
        .set({
          imageObjectKey: objectKey,
        })
        .where(eq(users.id, authenticatedSession.userId));

      const response = await runtime.request("/v1/me/profile-image/content", {
        method: "GET",
        headers: {
          cookie: authenticatedSession.cookie,
        },
        redirect: "manual",
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        code: "NOT_FOUND",
        message: "Profile image was not found.",
      });
    } finally {
      objectStore.destroy();
      await runtime.stop();
      await seaweedfs.stop();
    }
  });

  it("returns not found from the authenticated content endpoint when the requested profile image version is stale", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-user-avatar-endpoint-content-version-stale@example.com",
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
    const objectKey = `avatars/users/${authenticatedSession.userId}/img_existing.webp`;

    try {
      await objectStore.putObject({
        Body: await getStoredWebpFixtureBytes(),
        ContentType: "image/webp",
        objectKey,
      });
      await runtime.db
        .update(users)
        .set({
          imageObjectKey: objectKey,
        })
        .where(eq(users.id, authenticatedSession.userId));

      const response = await runtime.request(
        `/v1/me/profile-image/content?v=${encodeURIComponent(`avatars/users/${authenticatedSession.userId}/img_stale.webp`)}`,
        {
          method: "GET",
          headers: {
            cookie: authenticatedSession.cookie,
          },
          redirect: "manual",
        },
      );

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        code: "NOT_FOUND",
        message: "Profile image was not found.",
      });
    } finally {
      objectStore.destroy();
      await runtime.stop();
      await seaweedfs.stop();
    }
  });

  it("returns a validation error when the multipart body is missing the file field", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-user-avatar-endpoint-validation@example.com",
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
      const response = await runtime.request("/v1/me/profile-image", {
        method: "PUT",
        headers: {
          cookie: authenticatedSession.cookie,
        },
        body: new FormData(),
      });

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

  it("deletes the uploaded profile image through the authenticated endpoint", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-user-avatar-endpoint-delete@example.com",
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
    const previousObjectKey = `avatars/users/${authenticatedSession.userId}/img_previous.webp`;

    try {
      await objectStore.putObject({
        Body: await getStoredWebpFixtureBytes(),
        ContentType: "image/webp",
        objectKey: previousObjectKey,
      });
      await runtime.db
        .update(users)
        .set({
          imageObjectKey: previousObjectKey,
        })
        .where(eq(users.id, authenticatedSession.userId));

      const response = await runtime.request("/v1/me/profile-image", {
        method: "DELETE",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      });

      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");

      const persistedUser = await runtime.db.query.users.findFirst({
        columns: {
          imageObjectKey: true,
        },
        where: (table, { eq }) => eq(table.id, authenticatedSession.userId),
      });

      expect(persistedUser).toEqual({
        imageObjectKey: null,
      });

      await expect(objectStore.headObject(previousObjectKey)).rejects.toMatchObject({
        name: "NotFound",
      });
    } finally {
      objectStore.destroy();
      await runtime.stop();
      await seaweedfs.stop();
    }
  });

  it("returns image metadata from the authenticated read endpoint when a profile image exists", async ({
    fixture,
  }) => {
    const authenticatedSession = await fixture.authSession({
      email: "integration-user-avatar-endpoint-read-existing@example.com",
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
    const objectKey = `avatars/users/${authenticatedSession.userId}/img_existing.webp`;

    try {
      await objectStore.putObject({
        Body: await getStoredWebpFixtureBytes(),
        ContentType: "image/webp",
        objectKey,
      });
      await runtime.db
        .update(users)
        .set({
          imageObjectKey: objectKey,
        })
        .where(eq(users.id, authenticatedSession.userId));

      const response = await runtime.request("/v1/me/profile-image", {
        method: "GET",
        headers: {
          cookie: authenticatedSession.cookie,
        },
      });

      expect(response.status).toBe(200);

      const payload = readImageMetadata(await response.json());

      expect(payload).toEqual({
        hasImage: true,
        imageVersion: objectKey,
      });

      const contentResponse = await runtime.request(
        `/v1/me/profile-image/content?v=${encodeURIComponent(objectKey)}`,
        {
          method: "GET",
          headers: {
            cookie: authenticatedSession.cookie,
          },
          redirect: "manual",
        },
      );

      expect(contentResponse.status).toBe(302);
      const imageUrl = contentResponse.headers.get("location");
      expect(imageUrl).not.toBeNull();
      if (imageUrl === null) {
        throw new Error("Expected profile image content response to include location.");
      }

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
