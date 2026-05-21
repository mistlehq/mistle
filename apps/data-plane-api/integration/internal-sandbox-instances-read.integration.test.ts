/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import {
  createDataPlaneSandboxInstancesClient,
  type DataPlaneSandboxInstancesClient,
} from "@mistle/data-plane-internal-client";
import {
  SandboxInstancePersistenceModes,
  SandboxInstancePurposes,
  SandboxStopReasons,
  SandboxInstanceStatuses,
  SandboxLifecyclePhases,
  SandboxLifecycleStatuses,
  SandboxOperationEventRecordKinds,
  SandboxOperationEventSources,
  SandboxOperationKinds,
  type DataPlaneTables,
} from "@mistle/db/data-plane";
import {
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { expect } from "vitest";

const it = createIntegrationTest({
  services: ["data-plane-api"],
});

it("does not return snapshot-purpose sandbox instances from the get route", async ({ env }) => {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: "sbi_integration_new_get_snapshot",
      organizationId: "org_integration_new_get_hidden",
      sandboxProfileId: "sbp_integration_new_snapshot",
      purpose: SandboxInstancePurposes.SNAPSHOT,
      title: "Snapshot builder",
    }),
  );

  const client = clientFor(env);

  await expect(
    client.getSandboxInstance({
      organizationId: "org_integration_new_get_hidden",
      instanceId: "sbi_integration_new_get_snapshot",
    }),
  ).resolves.toBeNull();
});

it("returns pending sandbox instances before provider provisioning begins", async ({ env }) => {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: "sbi_integration_new_get_pending",
      organizationId: "org_integration_new_get_pending",
      sandboxProfileId: "sbp_integration_new_pending",
      status: SandboxInstanceStatuses.PENDING,
      providerSandboxId: null,
      title: null,
    }),
  );

  await expect(
    clientFor(env).getSandboxInstance({
      organizationId: "org_integration_new_get_pending",
      instanceId: "sbi_integration_new_get_pending",
    }),
  ).resolves.toEqual({
    id: "sbi_integration_new_get_pending",
    title: null,
    status: "pending",
    connectable: false,
    failureCode: null,
    failureMessage: null,
    runtimePlan: null,
    sandboxProfileId: "sbp_integration_new_pending",
    sandboxProfileVersion: 1,
    startupOperation: null,
  });
});

it("does not return deleted sandbox sessions from the get route", async ({ env }) => {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: "sbi_integration_new_get_deleted_session",
      organizationId: "org_integration_new_get_deleted_session",
      sandboxProfileId: "sbp_integration_new_deleted_session",
      deletedAt: "2026-05-19T00:00:00.000Z",
      title: "Deleted session",
    }),
  );

  await expect(
    clientFor(env).getSandboxInstance({
      organizationId: "org_integration_new_get_deleted_session",
      instanceId: "sbi_integration_new_get_deleted_session",
    }),
  ).resolves.toBeNull();
});

it("returns the latest start or resume operation for session startup progress", async ({ env }) => {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: "sbi_integration_new_get_startup_operation",
      organizationId: "org_integration_new_get_startup_operation",
      sandboxProfileId: "sbp_integration_new_startup_operation",
      status: SandboxInstanceStatuses.PENDING,
      providerSandboxId: null,
      title: null,
    }),
  );
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxOperationEvents).values([
    sandboxOperationEventRow({
      id: "soe_integration_new_get_startup_operation_start",
      sandboxInstanceId: "sbi_integration_new_get_startup_operation",
      operationId: "owfr_integration_new_start",
      operationKind: SandboxOperationKinds.START,
      sequence: 1,
      createdAt: "2026-05-13T00:00:00.000Z",
    }),
    sandboxOperationEventRow({
      id: "soe_integration_new_get_startup_operation_resume",
      sandboxInstanceId: "sbi_integration_new_get_startup_operation",
      operationId: "owfr_integration_new_resume",
      operationKind: SandboxOperationKinds.RESUME,
      sequence: 1,
      createdAt: "2026-05-13T00:01:00.000Z",
    }),
    sandboxOperationEventRow({
      id: "soe_integration_new_get_startup_operation_stop",
      sandboxInstanceId: "sbi_integration_new_get_startup_operation",
      operationId: "owfr_integration_new_stop",
      operationKind: SandboxOperationKinds.STOP,
      sequence: 1,
      createdAt: "2026-05-13T00:02:00.000Z",
    }),
  ]);

  await expect(
    clientFor(env).getSandboxInstance({
      organizationId: "org_integration_new_get_startup_operation",
      instanceId: "sbi_integration_new_get_startup_operation",
    }),
  ).resolves.toMatchObject({
    id: "sbi_integration_new_get_startup_operation",
    startupOperation: {
      operationId: "owfr_integration_new_resume",
      operationKind: "resume",
    },
  });
});

