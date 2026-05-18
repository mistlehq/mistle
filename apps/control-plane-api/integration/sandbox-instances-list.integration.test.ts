/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { TriggerRunStatuses, SandboxProfileStatuses } from "@mistle/db/control-plane";
import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { eq } from "drizzle-orm";
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

    await env.controlPlaneDb.insert(env.controlPlaneTables.triggers).values({
      id: "atm_cp_list",
      organizationId: firstOrgSession.organizationId,
      kind: "webhook",
      name: "GitHub Repo Triage",
      enabled: true,
      createdAt: "2026-03-02T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.triggerRuns).values({
      id: "aru_cp_list",
      triggerId: "atm_cp_list",
      status: TriggerRunStatuses.RUNNING,
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

  it("filters sandbox instances by search, owner, start source, and trigger", async ({ env }) => {
    const ownerSession = await env.auth.createSession({
      email: "integration-new-sandbox-instances-filter-owner@example.com",
    });
    const memberSession = await env.auth.createSession({
      email: "integration-new-sandbox-instances-filter-member@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.members).values({
      organizationId: ownerSession.organizationId,
      userId: memberSession.userId,
      role: "member",
    });
    await env.controlPlaneDb
      .update(env.controlPlaneTables.sessions)
      .set({
        activeOrganizationId: ownerSession.organizationId,
      })
      .where(eq(env.controlPlaneTables.sessions.userId, memberSession.userId));

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values([
      {
        id: "sbp_cp_filter_planetscale",
        organizationId: ownerSession.organizationId,
        displayName: "PlanetScale Inspector",
        status: SandboxProfileStatuses.ACTIVE,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
      {
        id: "sbp_cp_filter_general",
        organizationId: ownerSession.organizationId,
        displayName: "General Worker",
        status: SandboxProfileStatuses.ACTIVE,
        createdAt: "2026-03-01T00:00:00.000Z",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);
    await env.controlPlaneDb.insert(env.controlPlaneTables.triggers).values([
      {
        id: "atm_cp_filter_slack",
        organizationId: ownerSession.organizationId,
        kind: "webhook",
        name: "Slack app mention received",
        enabled: true,
        createdAt: "2026-03-02T00:00:00.000Z",
        updatedAt: "2026-03-02T00:00:00.000Z",
      },
      {
        id: "atm_cp_filter_schedule",
        organizationId: ownerSession.organizationId,
        kind: "schedule",
        name: "Nightly cleanup",
        enabled: true,
        createdAt: "2026-03-02T00:00:00.000Z",
        updatedAt: "2026-03-02T00:00:00.000Z",
      },
    ]);
    await env.controlPlaneDb.insert(env.controlPlaneTables.triggerRuns).values([
      {
        id: "aru_cp_filter_slack",
        triggerId: "atm_cp_filter_slack",
        status: TriggerRunStatuses.RUNNING,
        createdAt: "2026-03-11T00:00:00.000Z",
        startedAt: "2026-03-11T00:00:00.000Z",
        updatedAt: "2026-03-11T00:00:00.000Z",
      },
      {
        id: "aru_cp_filter_schedule",
        triggerId: "atm_cp_filter_schedule",
        status: TriggerRunStatuses.RUNNING,
        createdAt: "2026-03-12T00:00:00.000Z",
        startedAt: "2026-03-12T00:00:00.000Z",
        updatedAt: "2026-03-12T00:00:00.000Z",
      },
    ]);

    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values([
      {
        id: "sbi_cp_filter_owner",
        organizationId: ownerSession.organizationId,
        sandboxProfileId: "sbp_cp_filter_planetscale",
        title: "Inspect PlanetScale data",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-cp-filter-owner",
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "user",
        startedById: ownerSession.userId,
        source: "dashboard",
        createdAt: "2026-03-15T00:00:00.000Z",
        updatedAt: "2026-03-15T00:00:00.000Z",
      },
      {
        id: "sbi_cp_filter_other_user",
        organizationId: ownerSession.organizationId,
        sandboxProfileId: "sbp_cp_filter_general",
        title: "Manual member session",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-cp-filter-other-user",
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "user",
        startedById: memberSession.userId,
        source: "dashboard",
        createdAt: "2026-03-14T00:00:00.000Z",
        updatedAt: "2026-03-14T00:00:00.000Z",
      },
      {
        id: "sbi_cp_filter_slack",
        organizationId: ownerSession.organizationId,
        sandboxProfileId: "sbp_cp_filter_general",
        title: "Slack app mention received",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-cp-filter-slack",
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "system",
        startedById: "aru_cp_filter_slack",
        source: "webhook",
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
      },
      {
        id: "sbi_cp_filter_schedule",
        organizationId: ownerSession.organizationId,
        sandboxProfileId: "sbp_cp_filter_general",
        title: "Scheduled cleanup",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-cp-filter-schedule",
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "system",
        startedById: "aru_cp_filter_schedule",
        source: "schedule",
        createdAt: "2026-03-12T00:00:00.000Z",
        updatedAt: "2026-03-12T00:00:00.000Z",
      },
    ]);

    const ownerResponse = await env.controlPlaneApi.http.fetch("/v1/sandbox/instances?owner=me", {
      headers: { cookie: ownerSession.cookie },
    });
    expect(ownerResponse.status).toBe(200);
    const ownerBody = ListSandboxInstancesResponseSchema.parse(await ownerResponse.json());
    expect(ownerBody.items.map((item) => item.id)).toEqual(["sbi_cp_filter_owner"]);

    const unsupportedOwnerResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances?owner=others",
      {
        headers: { cookie: ownerSession.cookie },
      },
    );
    expect(unsupportedOwnerResponse.status).toBe(400);

    const triggerResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances?startedFrom=trigger",
      {
        headers: { cookie: ownerSession.cookie },
      },
    );
    expect(triggerResponse.status).toBe(200);
    const triggerBody = ListSandboxInstancesResponseSchema.parse(await triggerResponse.json());
    expect(triggerBody.items.map((item) => item.id)).toEqual([
      "sbi_cp_filter_slack",
      "sbi_cp_filter_schedule",
    ]);

    const specificTriggerResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances?startedFrom=trigger&triggerId=atm_cp_filter_slack",
      {
        headers: { cookie: ownerSession.cookie },
      },
    );
    expect(specificTriggerResponse.status).toBe(200);
    const specificTriggerBody = ListSandboxInstancesResponseSchema.parse(
      await specificTriggerResponse.json(),
    );
    expect(specificTriggerBody.items.map((item) => item.id)).toEqual(["sbi_cp_filter_slack"]);

    const searchResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances?search=PlanetScale",
      {
        headers: { cookie: ownerSession.cookie },
      },
    );
    expect(searchResponse.status).toBe(200);
    const searchBody = ListSandboxInstancesResponseSchema.parse(await searchResponse.json());
    expect(searchBody.items.map((item) => item.id)).toEqual(["sbi_cp_filter_owner"]);
  });

  it("filters a specific trigger when it has more trigger runs than one data-plane id filter can carry", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-sandbox-instances-long-trigger@example.com",
    });

    await env.controlPlaneDb.insert(env.controlPlaneTables.sandboxProfiles).values({
      id: "sbp_cp_filter_long_trigger",
      organizationId: session.organizationId,
      displayName: "Long-running Trigger Profile",
      status: SandboxProfileStatuses.ACTIVE,
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    await env.controlPlaneDb.insert(env.controlPlaneTables.triggers).values({
      id: "atm_cp_filter_long_trigger",
      organizationId: session.organizationId,
      kind: "webhook",
      name: "Long-running trigger",
      enabled: true,
      createdAt: "2026-03-02T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
    });

    const triggerRuns = Array.from({ length: 501 }, (_, index) => {
      const suffix = String(index).padStart(3, "0");
      return {
        id: `aru_cp_filter_long_trigger_${suffix}`,
        triggerId: "atm_cp_filter_long_trigger",
        status: TriggerRunStatuses.RUNNING,
        createdAt: "2026-03-11T00:00:00.000Z",
        startedAt: "2026-03-11T00:00:00.000Z",
        updatedAt: "2026-03-11T00:00:00.000Z",
      };
    });
    const firstTriggerRunId = triggerRuns[0]?.id;
    const lastTriggerRunId = triggerRuns.at(-1)?.id;
    if (firstTriggerRunId === undefined || lastTriggerRunId === undefined) {
      throw new Error("Expected generated trigger runs for long trigger filter test.");
    }

    await env.controlPlaneDb.insert(env.controlPlaneTables.triggerRuns).values(triggerRuns);
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values([
      {
        id: "sbi_cp_filter_long_trigger_newer",
        organizationId: session.organizationId,
        sandboxProfileId: "sbp_cp_filter_long_trigger",
        title: "Newest long trigger session",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-cp-filter-long-trigger-newer",
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "system",
        startedById: lastTriggerRunId,
        source: "webhook",
        createdAt: "2026-03-16T00:00:00.000Z",
        updatedAt: "2026-03-16T00:00:00.000Z",
      },
      {
        id: "sbi_cp_filter_long_trigger_older",
        organizationId: session.organizationId,
        sandboxProfileId: "sbp_cp_filter_long_trigger",
        title: "Older long trigger session",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerSandboxId: "provider-cp-filter-long-trigger-older",
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "system",
        startedById: firstTriggerRunId,
        source: "webhook",
        createdAt: "2026-03-15T00:00:00.000Z",
        updatedAt: "2026-03-15T00:00:00.000Z",
      },
    ]);

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances?startedFrom=trigger&triggerId=atm_cp_filter_long_trigger",
      {
        headers: { cookie: session.cookie },
      },
    );
    expect(response.status).toBe(200);
    const body = ListSandboxInstancesResponseSchema.parse(await response.json());
    expect(body.items.map((item) => item.id)).toEqual([
      "sbi_cp_filter_long_trigger_newer",
      "sbi_cp_filter_long_trigger_older",
    ]);

    const searchResponse = await env.controlPlaneApi.http.fetch(
      "/v1/sandbox/instances?search=Long-running%20trigger",
      {
        headers: { cookie: session.cookie },
      },
    );
    expect(searchResponse.status).toBe(200);
    ListSandboxInstancesResponseSchema.parse(await searchResponse.json());
  });
});
