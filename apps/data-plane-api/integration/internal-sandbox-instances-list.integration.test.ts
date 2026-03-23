import {
  DATA_PLANE_INTERNAL_AUTH_HEADER,
  createDataPlaneSandboxInstancesClient,
} from "@mistle/data-plane-internal-client";
import { sandboxInstances, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { describe, expect } from "vitest";

import { INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH } from "../src/internal/sandbox-instances/index.js";
import { it } from "./test-context.js";

describe("internal sandbox instances list integration", () => {
  it("returns a paginated, organization-scoped sandbox instance list", async ({ fixture }) => {
    const client = createDataPlaneSandboxInstancesClient({
      baseUrl: fixture.baseUrl,
      serviceToken: fixture.internalAuthServiceToken,
    });

    await fixture.db.insert(sandboxInstances).values([
      {
        id: "sbi_list_org_a_001",
        organizationId: "org_dp_list_a",
        sandboxProfileId: "sbp_list",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerRuntimeId: "provider-list-a-001",
        status: SandboxInstanceStatuses.STOPPED,
        startedByKind: "user",
        startedById: "usr_list_a",
        source: "dashboard",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
      },
      {
        id: "sbi_list_org_a_002",
        organizationId: "org_dp_list_a",
        sandboxProfileId: "sbp_list",
        sandboxProfileVersion: 2,
        runtimeProvider: "docker",
        providerRuntimeId: "provider-list-a-002",
        status: SandboxInstanceStatuses.STOPPED,
        startedByKind: "user",
        startedById: "usr_list_a",
        source: "dashboard",
        createdAt: "2026-03-11T00:00:00.000Z",
        updatedAt: "2026-03-11T00:00:00.000Z",
      },
      {
        id: "sbi_list_org_a_003",
        organizationId: "org_dp_list_a",
        sandboxProfileId: "sbp_list",
        sandboxProfileVersion: 3,
        runtimeProvider: "docker",
        providerRuntimeId: "provider-list-a-003",
        status: SandboxInstanceStatuses.FAILED,
        startedByKind: "system",
        startedById: "aru_list_a",
        source: "webhook",
        failureCode: "SANDBOX_START_FAILED",
        failureMessage: "Sandbox failed to start.",
        createdAt: "2026-03-12T00:00:00.000Z",
        updatedAt: "2026-03-12T00:05:00.000Z",
      },
      {
        id: "sbi_list_org_b_001",
        organizationId: "org_dp_list_b",
        sandboxProfileId: "sbp_other_org",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerRuntimeId: "provider-list-b-001",
        status: SandboxInstanceStatuses.STOPPED,
        startedByKind: "user",
        startedById: "usr_list_b",
        source: "dashboard",
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
      },
    ]);

    const firstPage = await client.listSandboxInstances({
      organizationId: "org_dp_list_a",
      limit: 2,
    });

    expect(firstPage.totalResults).toBe(3);
    expect(firstPage.items.map((item) => item.id)).toEqual([
      "sbi_list_org_a_003",
      "sbi_list_org_a_002",
    ]);
    expect(firstPage.items[0]).toMatchObject({
      sandboxProfileId: "sbp_list",
      sandboxProfileVersion: 3,
      status: "failed",
      startedBy: {
        kind: "system",
        id: "aru_list_a",
      },
      source: "webhook",
      failureCode: "SANDBOX_START_FAILED",
      failureMessage: "Sandbox failed to start.",
    });
    expect(new Date(firstPage.items[0]?.createdAt ?? "").toISOString()).toBe(
      "2026-03-12T00:00:00.000Z",
    );
    expect(new Date(firstPage.items[0]?.updatedAt ?? "").toISOString()).toBe(
      "2026-03-12T00:05:00.000Z",
    );
    expect(firstPage.previousPage).toBeNull();
    expect(firstPage.nextPage).not.toBeNull();

    if (firstPage.nextPage === null) {
      throw new Error("Expected next page cursor.");
    }

    const secondPage = await client.listSandboxInstances({
      organizationId: "org_dp_list_a",
      limit: 2,
      after: firstPage.nextPage.after,
    });

    expect(secondPage.totalResults).toBe(3);
    expect(secondPage.items.map((item) => item.id)).toEqual(["sbi_list_org_a_001"]);
    expect(secondPage.nextPage).toBeNull();
    expect(secondPage.previousPage).not.toBeNull();
  }, 60_000);

  it("returns 400 for invalid pagination cursor", async ({ fixture }) => {
    const response = await fetch(
      new URL(`${INTERNAL_SANDBOX_INSTANCES_ROUTE_BASE_PATH}/list`, fixture.baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [DATA_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: "org_dp_list_invalid_cursor",
          after: "invalid!",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_PAGINATION_CURSOR",
      message: expect.stringContaining("`after` cursor"),
    });
  }, 60_000);
});
