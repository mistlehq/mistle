import { sandboxInstances, SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { afterEach, describe, expect } from "vitest";

import { ListSandboxInstancesResponseSchema } from "../src/sandbox-instances/contracts.js";
import {
  createDisposableDataPlaneRuntime,
  type DisposableDataPlaneRuntime,
} from "./helpers/disposable-data-plane-runtime.js";
import { it } from "./test-context.js";

const startedDataPlaneFixtures: DisposableDataPlaneRuntime[] = [];

afterEach(async () => {
  while (startedDataPlaneFixtures.length > 0) {
    const fixture = startedDataPlaneFixtures.pop();
    if (fixture !== undefined) {
      await fixture.stop();
    }
  }
});

describe("sandbox instances list integration", () => {
  it("returns the authenticated organization's sandbox instances through control plane", async ({
    fixture,
  }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_sandbox_instances",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const firstOrgSession = await fixture.authSession({
      email: "integration-sandbox-instances-list-org-a@example.com",
    });
    const secondOrgSession = await fixture.authSession({
      email: "integration-sandbox-instances-list-org-b@example.com",
    });

    await dataPlaneFixture.db.insert(sandboxInstances).values([
      {
        id: "sbi_cp_list_a_001",
        organizationId: firstOrgSession.organizationId,
        sandboxProfileId: "sbp_cp_list",
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerRuntimeId: "provider-cp-list-a-001",
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
        sandboxProfileVersion: 2,
        runtimeProvider: "docker",
        providerRuntimeId: "provider-cp-list-a-002",
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
        sandboxProfileVersion: 3,
        runtimeProvider: "docker",
        providerRuntimeId: "provider-cp-list-a-003",
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
        sandboxProfileVersion: 1,
        runtimeProvider: "docker",
        providerRuntimeId: "provider-cp-list-b-001",
        status: SandboxInstanceStatuses.RUNNING,
        startedByKind: "user",
        startedById: secondOrgSession.userId,
        source: "dashboard",
        createdAt: "2026-03-13T00:00:00.000Z",
        updatedAt: "2026-03-13T00:00:00.000Z",
      },
    ]);

    const firstPageResponse = await fixture.request("/v1/sandbox/instances?limit=2", {
      headers: {
        cookie: firstOrgSession.cookie,
      },
    });
    expect(firstPageResponse.status).toBe(200);
    const firstPage = ListSandboxInstancesResponseSchema.parse(await firstPageResponse.json());

    expect(firstPage.totalResults).toBe(3);
    expect(firstPage.items.map((item) => item.id)).toEqual([
      "sbi_cp_list_a_003",
      "sbi_cp_list_a_002",
    ]);
    expect(firstPage.items[1]).toMatchObject({
      sandboxProfileId: "sbp_cp_list",
      sandboxProfileVersion: 2,
      status: "failed",
      startedBy: {
        kind: "system",
        id: "aru_cp_list",
        name: null,
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

    const secondPageResponse = await fixture.request(
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
    expect(secondPage.previousPage).not.toBeNull();
    expect(secondPage.nextPage).toBeNull();

    const secondOrgResponse = await fixture.request("/v1/sandbox/instances", {
      headers: {
        cookie: secondOrgSession.cookie,
      },
    });
    expect(secondOrgResponse.status).toBe(200);
    const secondOrgList = ListSandboxInstancesResponseSchema.parse(await secondOrgResponse.json());
    expect(secondOrgList.totalResults).toBe(1);
    expect(secondOrgList.items.map((item) => item.id)).toEqual(["sbi_cp_list_b_001"]);
  });

  it("returns 400 when the list cursor is invalid", async ({ fixture }) => {
    const dataPlaneFixture = await createDisposableDataPlaneRuntime({
      controlPlaneDatabaseUrl: fixture.databaseStack.directUrl,
      internalAuthServiceToken: fixture.internalAuthServiceToken,
      workflowNamespaceId: fixture.config.workflow.namespaceId,
      databaseNamePrefix: "mistle_cp_sandbox_instances",
      baseUrl: fixture.config.dataPlaneApi.baseUrl,
    });
    startedDataPlaneFixtures.push(dataPlaneFixture);

    const session = await fixture.authSession({
      email: "integration-sandbox-instances-list-invalid-cursor@example.com",
    });

    const response = await fixture.request("/v1/sandbox/instances?after=invalid!", {
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
