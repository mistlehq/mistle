/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import { OrganizationLogoMetadataResponseSchema } from "../src/organizations/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api"],
  extraInfra: ["seaweedfs"],
});

describe.concurrent("organization logo read integration", () => {
  it("returns empty logo metadata when no organization logo is stored", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-organization-logo-read-empty@example.com",
    });

    const payload = await readOrganizationLogoMetadata({
      cookie: session.cookie,
      env,
    });

    expect(payload).toEqual({
      hasImage: false,
      imageVersion: null,
    });
  });

  it("returns stored logo metadata and serves the current logo content", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-organization-logo-read-existing@example.com",
    });
    const objectKey = `logos/organizations/${session.organizationId}/img_existing.webp`;

    await env.objectStore.putObject({
      Body: await createStoredWebp(),
      ContentType: "image/webp",
      objectKey,
    });
    await setOrganizationLogoObjectKey({
      env,
      objectKey,
      organizationId: session.organizationId,
    });

    const payload = await readOrganizationLogoMetadata({
      cookie: session.cookie,
      env,
    });
    expect(payload).toEqual({
      hasImage: true,
      imageVersion: objectKey,
    });

    const imageResponse = await fetchOrganizationLogoContent({
      cookie: session.cookie,
      env,
      imageVersion: objectKey,
    });

    expect(imageResponse.status).toBe(200);
    expect(imageResponse.headers.get("content-type")).toBe("image/webp");
  });

  it("returns not found when no logo is stored for the content endpoint", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-organization-logo-content-missing@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/organization/logo/content", {
      method: "GET",
      headers: {
        cookie: session.cookie,
      },
      redirect: "manual",
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "NOT_FOUND",
      message: "Organization logo was not found.",
    });
  });

  it("returns not found when the requested logo version is missing", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-organization-logo-content-version-missing@example.com",
    });
    const objectKey = `logos/organizations/${session.organizationId}/img_existing.webp`;

    await env.objectStore.putObject({
      Body: await createStoredWebp(),
      ContentType: "image/webp",
      objectKey,
    });
    await setOrganizationLogoObjectKey({
      env,
      objectKey,
      organizationId: session.organizationId,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/organization/logo/content", {
      method: "GET",
      headers: {
        cookie: session.cookie,
      },
      redirect: "manual",
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "NOT_FOUND",
      message: "Organization logo was not found.",
    });
  });

  it("returns not found when the requested logo version is stale", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-organization-logo-content-version-stale@example.com",
    });
    const currentObjectKey = `logos/organizations/${session.organizationId}/img_existing.webp`;
    const staleObjectKey = `logos/organizations/${session.organizationId}/img_stale.webp`;

    await env.objectStore.putObject({
      Body: await createStoredWebp(),
      ContentType: "image/webp",
      objectKey: currentObjectKey,
    });
    await setOrganizationLogoObjectKey({
      env,
      objectKey: currentObjectKey,
      organizationId: session.organizationId,
    });

    const response = await env.controlPlaneApi.http.fetch(
      `/v1/organization/logo/content?v=${encodeURIComponent(staleObjectKey)}`,
      {
        method: "GET",
        headers: {
          cookie: session.cookie,
        },
        redirect: "manual",
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "NOT_FOUND",
      message: "Organization logo was not found.",
    });
  });
});

type OrganizationLogoMetadata = ReturnType<typeof OrganizationLogoMetadataResponseSchema.parse>;

async function readOrganizationLogoMetadata(input: {
  env: IntegrationTestEnvironment;
  cookie: string;
}): Promise<OrganizationLogoMetadata> {
  const response = await input.env.controlPlaneApi.http.fetch("/v1/organization/logo", {
    method: "GET",
    headers: {
      cookie: input.cookie,
    },
  });

  if (response.status !== 200) {
    throw new Error(
      `Expected organization logo metadata response status 200, got ${String(response.status)}: ${await response.text()}`,
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

async function createStoredWebp(): Promise<Uint8Array> {
  return new Uint8Array(
    await fetch(
      "data:image/webp;base64,UklGRkIAAABXRUJQVlA4IDYAAADQAQCdASoBAAEAAUAmJZQCdAEO/gAAF0tEtQAA/vuUAAA=",
    ).then((response) => response.arrayBuffer()),
  );
}
