/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import sharp from "sharp";
import { describe, expect } from "vitest";

import { ProfileImageMetadataResponseSchema } from "../src/me/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
  extraInfra: ["seaweedfs"],
});

describe.concurrent("user avatar endpoints integration", () => {
  it("uploads a profile image and serves the normalized avatar content", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-avatar-upload@example.com",
    });

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
        imageObjectKey: true,
      },
      where: (table, { eq }) => eq(table.id, session.userId),
    });
    expect(persistedUser?.imageObjectKey).toBe(uploadPayload.imageVersion);

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
