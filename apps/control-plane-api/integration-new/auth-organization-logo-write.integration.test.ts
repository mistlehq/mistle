/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { describe, expect } from "vitest";

import { OrganizationLogoMetadataResponseSchema } from "../src/organizations/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
  extraInfra: ["seaweedfs"],
});

describe.concurrent("organization logo write integration", () => {
  it("uploads an organization logo and serves normalized WebP content", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-organization-logo-upload@example.com",
    });

    const uploadPayload = await uploadOrganizationLogo({
      cookie: session.cookie,
      env,
      filename: "logo.jpg",
      image: await createSourceJpeg(),
    });

    expect(uploadPayload.hasImage).toBe(true);
    expect(uploadPayload.imageVersion).toMatch(
      new RegExp(`^logos/organizations/${session.organizationId}/img_[^/]+\\.webp$`, "u"),
    );

    if (uploadPayload.imageVersion === null) {
      throw new Error("Expected organization logo upload response to include imageVersion.");
    }

    const persistedOrganization = await env.controlPlaneDb.query.organizations.findFirst({
      columns: {
        logo: true,
        logoObjectKey: true,
      },
      where: (table, { eq }) => eq(table.id, session.organizationId),
    });
    expect(persistedOrganization).toEqual({
      logo: null,
      logoObjectKey: uploadPayload.imageVersion,
    });

    const storedObject = await env.objectStore.headObject(uploadPayload.imageVersion);
    expect(storedObject.ContentType).toBe("image/webp");

    const imageResponse = await fetchOrganizationLogoContent({
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

  it("returns a validation error when the multipart body is missing the file field", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-organization-logo-validation@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/organization/logo", {
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

  it("deletes the uploaded organization logo and removes the stored object", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-organization-logo-delete@example.com",
    });
    const previousObjectKey = `logos/organizations/${session.organizationId}/img_previous.webp`;

    await env.objectStore.putObject({
      Body: await createStoredWebp(),
      ContentType: "image/webp",
      objectKey: previousObjectKey,
    });
    await setOrganizationLogoObjectKey({
      env,
      objectKey: previousObjectKey,
      organizationId: session.organizationId,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/organization/logo", {
      method: "DELETE",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");

    const persistedOrganization = await env.controlPlaneDb.query.organizations.findFirst({
      columns: {
        logoObjectKey: true,
      },
      where: (table, { eq }) => eq(table.id, session.organizationId),
    });
    expect(persistedOrganization).toEqual({
      logoObjectKey: null,
    });

    await expect(env.objectStore.headObject(previousObjectKey)).rejects.toMatchObject({
      name: "NotFound",
    });
  });
});

type OrganizationLogoMetadata = ReturnType<typeof OrganizationLogoMetadataResponseSchema.parse>;

async function uploadOrganizationLogo(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  filename: string;
  image: Buffer;
}): Promise<OrganizationLogoMetadata> {
  const formData = new FormData();
  formData.set(
    "file",
    new File([new Uint8Array(input.image)], input.filename, {
      type: "image/jpeg",
    }),
  );

  const response = await input.env.controlPlaneApi.http.fetch("/v1/organization/logo", {
    method: "PUT",
    headers: {
      cookie: input.cookie,
    },
    body: formData,
  });

  if (response.status !== 200) {
    throw new Error(
      `Expected organization logo upload response status 200, got ${String(response.status)}: ${await response.text()}`,
    );
  }

  return OrganizationLogoMetadataResponseSchema.parse(await response.json());
}

async function fetchOrganizationLogoContent(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
  imageVersion: string;
}): Promise<Response> {
  const redirectResponse = await input.env.controlPlaneApi.http.fetch(
    `/v1/organization/logo/content?v=${encodeURIComponent(input.imageVersion)}`,
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
    throw new Error("Expected organization logo content response to include location.");
  }

  return await fetch(imageUrl);
}

async function setOrganizationLogoObjectKey(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  objectKey: string;
}): Promise<void> {
  await input.env.controlPlaneDb
    .update(input.env.controlPlaneTables.organizations)
    .set({
      logoObjectKey: input.objectKey,
    })
    .where(eq(input.env.controlPlaneTables.organizations.id, input.organizationId));
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

async function createStoredWebp(): Promise<Uint8Array> {
  return new Uint8Array(
    await fetch(
      "data:image/webp;base64,UklGRkIAAABXRUJQVlA4IDYAAADQAQCdASoBAAEAAUAmJZQCdAEO/gAAF0tEtQAA/vuUAAA=",
    ).then((response) => response.arrayBuffer()),
  );
}
