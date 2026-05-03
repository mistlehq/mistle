/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { describe, expect } from "vitest";

import { ProfileImageMetadataResponseSchema } from "../src/me/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
  extraInfra: ["seaweedfs"],
});

describe.concurrent("user avatar endpoints integration", () => {
  it("returns empty profile image metadata when no avatar is stored", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-avatar-read-empty@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/me/profile-image", {
      method: "GET",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      hasImage: false,
      imageVersion: null,
    });
  });

  it("uploads a profile image and serves the normalized avatar content", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-avatar-upload@example.com",
    });
    await env.controlPlaneDb
      .update(env.controlPlaneTables.users)
      .set({
        image: "https://example.com/existing-avatar.png",
      })
      .where(eq(env.controlPlaneTables.users.id, session.userId));

    const uploadPayload = await uploadProfileImage({
      cookie: session.cookie,
      env,
      filename: "avatar.jpg",
      image: await createSourceJpeg(),
    });

    expect(uploadPayload.hasImage).toBe(true);
    expect(uploadPayload.imageVersion).toMatch(
      new RegExp(`^avatars/users/${session.userId}/img_[^/]+\\.webp$`, "u"),
    );

    if (uploadPayload.imageVersion === null) {
      throw new Error("Expected profile image upload response to include imageVersion.");
    }

    const persistedUser = await env.controlPlaneDb.query.users.findFirst({
      columns: {
        image: true,
        imageObjectKey: true,
      },
      where: (table, { eq }) => eq(table.id, session.userId),
    });
    expect(persistedUser).toEqual({
      image: "https://example.com/existing-avatar.png",
      imageObjectKey: uploadPayload.imageVersion,
    });

    const storedObject = await env.objectStore.headObject(uploadPayload.imageVersion);
    expect(storedObject.ContentType).toBe("image/webp");

    const imageResponse = await fetchProfileImageContent({
      cookie: session.cookie,
      env,
      imageVersion: uploadPayload.imageVersion,
    });

    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers.get("content-type")).toBe("image/webp");

    const imageMetadata = await sharp(Buffer.from(await imageResponse.arrayBuffer())).metadata();
    expect(imageMetadata.format).toBe("webp");
    expect(imageMetadata.width).toBe(512);
    expect(imageMetadata.height).toBe(512);
  });

  it("returns not found from the content endpoint when no avatar is stored", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-avatar-content-missing@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/me/profile-image/content", {
      method: "GET",
      headers: {
        cookie: session.cookie,
      },
      redirect: "manual",
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "NOT_FOUND",
      message: "Profile image was not found.",
    });
  });

  it("returns not found when the requested avatar version is missing or stale", async ({ env }) => {
    const missingSession = await env.auth.createSession({
      email: "integration-new-avatar-content-version-missing@example.com",
    });
    const missingObjectKey = `avatars/users/${missingSession.userId}/img_existing.webp`;
    await putStoredAvatar(env, {
      objectKey: missingObjectKey,
      userId: missingSession.userId,
    });
    await env.objectStore.deleteObject(missingObjectKey);

    const missingResponse = await env.controlPlaneApi.http.fetch("/v1/me/profile-image/content", {
      method: "GET",
      headers: {
        cookie: missingSession.cookie,
      },
      redirect: "manual",
    });
    expect(missingResponse.status).toBe(404);
    await expect(missingResponse.json()).resolves.toEqual({
      code: "NOT_FOUND",
      message: "Profile image was not found.",
    });

    const staleSession = await env.auth.createSession({
      email: "integration-new-avatar-content-version-stale@example.com",
    });
    const currentObjectKey = `avatars/users/${staleSession.userId}/img_current.webp`;
    const staleObjectKey = `avatars/users/${staleSession.userId}/img_stale.webp`;
    await putStoredAvatar(env, {
      objectKey: currentObjectKey,
      userId: staleSession.userId,
    });

    const staleResponse = await env.controlPlaneApi.http.fetch(
      `/v1/me/profile-image/content?v=${encodeURIComponent(staleObjectKey)}`,
      {
        method: "GET",
        headers: {
          cookie: staleSession.cookie,
        },
        redirect: "manual",
      },
    );
    expect(staleResponse.status).toBe(404);
    await expect(staleResponse.json()).resolves.toEqual({
      code: "NOT_FOUND",
      message: "Profile image was not found.",
    });
  });

  it("rejects profile image uploads when the multipart body is missing the file field", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-avatar-validation@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/me/profile-image", {
      method: "PUT",
      headers: {
        cookie: session.cookie,
      },
      body: new FormData(),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });

  it("deletes the stored profile image and removes the object", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-avatar-delete@example.com",
    });
    const objectKey = `avatars/users/${session.userId}/img_previous.webp`;
    await putStoredAvatar(env, {
      objectKey,
      userId: session.userId,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/me/profile-image", {
      method: "DELETE",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");

    const persistedUser = await env.controlPlaneDb.query.users.findFirst({
      columns: {
        imageObjectKey: true,
      },
      where: (table, { eq }) => eq(table.id, session.userId),
    });
    expect(persistedUser).toEqual({
      imageObjectKey: null,
    });
    await expect(env.objectStore.headObject(objectKey)).rejects.toMatchObject({
      name: "NotFound",
    });
  });

  it("returns profile image metadata when an avatar exists", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-avatar-read-existing@example.com",
    });
    const objectKey = `avatars/users/${session.userId}/img_existing.webp`;
    await putStoredAvatar(env, {
      objectKey,
      userId: session.userId,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/me/profile-image", {
      method: "GET",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      hasImage: true,
      imageVersion: objectKey,
    });
  });
});

