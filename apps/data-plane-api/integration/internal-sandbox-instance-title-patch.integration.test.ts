import {
  sandboxInstances,
  SandboxInstancePurposes,
  SandboxInstanceStatuses,
} from "@mistle/db/data-plane";
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
      updatedAt: expect.any(String),
    });

    const patchedSandboxInstance = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        id: true,
        title: true,
        updatedAt: true,
      },
      where: (table, { eq: whereEq }) => whereEq(table.id, "sbi_conventional_patch_title"),
    });

    expect(patchedSandboxInstance).toEqual({
      id: "sbi_conventional_patch_title",
      title: "Renamed from Codex",
      updatedAt: expect.any(String),
    });
  });

  it("patches the sandbox instance title only when unset when requested", async ({ fixture }) => {
    await fixture.db.insert(sandboxInstances).values([
      {
        id: "sbi_patch_title_if_unset_empty",
        organizationId: "org_dp_api_patch_title_if_unset",
        sandboxProfileId: "sbp_patch_title",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-patch-title-if-unset-empty",
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "user",
        startedById: "usr_patch_title",
        source: "dashboard",
        title: null,
      },
      {
        id: "sbi_patch_title_if_unset_existing",
        organizationId: "org_dp_api_patch_title_if_unset",
        sandboxProfileId: "sbp_patch_title",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-patch-title-if-unset-existing",
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "user",
        startedById: "usr_patch_title",
        source: "dashboard",
        title: "Manual title",
      },
    ]);

    const patchUnsetResponse = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_patch_title_if_unset_empty`,
        fixture.baseUrl,
      ),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          [InternalAuthHeader]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          onlyIfUnset: true,
          organizationId: "org_dp_api_patch_title_if_unset",
          title: "Generated title",
        }),
      },
    );

    expect(patchUnsetResponse.status).toBe(200);
    await expect(patchUnsetResponse.json()).resolves.toEqual({
      id: "sbi_patch_title_if_unset_empty",
      title: "Generated title",
      updatedAt: expect.any(String),
    });

    const keepExistingResponse = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_patch_title_if_unset_existing`,
        fixture.baseUrl,
      ),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          [InternalAuthHeader]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          onlyIfUnset: true,
          organizationId: "org_dp_api_patch_title_if_unset",
          title: "Generated title",
        }),
      },
    );

    expect(keepExistingResponse.status).toBe(200);
    await expect(keepExistingResponse.json()).resolves.toEqual({
      id: "sbi_patch_title_if_unset_existing",
      title: "Manual title",
      updatedAt: expect.any(String),
    });

    const sandboxInstancesAfterPatch = await fixture.db.query.sandboxInstances.findMany({
      columns: {
        id: true,
        title: true,
      },
      where: (table, { eq: whereEq }) =>
        whereEq(table.organizationId, "org_dp_api_patch_title_if_unset"),
    });

    expect(sandboxInstancesAfterPatch).toEqual(
      expect.arrayContaining([
        {
          id: "sbi_patch_title_if_unset_empty",
          title: "Generated title",
        },
        {
          id: "sbi_patch_title_if_unset_existing",
          title: "Manual title",
        },
      ]),
    );
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

  it("returns not found for setup-check-purpose sandbox instances", async ({ fixture }) => {
    await fixture.db.insert(sandboxInstances).values({
      id: "sbi_patch_title_setup_check",
      organizationId: "org_dp_api_patch_title_setup_check",
      sandboxProfileId: "sbp_patch_title_setup_check",
      sandboxProfileVersion: 1,
      runtimeProvider: "docker",
      providerSandboxId: "provider-patch-title-setup-check",
      status: SandboxInstanceStatuses.RUNNING,
      startedByKind: "user",
      startedById: "usr_patch_title_setup_check",
      source: "dashboard",
      purpose: SandboxInstancePurposes.SETUP_CHECK,
      title: "Setup check title",
    });

    const response = await fetch(
      new URL(
        `${INTERNAL_SANDBOX_ROUTE_BASE_PATH}/instances/sbi_patch_title_setup_check`,
        fixture.baseUrl,
      ),
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          [InternalAuthHeader]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: "org_dp_api_patch_title_setup_check",
          title: "Should not be written",
        }),
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: "NOT_FOUND",
      message: "Sandbox instance 'sbi_patch_title_setup_check' was not found.",
    });

    const untouchedSandboxInstance = await fixture.db.query.sandboxInstances.findFirst({
      columns: {
        title: true,
      },
      where: (table, { eq: whereEq }) => whereEq(table.id, "sbi_patch_title_setup_check"),
    });

    expect(untouchedSandboxInstance).toEqual({
      title: "Setup check title",
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