it("returns setup-check-purpose sandbox instances by id", async ({ env }) => {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: "sbi_integration_new_get_setup_check",
      organizationId: "org_integration_new_get_setup_check",
      sandboxProfileId: "sbp_integration_new_get_setup_check",
      purpose: SandboxInstancePurposes.SETUP_CHECK,
      status: SandboxInstanceStatuses.PENDING,
      providerSandboxId: null,
      title: "Setup check",
    }),
  );

  await expect(
    clientFor(env).getSandboxInstance({
      organizationId: "org_integration_new_get_setup_check",
      instanceId: "sbi_integration_new_get_setup_check",
    }),
  ).resolves.toEqual({
    id: "sbi_integration_new_get_setup_check",
    title: "Setup check",
    status: "pending",
    connectable: false,
    failureCode: null,
    failureMessage: null,
    runtimePlan: null,
    sandboxProfileId: "sbp_integration_new_get_setup_check",
    sandboxProfileVersion: 1,
    startupOperation: null,
  });
});

it("marks ephemeral starting sandbox instances failed when provider inspection misses the runtime", async ({
  env,
}) => {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: "sbi_integration_new_get_missing_starting",
      organizationId: "org_integration_new_get_missing_starting",
      sandboxProfileId: "sbp_integration_new_missing_starting",
      persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
      status: SandboxInstanceStatuses.STARTING,
      providerSandboxId: "integration-new-missing-starting-runtime",
      title: "Missing ephemeral runtime",
    }),
  );

  await expect(
    clientFor(env).getSandboxInstance({
      organizationId: "org_integration_new_get_missing_starting",
      instanceId: "sbi_integration_new_get_missing_starting",
    }),
  ).resolves.toMatchObject({
    id: "sbi_integration_new_get_missing_starting",
    title: "Missing ephemeral runtime",
    status: "failed",
    connectable: false,
    failureCode: "provider_runtime_missing",
    failureMessage: "Sandbox runtime was not found at the provider during startup inspection.",
  });

  const persisted = await env.dataPlaneDb.query.sandboxInstances.findFirst({
    columns: {
      status: true,
      failureCode: true,
      failureMessage: true,
    },
    where: (table, { eq }) => eq(table.id, "sbi_integration_new_get_missing_starting"),
  });
  expect(persisted).toEqual({
    status: SandboxInstanceStatuses.FAILED,
    failureCode: "provider_runtime_missing",
    failureMessage: "Sandbox runtime was not found at the provider during startup inspection.",
  });
});

it("treats persistent running sandbox instances as stopped when provider inspection misses the runtime", async ({
  env,
}) => {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: "sbi_integration_new_get_missing_persistent",
      organizationId: "org_integration_new_get_missing_persistent",
      sandboxProfileId: "sbp_integration_new_missing_persistent",
      persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
      status: SandboxInstanceStatuses.RUNNING,
      providerSandboxId: "integration-new-missing-persistent-runtime",
      title: "Missing persistent runtime",
    }),
  );

  await expect(
    clientFor(env).getSandboxInstance({
      organizationId: "org_integration_new_get_missing_persistent",
      instanceId: "sbi_integration_new_get_missing_persistent",
    }),
  ).resolves.toMatchObject({
    id: "sbi_integration_new_get_missing_persistent",
    title: "Missing persistent runtime",
    status: "stopped",
    connectable: false,
    failureCode: null,
    failureMessage: null,
  });

  const persisted = await env.dataPlaneDb.query.sandboxInstances.findFirst({
    columns: {
      status: true,
      providerSandboxId: true,
    },
    where: (table, { eq }) => eq(table.id, "sbi_integration_new_get_missing_persistent"),
  });
  expect(persisted).toEqual({
    status: SandboxInstanceStatuses.STOPPED,
    providerSandboxId: null,
  });
});