type ProfileImageMetadata = ReturnType<typeof ProfileImageMetadataResponseSchema.parse>;

async function uploadProfileImage(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  filename: string;
  image: Buffer;
}): Promise<ProfileImageMetadata> {
  const formData = new FormData();
  formData.set(
    "file",
    new File([new Uint8Array(input.image)], input.filename, {
      type: "image/jpeg",
    }),
  );

  const response = await input.env.controlPlaneApi.http.fetch("/v1/me/profile-image", {
    method: "PUT",
    headers: {
      cookie: input.cookie,
    },
    body: formData,
  });

  if (response.status !== 200) {
    throw new Error(
      `Expected profile image upload response status 200, got ${String(response.status)}: ${await response.text()}`,
    );
  }

  return ProfileImageMetadataResponseSchema.parse(await response.json());
}

async function fetchProfileImageContent(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  imageVersion: string;
}): Promise<Response> {
  const redirectResponse = await input.env.controlPlaneApi.http.fetch(
    `/v1/me/profile-image/content?v=${encodeURIComponent(input.imageVersion)}`,
    {
      method: "GET",
      headers: {
        cookie: input.cookie,
      },
      redirect: "manual",
    },
  );

  expect(redirectResponse.status).toBe(302);
  const imageUrl = redirectResponse.headers.get("location");
  if (imageUrl === null) {
    throw new Error("Expected profile image content response to include location.");
  }

  return await fetch(imageUrl);
}

async function createSourceJpeg(): Promise<Buffer> {
  return await sharp({
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
}

async function createStoredWebp(): Promise<Buffer> {
  return await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 3,
      background: {
        r: 255,
        g: 255,
        b: 255,
      },
    },
  })
    .webp()
    .toBuffer();
}

async function putStoredAvatar(
  env: IntegrationTestEnvironment,
  input: {
    objectKey: string;
    userId: string;
  },
): Promise<void> {
  await env.objectStore.putObject({
    objectKey: input.objectKey,
    Body: await createStoredWebp(),
    ContentType: "image/webp",
  });
  await env.controlPlaneDb
    .update(env.controlPlaneTables.users)
    .set({
      imageObjectKey: input.objectKey,
    })
    .where(eq(env.controlPlaneTables.users.id, input.userId));
}
