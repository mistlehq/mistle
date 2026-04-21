import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { sandboxInstances, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { describe, expect } from "vitest";

import { it } from "./test-context.js";

describe("internal recent sandbox instances integration", () => {
  it("returns a recent, organization-scoped sandbox instance snapshot ordered by updatedAt", async ({
    fixture,
  }) => {
    const client = createDataPlaneSandboxInstancesClient({
      baseUrl: fixture.baseUrl,
      serviceToken: fixture.internalAuthServiceToken,
    });

    await fixture.db.insert(sandboxInstances).values([
      {
        id: "sbi_recent_org_a_001",
        organizationId: "org_dp_recent_a",
        sandboxProfileId: "sbp_recent",
        title: "Oldest visible session",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-recent-a-001",
        status: SandboxInstanceStatuses.STOPPED,
        startedByKind: "user",
        startedById: "usr_recent_a",
        source: "dashboard",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
      },
      {
        id: "sbi_recent_org_a_002",
        organizationId: "org_dp_recent_a",
        sandboxProfileId: "sbp_recent",
        title: "Newest visible session",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-recent-a-002",
        status: SandboxInstanceStatuses.STOPPED,
        startedByKind: "user",
        startedById: "usr_recent_a",
        source: "dashboard",
        createdAt: "2026-03-09T00:00:00.000Z",
        updatedAt: "2026-03-12T00:00:00.000Z",
      },
      {
        id: "sbi_recent_org_a_003",
        organizationId: "org_dp_recent_a",
        sandboxProfileId: "sbp_recent",
        title: "Tie break lower id",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-recent-a-003",
        status: SandboxInstanceStatuses.STOPPED,
        startedByKind: "user",
        startedById: "usr_recent_a",
        source: "dashboard",
        createdAt: "2026-03-08T00:00:00.000Z",
        updatedAt: "2026-03-11T00:00:00.000Z",
      },
      {
        id: "sbi_recent_org_a_004",
        organizationId: "org_dp_recent_a",
        sandboxProfileId: "sbp_recent",
        title: "Tie break higher id",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-recent-a-004",
        status: SandboxInstanceStatuses.STOPPED,
        startedByKind: "user",
        startedById: "usr_recent_a",
        source: "dashboard",
        createdAt: "2026-03-07T00:00:00.000Z",
        updatedAt: "2026-03-11T00:00:00.000Z",
      },
      {
        id: "sbi_recent_org_b_001",
        organizationId: "org_dp_recent_b",
        sandboxProfileId: "sbp_other_org",
        title: "Other org newest session",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-recent-b-001",
        status: SandboxInstanceStatuses.STOPPED,
        startedByKind: "user",
        startedById: "usr_recent_b",
        source: "dashboard",
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
      },
    ]);

    const response = await client.listRecentSandboxInstances({
      organizationId: "org_dp_recent_a",
      limit: 3,
    });

    expect(response.items.map((item) => item.id)).toEqual([
      "sbi_recent_org_a_002",
      "sbi_recent_org_a_004",
      "sbi_recent_org_a_003",
    ]);
    expect(response.items[0]).toMatchObject({
      title: "Newest visible session",
      status: "stopped",
      keepaliveActive: false,
    });
    expect(response.items[1]).toMatchObject({
      title: "Tie break higher id",
    });
    expect(new Date(response.items[1]?.updatedAt ?? "").toISOString()).toBe(
      "2026-03-11T00:00:00.000Z",
    );
    expect(response.items[2]).toMatchObject({
      title: "Tie break lower id",
    });
    expect(new Date(response.items[2]?.updatedAt ?? "").toISOString()).toBe(
      "2026-03-11T00:00:00.000Z",
    );
  }, 60_000);
});
