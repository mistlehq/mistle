/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { SandboxProfileStatuses } from "@mistle/db/control-plane";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import { ListSandboxInstancesResponseSchema } from "../src/sandbox-instances/index.js";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-api"],
});

describe.concurrent("sandbox instances list integration", () => {
  it("returns the authenticated organization's sandbox instances through the data plane", async ({
    env,
  }) => {
    const firstOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-instances-list-org-a@example.com",
    });
    const secondOrgSession = await env.auth.createSession({
      email: "integration-new-sandbox-instances-list-org-b@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values([
      {
        id: "sbp_cp_list",
        organizationId: firstOrgSession.organizationId,
        displayName: "Control Plane Profile",
        status: SandboxProfileStatuses.ACTIVE,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
      {
        id: "sbp_cp_other_org",
        organizationId: secondOrgSession.organizationId,
        displayName: "Other Org Profile",
        status: SandboxProfileStatuses.ACTIVE,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);

    await env.controlPlaneDb.insert(env.controlPlaneTables.automations).values({
      id: "atm_cp_list",
      organizationId: firstOrgSession.organizationId,
      kind: "webhook",
      name: "GitHub Repo Triage",
      enabled: true,
      createdAt: "2026-03-02T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.automationRuns).values({
      id: "aru_cp_list",
      automationId: "atm_cp_list",
      status: "running",
      createdAt: "2026-03-11T00:00:00.000Z",
      startedAt: "2026-03-11T00:00:00.000Z",
      updatedAt: "2026-03-11T00:00:00.000Z",
    });

    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values([
      {
        id: "sbi_cp_list_a_001",
        organizationId: firstOrgSession.organizationId,
        sandboxProfileId: "sbp_cp_list",
        title: null,
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-cp-list-a-001",
        status: SandboxInstanceStatuses.STARTING,
        startedByKind: "user",
        startedById: firstOrgSession.userId,
        source: "dashboard",
        createdAt: "2026-03-10T00:00:00.000Z",
        updatedAt: "2026-03-10T00:00:00.000Z",
      },
      {
        id: "sbi_cp_list_a_002",
        organizationId: firstOrgSession.organizationId,
        sandboxProfileId: "sbp_cp_list",
        title: null,
        sandboxProfileVersion: 2,
        runtimeProvider: "docker",
        providerSandboxId: "provider-cp-list-a-002",
        status: SandboxInstanceStatuses.FAILED,
        startedByKind: "system",
        startedById: "aru_cp_list",
        source: "webhook",
        failureCode: "SANDBOX_START_FAILED",
        failureMessage: "Sandbox failed to start.",
        createdAt: "2026-03-11T00:00:00.000Z",
        updatedAt: "2026-03-11T00:05:00.000Z",
      },
      {
        id: "sbi_cp_list_a_003",
        organizationId: firstOrgSession.organizationId,
        sandboxProfileId: "sbp_cp_list",
        title: "Investigate build failure",
        sandboxProfileVersion: 3,
        runtimeProvider: "docker",
        providerSandboxId: "provider-cp-list-a-003",
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "user",
        startedById: firstOrgSession.userId,
        source: "dashboard",
        createdAt: "2026-03-12T00:00:00.000Z",
        updatedAt: "2026-03-12T00:00:00.000Z",
      },
      {
        id: "sbi_cp_list_b_001",
        organizationId: secondOrgSession.organizationId,
        sandboxProfileId: "sbp_cp_other_org",
        title: "Other org title",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-cp-list-b-001",
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "user",
        startedById: secondOrgSession.userId,
        source: "dashboard",
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
      },
    ]);

    const firstPageResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances?limit=2",
      {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );
    expect(firstPageResponse.status).toBe(200);
    const firstPage = ListSandboxInstancesResponseSchema.parse(await firstPageResponse.json());

    expect(firstPage.totalResults).toBe(3);
    expect(firstPage.items.map((item) => item.id)).toEqual([
      "sbi_cp_list_a_003",
      "sbi_cp_list_a_002",
    ]);
    expect(firstPage.items[0]?.title).toBe("Investigate build failure");
    expect(firstPage.items[1]).toMatchObject({
      title: null,
      sandboxProfileId: "sbp_cp_list",
      sandboxProfileDisplayName: "Control Plane Profile",
      sandboxProfileVersion: 2,
      status: "failed",
      startedBy: {
        kind: "system",
        id: "aru_cp_list",
        name: "GitHub Repo Triage",
      },
      source: "webhook",
      failureCode: "SANDBOX_START_FAILED",
      failureMessage: "Sandbox failed to start.",
    });
    expect(new Date(firstPage.items[1]?.updatedAt ?? "").toISOString()).toBe(
      "2026-03-11T00:05:00.000Z",
    );
    expect(firstPage.previousPage).toBeNull();
    expect(firstPage.nextPage).not.toBeNull();

    if (firstPage.nextPage === null) {
      throw new Error("Expected next page cursor.");
    }

    const secondPageResponse = await env.controlPlaneApi.http.fetch(
      `/v1/sandbox/instances?limit=2&after=${encodeURIComponent(firstPage.nextPage.after)}`,
      {
        headers: {
          cookie: firstOrgSession.cookie,
        },
      },
    );
    expect(secondPageResponse.status).toBe(200);
    const secondPage = ListSandboxInstancesResponseSchema.parse(await secondPageResponse.json());

    expect(secondPage.totalResults).toBe(3);
    expect(secondPage.items.map((item) => item.id)).toEqual(["sbi_cp_list_a_001"]);
    expect(secondPage.items[0]?.startedBy).toMatchObject({
      kind: "user",
      id: firstOrgSession.userId,
      name: expect.any(String),
    });
    expect(secondPage.items[0]?.sandboxProfileDisplayName).toBe("Control Plane Profile");
    expect(secondPage.previousPage).not.toBeNull();
    expect(secondPage.nextPage).toBeNull();

    const secondOrgResponse = await env.controlPlaneApi.http.fetch("/v1/sandbox/instances", {
      headers: {
        cookie: secondOrgSession.cookie,
      },
    });
    expect(secondOrgResponse.status).toBe(200);
    const secondOrgList = ListSandboxInstancesResponseSchema.parse(await secondOrgResponse.json());
    expect(secondOrgList.totalResults).toBe(1);
    expect(secondOrgList.items.map((item) => item.id)).toEqual(["sbi_cp_list_b_001"]);
    expect(secondOrgList.items[0]?.sandboxProfileDisplayName).toBe("Other Org Profile");
  });

  it("returns 400 when the list cursor is invalid", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-list-invalid-cursor@example.com",
    });

    const response = await env.controlPlaneApi.http.fetch("/v1/sandbox/instances?after=invalid!", {
      headers: {
        cookie: session.cookie,
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: "INVALID_LIST_INSTANCES_INPUT",
      message: expect.stringContaining("`after` cursor"),
    });
  });
});