it("treats persistent starting sandbox instances as recoverably stopped when provider inspection misses the runtime", async ({
  env,
}) => {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: "sbi_integration_new_get_missing_starting_persistent",
      organizationId: "org_integration_new_get_missing_starting_persistent",
      sandboxProfileId: "sbp_integration_new_missing_starting_persistent",
      persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
      status: SandboxInstanceStatuses.STARTING,
      providerSandboxId: "integration-new-missing-starting-persistent-runtime",
      title: "Missing starting persistent runtime",
    }),
  );

  await expect(
    clientFor(env).getSandboxInstance({
      organizationId: "org_integration_new_get_missing_starting_persistent",
      instanceId: "sbi_integration_new_get_missing_starting_persistent",
    }),
  ).resolves.toMatchObject({
    id: "sbi_integration_new_get_missing_starting_persistent",
    title: "Missing starting persistent runtime",
    status: "stopped",
    connectable: false,
    failureCode: null,
    failureMessage: null,
  });

  const persisted = await env.dataPlaneDb.query.sandboxInstances.findFirst({
    columns: {
      status: true,
      providerSandboxId: true,
      stopReason: true,
      failureCode: true,
      failureMessage: true,
    },
    where: (table, { eq }) => eq(table.id, "sbi_integration_new_get_missing_starting_persistent"),
  });
  expect(persisted).toEqual({
    status: SandboxInstanceStatuses.STOPPED,
    providerSandboxId: null,
    stopReason: SandboxStopReasons.SYSTEM,
    failureCode: null,
    failureMessage: null,
  });
});

it("marks stopped ephemeral sandbox instances failed when provider inspection misses the runtime", async ({
  env,
}) => {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: "sbi_integration_new_get_missing_stopped_ephemeral",
      organizationId: "org_integration_new_get_missing_stopped_ephemeral",
      sandboxProfileId: "sbp_integration_new_missing_stopped_ephemeral",
      persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
      status: SandboxInstanceStatuses.STOPPED,
      providerSandboxId: "integration-new-missing-stopped-ephemeral-runtime",
      title: "Missing stopped ephemeral runtime",
    }),
  );

  await expect(
    clientFor(env).getSandboxInstance({
      organizationId: "org_integration_new_get_missing_stopped_ephemeral",
      instanceId: "sbi_integration_new_get_missing_stopped_ephemeral",
    }),
  ).resolves.toMatchObject({
    id: "sbi_integration_new_get_missing_stopped_ephemeral",
    title: "Missing stopped ephemeral runtime",
    status: "failed",
    connectable: false,
    failureCode: "provider_runtime_missing",
    failureMessage: "Sandbox runtime was not found at the provider during inspection.",
  });

  const persisted = await env.dataPlaneDb.query.sandboxInstances.findFirst({
    columns: {
      status: true,
      stopReason: true,
      failureCode: true,
      failureMessage: true,
    },
    where: (table, { eq }) => eq(table.id, "sbi_integration_new_get_missing_stopped_ephemeral"),
  });
  expect(persisted).toEqual({
    status: SandboxInstanceStatuses.FAILED,
    stopReason: SandboxStopReasons.FAILED,
    failureCode: "provider_runtime_missing",
    failureMessage: "Sandbox runtime was not found at the provider during inspection.",
  });
});

