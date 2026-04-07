import { sandboxInstances, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { describe, expect } from "vitest";

import { INTERNAL_SANDBOX_ROUTE_BASE_PATH } from "../src/internal/index.js";
import { it } from "./test-context.js";

const InternalAuthHeader = "x-mistle-service-token";

describe("internal sandbox instance title patch integration", () => {
  it("patches the sandbox instance title for the matching organization", async ({ fixture }) => {
    await fixture.db.insert(sandboxInstances).values({
      id: "sbi_conventional_patch_title",
      organizationId: "org_dp_api_patch_title",
      sandboxProfileId: "sbp_patch_title",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-patch-title",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: "usr_patch_title",
      source: "dashboard",
      title: null,
    });

    const response = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_patch_title`,
        fixture.baseUrl,
      ),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          [InternalAuthHeader]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: "org_dp_api_patch_title",
          title: "Renamed from Codex",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: "sbi_conventional_patch_title",
      title: "Renamed from Codex",
    });

    const patchedSandboxInstance = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        id: true,
        title: true,
      },
      where: (table, { eq: whereEq }) => whereEq(table.id, "sbi_conventional_patch_title"),
    });

    expect(patchedSandboxInstance).toEqual({
      id: "sbi_conventional_patch_title",
      title: "Renamed from Codex",
    });
  });

  it("returns not found when the sandbox instance is outside the organization scope", async ({
    fixture,
  }) => {
    await fixture.db.insert(sandboxInstances).values({
      id: "sbi_conventional_patch_title_not_found",
      organizationId: "org_dp_api_patch_title_other",
      sandboxProfileId: "sbp_patch_title",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-patch-title-not-found",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: "usr_patch_title",
      source: "dashboard",
      title: "Existing title",
    });

    const response = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_patch_title_not_found`,
        fixture.baseUrl,
      ),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          [InternalAuthHeader]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: "org_dp_api_patch_title",
          title: "Should not be written",
        }),
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "NOT_FOUND",
      message: "Sandbox instance 'sbi_conventional_patch_title_not_found' was not found.",
    });

    const untouchedSandboxInstance = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        title: true,
      },
      where: (table, { eq: whereEq }) =>
        whereEq(table.id, "sbi_conventional_patch_title_not_found"),
    });

    expect(untouchedSandboxInstance).toEqual({
      title: "Existing title",
    });
  });

  it("rejects blank titles", async ({ fixture }) => {
    const response = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_conventional_patch_title_validation`,
        fixture.baseUrl,
      ),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          [InternalAuthHeader]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: "org_dp_api_patch_title",
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
