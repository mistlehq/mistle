/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { SandboxInstancesNotFoundResponseSchema } from "../src/sandbox-instances/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("sandbox instance title patch integration", () => {
  it("patches the sandbox instance title for the active organization", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-patch-title@example.com",
    });

    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: "sbi_cp_patch_title",
      organizationId: session.organizationId,
      sandboxProfileId: "sbp_cp_patch_title",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-cp-patch-title",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: session.userId,
      source: "dashboard",
      title: null,
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_patch_title/title",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          title: "Updated from control plane",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "sbi_cp_patch_title",
      title: "Updated from control plane",
      updatedAt: expect.any(String),
    });

    const patchedSandboxInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        id: true,
        title: true,
      },
      where: (table, { eq }) => eq(table.id, "sbi_cp_patch_title"),
    });

    expect(patchedSandboxInstance).toEqual({
      id: "sbi_cp_patch_title",
      title: "Updated from control plane",
    });
  });

  it("returns not found when the sandbox instance is outside the active organization", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-patch-title-not-found@example.com",
    });

    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values({
      id: "sbi_cp_patch_title_not_found",
      organizationId: "org_cp_patch_title_other",
      sandboxProfileId: "sbp_cp_patch_title",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-cp-patch-title-not-found",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: session.userId,
      source: "dashboard",
      title: "Existing title",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_patch_title_not_found/title",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          title: "Should not be written",
        }),
      },
    );

    expect(response.status).toBe(404);
    const body = SandboxInstancesNotFoundResponseSchema.parse(await response.json());
    expect(body).toEqual({
      code: "INSTANCE_NOT_FOUND",
      message: "Sandbox instance 'sbi_cp_patch_title_not_found' was not found.",
    });

    const untouchedSandboxInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        title: true,
      },
      where: (table, { eq }) => eq(table.id, "sbi_cp_patch_title_not_found"),
    });

    expect(untouchedSandboxInstance).toEqual({
      title: "Existing title",
    });
  });

  it("rejects blank titles", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-patch-title-validation@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances/sbi_cp_patch_title_validation/title",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          cookie: session.cookie,
        },
        body: JSON.stringify({
          title: "   ",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid request.",
    });
  });
});