it("keeps persistent stopped sandbox instances recoverable when provider inspection misses the runtime", async ({
  env,
}) => {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values(
    sandboxInstanceRow({
      id: "sbi_integration_new_get_missing_stopped_persistent",
      organizationId: "org_integration_new_get_missing_stopped_persistent",
      sandboxProfileId: "sbp_integration_new_missing_stopped_persistent",
      persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
      status: SandboxInstanceStatuses.STOPPED,
      providerSandboxId: "integration-new-missing-stopped-persistent-runtime",
      title: "Missing stopped persistent runtime",
    }),
  );

  await expect(
    clientFor(env).getSandboxInstance({
      organizationId: "org_integration_new_get_missing_stopped_persistent",
      instanceId: "sbi_integration_new_get_missing_stopped_persistent",
    }),
  ).resolves.toMatchObject({
    id: "sbi_integration_new_get_missing_stopped_persistent",
    title: "Missing stopped persistent runtime",
    status: "stopped",
    connectable: false,
    failureCode: null,
    failureMessage: null,
  });

  const persisted = await env.dataPlaneDb.query.sandboxInstances.findFirst({
    columns: {
      status: true,
      providerSandboxId: true,
      stopReason: true,
      failureCode: true,
      failureMessage: true,
    },
    where: (table, { eq }) => eq(table.id, "sbi_integration_new_get_missing_stopped_persistent"),
  });
  expect(persisted).toEqual({
    status: SandboxInstanceStatuses.STOPPED,
    providerSandboxId: null,
    stopReason: null,
    failureCode: null,
    failureMessage: null,
  });
});

it("returns an organization-scoped paginated sandbox instance list", async ({ env }) => {
  await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstances).values([
    sandboxInstanceRow({
      id: "sbi_integration_new_list_001",
      organizationId: "org_integration_new_list_a",
      sandboxProfileId: "sbp_integration_new_list",
      title: null,
      createdAt: "2026-03-10T00:00:00.000Z",
      updatedAt: "2026-03-10T00:00:00.000Z",
    }),
    sandboxInstanceRow({
      id: "sbi_integration_new_list_002",
      organizationId: "org_integration_new_list_a",
      sandboxProfileId: "sbp_integration_new_list",
      title: "Backfill customer export",
      sandboxProfileVersion: 2,
      createdAt: "2026-03-11T00:00:00.000Z",
      updatedAt: "2026-03-11T00:00:00.000Z",
    }),
    sandboxInstanceRow({
      id: "sbi_integration_new_list_003",
      organizationId: "org_integration_new_list_a",
      sandboxProfileId: "sbp_integration_new_list",
      title: "Investigate failed webhook run",
      sandboxProfileVersion: 3,
      status: SandboxInstanceStatuses.FAILED,
      startedByKind: "system",
      startedById: "aru_integration_new_list",
      source: "webhook",
      failureCode: "SANDBOX_START_FAILED",
      failureMessage: "Sandbox failed to start.",
      createdAt: "2026-03-12T00:00:00.000Z",
      updatedAt: "2026-03-12T00:05:00.000Z",
    }),
    sandboxInstanceRow({
      id: "sbi_integration_new_list_other_org",
      organizationId: "org_integration_new_list_b",
      sandboxProfileId: "sbp_integration_new_other_org",
      title: "Other org sandbox",
      createdAt: "2026-03-13T00:00:00.000Z",
      updatedAt: "2026-03-13T00:00:00.000Z",
    }),
    sandboxInstanceRow({
      id: "sbi_integration_new_list_snapshot",
      organizationId: "org_integration_new_list_a",
      sandboxProfileId: "sbp_integration_new_snapshot",
      purpose: SandboxInstancePurposes.SNAPSHOT,
      title: "Hidden snapshot worker",
      createdAt: "2026-03-14T00:00:00.000Z",
      updatedAt: "2026-03-14T00:00:00.000Z",
    }),
    sandboxInstanceRow({
      id: "sbi_integration_new_list_deleted",
      organizationId: "org_integration_new_list_a",
      sandboxProfileId: "sbp_integration_new_deleted",
      title: "Deleted sandbox session",
      deletedAt: "2026-03-14T12:00:00.000Z",
      createdAt: "2026-03-14T12:00:00.000Z",
      updatedAt: "2026-03-14T12:00:00.000Z",
    }),
    sandboxInstanceRow({
      id: "sbi_integration_new_list_setup_check",
      organizationId: "org_integration_new_list_a",
      sandboxProfileId: "sbp_integration_new_setup_check",
      purpose: SandboxInstancePurposes.SETUP_CHECK,
      title: "Hidden setup check",
      createdAt: "2026-03-15T00:00:00.000Z",
      updatedAt: "2026-03-15T00:00:00.000Z",
    }),
  ]);

  const client = clientFor(env);
  const firstPage = await client.listSandboxInstances({
    organizationId: "org_integration_new_list_a",
    limit: 2,
  });

  expect(firstPage.totalResults).toBe(3);
  expect(firstPage.items.map((item) => item.id)).toEqual([
    "sbi_integration_new_list_003",
    "sbi_integration_new_list_002",
  ]);
  expect(firstPage.items[0]).toMatchObject({
    sandboxProfileId: "sbp_integration_new_list",
    title: "Investigate failed webhook run",
    sandboxProfileVersion: 3,
    status: "failed",
    startedBy: {
      kind: "system",
      id: "aru_integration_new_list",
    },
    source: "webhook",
    failureCode: "SANDBOX_START_FAILED",
    failureMessage: "Sandbox failed to start.",
  });
  expect(firstPage.previousPage).toBeNull();
  expect(firstPage.nextPage).not.toBeNull();

  if (firstPage.nextPage === null) {
    throw new Error("Expected next page cursor.");
  }

  const secondPage = await client.listSandboxInstances({
    organizationId: "org_integration_new_list_a",
    limit: 2,
    after: firstPage.nextPage.after,
  });

  expect(secondPage.totalResults).toBe(3);
  expect(secondPage.items.map((item) => item.id)).toEqual(["sbi_integration_new_list_001"]);
  expect(secondPage.items[0]?.title).toBeNull();
  expect(secondPage.nextPage).toBeNull();
  expect(secondPage.previousPage).not.toBeNull();
});

