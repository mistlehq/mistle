/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { createIntegrationTest } from "@mistle/test-harness/integration";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { describe, expect } from "vitest";

const it = createIntegrationTest({
  services: ["control-plane-api"],
  extraInfra: ["seaweedfs"],
});

describe.concurrent("organization logo authorization integration", () => {
  it("returns forbidden when the active organization membership has been revoked", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-organization-logo-forbidden@example.com",
    });

    await deleteActiveMembership({
      env,
      organizationId: session.organizationId,
      userId: session.userId,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/organization/logo", {
      method: "GET",
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });

  it("returns forbidden from the content endpoint when membership has been revoked", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-organization-logo-content-forbidden@example.com",
    });

    await deleteActiveMembership({
      env,
      organizationId: session.organizationId,
      userId: session.userId,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/organization/logo/content", {
      method: "GET",
      headers: {
        cookie: session.cookie,
      },
      redirect: "manual",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });

  it("returns forbidden when a same-organization member uploads a logo", async ({ env }) => {
    const ownerSession = await env.auth.createSession({
      email: "integration-new-organization-logo-member-upload-owner@example.com",
    });
    const memberSession = await env.auth.createSession({
      email: "integration-new-organization-logo-member-upload-member@example.com",
    });

    await addMemberToActiveOrganization({
      env,
      organizationId: ownerSession.organizationId,
      userId: memberSession.userId,
    });

    const formData = new FormData();
    formData.set(
      "file",
      new File([new Uint8Array(await createSourceJpeg())], "logo.jpg", {
        type: "image/jpeg",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch("/v1/organization/logo", {
      method: "PUT",
      headers: {
        cookie: memberSession.cookie,
      },
      body: formData,
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });
  });

  it("returns forbidden when a same-organization member deletes a logo", async ({ env }) => {
    const ownerSession = await env.auth.createSession({
      email: "integration-new-organization-logo-member-delete-owner@example.com",
    });
    const memberSession = await env.auth.createSession({
      email: "integration-new-organization-logo-member-delete-member@example.com",
    });
    const objectKey = `logos/organizations/${ownerSession.organizationId}/img_existing.webp`;

    await addMemberToActiveOrganization({
      env,
      organizationId: ownerSession.organizationId,
      userId: memberSession.userId,
    });
    await env.objectStore.putObject({
      Body: createStoredWebp(),
      ContentType: "image/webp",
      objectKey,
    });
    await setOrganizationLogoObjectKey({
      env,
      objectKey,
      organizationId: ownerSession.organizationId,
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/organization/logo", {
      method: "DELETE",
      headers: {
        cookie: memberSession.cookie,
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      code: "FORBIDDEN",
      message: "Forbidden API request.",
    });

    const persistedOrganization = await env.controlPlaneDb.query.organizations.findFirst({
      columns: {
        logoObjectKey: true,
      },
      where: (table, { eq }) => eq(table.id, ownerSession.organizationId),
    });
    expect(persistedOrganization).toEqual({
      logoObjectKey: objectKey,
    });
  });
});

async function addMemberToActiveOrganization(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  userId: string;
}): Promise<void> {
  await input.env.controlPlaneDb.insert(input.env.controlPlaneTables.members).values({
    organizationId: input.organizationId,
    userId: input.userId,
    role: "member",
  });

  await input.env.controlPlaneDb
    .update(input.env.controlPlaneTables.sessions)
    .set({
      activeOrganizationId: input.organizationId,
    })
    .where(eq(input.env.controlPlaneTables.sessions.userId, input.userId));
}

async function deleteActiveMembership(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  userId: string;
}): Promise<void> {
  await input.env.controlPlaneDb
    .delete(input.env.controlPlaneTables.members)
    .where(
      and(
        eq(input.env.controlPlaneTables.members.organizationId, input.organizationId),
        eq(input.env.controlPlaneTables.members.userId, input.userId),
      ),
    );
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

function createStoredWebp(): Uint8Array {
  return Buffer.from(
    "UklGRkIAAABXRUJQVlA4IDYAAADQAQCdASoBAAEAAUAmJZQCdAEO/gAAF0tEtQAA/vuUAAA=",
    "base64",
  );
}