it("rejects invalid sandbox instance pagination cursors", async ({ env }) => {
  const response = await env.dataPlaneApi.http.fetch(
    "/internal/sandbox/instances?organizationId=org_integration_new_invalid_cursor&after=invalid!",
    {
      headers: {
        "x-mistle-service-token": "integration-new-internal-service-token",
        [TestEnvironmentIdHeader]: env.id,
      },
    },
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    code: "INVALID_PAGINATION_CURSOR",
    message: expect.stringContaining("`after` cursor"),
  });
});

it("rejects started-by list filters unless kind and id are both provided", async ({ env }) => {
  const response = await env.dataPlaneApi.http.fetch(
    "/internal/sandbox/instances?organizationId=org_integration_new_partial_started_by&startedByKind=user",
    {
      headers: {
        "x-mistle-service-token": "integration-new-internal-service-token",
        [TestEnvironmentIdHeader]: env.id,
      },
    },
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual({
    code: "VALIDATION_ERROR",
    message: "Invalid request.",
  });
});

function clientFor(env: IntegrationTestEnvironment): DataPlaneSandboxInstancesClient {
  return createDataPlaneSandboxInstancesClient({
    baseUrl: env.dataPlaneApi.hostBaseUrl,
    serviceToken: "integration-new-internal-service-token",
    testEnvironmentId: env.id,
    testEnvironmentIdHeader: TestEnvironmentIdHeader,
  });
}

type SandboxInstanceRow = DataPlaneTables["sandboxInstances"]["$inferInsert"];
type SandboxOperationEventRow = DataPlaneTables["sandboxOperationEvents"]["$inferInsert"];

function sandboxInstanceRow(
  input: Partial<SandboxInstanceRow> & {
    id: string;
    organizationId: string;
    sandboxProfileId: string;
  },
): SandboxInstanceRow {
  return {
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.id}`,
    status: SandboxInstanceStatuses.STOPPED,
    startedByKind: "user",
    startedById: "usr_integration_new_read",
    source: "dashboard",
    ...input,
  };
}

function sandboxOperationEventRow(
  input: Partial<SandboxOperationEventRow> & {
    id: string;
    operationId: string;
    sandboxInstanceId: string;
  },
): SandboxOperationEventRow {
  return {
    operationKind: SandboxOperationKinds.START,
    sequence: 1,
    recordKind: SandboxOperationEventRecordKinds.LIFECYCLE,
    observedAt: "2026-05-13T00:00:00.000Z",
    source: SandboxOperationEventSources.WORKER,
    phase: SandboxLifecyclePhases.PROVIDER,
    status: SandboxLifecycleStatuses.STARTED,
    stream: null,
    message: "Sandbox operation started.",
    attributes: {},
    ...input,
  };
}
