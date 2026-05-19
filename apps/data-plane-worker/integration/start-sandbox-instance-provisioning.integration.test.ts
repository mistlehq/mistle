/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import {
  SandboxInstancePersistenceModes,
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxInstanceStatuses,
  SandboxStorageCredentialKinds,
  SandboxStorageProviders,
  SandboxStorageStatuses,
} from "@mistle/db/data-plane";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import type { StartSandboxInstanceWorkflowInput } from "@mistle/workflow-registry/data-plane";
import { eq } from "drizzle-orm";
import { describe, expect } from "vitest";

import {
  getSandboxInstanceStorageBySandboxInstanceId,
  insertSandboxInstanceStorage,
  updateSandboxInstanceStorageCredential,
} from "../openworkflow/shared/sandbox-storage/storage-persistence.js";
import { ensureSandboxInstance } from "../openworkflow/start-sandbox-instance/ensure-sandbox-instance.js";
import { markSandboxInstanceRunning } from "../openworkflow/start-sandbox-instance/mark-sandbox-instance-running.js";
import { persistSandboxInstanceProvisioning } from "../openworkflow/start-sandbox-instance/persist-sandbox-instance-provisioning.js";

const it = createIntegrationTest({
  services: ["data-plane-worker"],
});

describe.concurrent("data-plane worker start sandbox instance provisioning", () => {
  it("persists provider sandbox metadata and the compiled runtime plan", async ({ env }) => {
    const sandboxInstanceId = "sbi_start_provisioning_integration_new";

    await ensureEphemeralSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: "org_start_provisioning_integration_new",
      sandboxProfileId: "sbp_start_provisioning_integration_new",
      sandboxProfileVersion: 3,
    });

    const persistedStartingInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        id: true,
        persistenceMode: true,
        purpose: true,
        status: true,
      },
      where: (table, { eq }) => eq(table.id, sandboxInstanceId),
    });

    expect(persistedStartingInstance).toEqual({
      id: sandboxInstanceId,
      persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
      purpose: SandboxInstancePurposes.SESSION,
      status: SandboxInstanceStatuses.PENDING,
    });

    await persistSandboxInstanceProvisioning(
      {
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
      },
      {
        sandboxInstanceId,
        runtimePlan: createRuntimePlan({
          sandboxProfileId: "sbp_start_provisioning_integration_new",
          version: 3,
        }),
        sandboxProfileId: "sbp_start_provisioning_integration_new",
        sandboxProfileVersion: 3,
        providerSandboxId: "provider-runtime-start-provisioning-new",
      },
    );

    const persistedProvisionedInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        id: true,
        status: true,
        providerSandboxId: true,
      },
      where: (table, { eq }) => eq(table.id, sandboxInstanceId),
    });

    expect(persistedProvisionedInstance).toEqual({
      id: sandboxInstanceId,
      status: SandboxInstanceStatuses.STARTING,
      providerSandboxId: "provider-runtime-start-provisioning-new",
    });

    const persistedRuntimePlans = await env.dataPlaneDb.query.sandboxInstanceRuntimePlans.findMany({
      columns: {
        sandboxInstanceId: true,
        revision: true,
        compiledFromProfileId: true,
        compiledFromProfileVersion: true,
      },
      where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstanceId),
    });

    expect(persistedRuntimePlans).toEqual([
      {
        sandboxInstanceId,
        revision: 1,
        compiledFromProfileId: "sbp_start_provisioning_integration_new",
        compiledFromProfileVersion: 3,
      },
    ]);
  });

  it("does not persist provider metadata for a deleted pending session", async ({ env }) => {
    const sandboxInstanceId = "sbi_start_provisioning_deleted_pending_new";

    await ensureEphemeralSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: "org_start_provisioning_deleted_pending_new",
      sandboxProfileId: "sbp_start_provisioning_deleted_pending_new",
      sandboxProfileVersion: 1,
    });
    await env.dataPlaneDb
      .update(env.dataPlaneTables.sandboxInstances)
      .set({
        deletedAt: "2026-05-19T00:00:00.000Z",
      })
      .where(eq(env.dataPlaneTables.sandboxInstances.id, sandboxInstanceId));

    await expect(
      persistSandboxInstanceProvisioning(
        {
          db: env.dataPlaneDb,
          tables: env.dataPlaneTables,
        },
        {
          sandboxInstanceId,
          runtimePlan: createRuntimePlan({
            sandboxProfileId: "sbp_start_provisioning_deleted_pending_new",
            version: 1,
          }),
          sandboxProfileId: "sbp_start_provisioning_deleted_pending_new",
          sandboxProfileVersion: 1,
          providerSandboxId: "provider-runtime-deleted-pending-new",
        },
      ),
    ).rejects.toThrow(
      "Failed to persist provider sandbox id while sandbox instance was still pending.",
    );

    const persistedDeletedInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        providerSandboxId: true,
        status: true,
      },
      where: (table, { eq }) => eq(table.id, sandboxInstanceId),
    });
    expect(persistedDeletedInstance).toEqual({
      providerSandboxId: null,
      status: SandboxInstanceStatuses.PENDING,
    });
  });

  it("does not mark a deleted starting session as running", async ({ env }) => {
    const sandboxInstanceId = "sbi_start_provisioning_deleted_starting_new";

    await ensureEphemeralSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: "org_start_provisioning_deleted_starting_new",
      sandboxProfileId: "sbp_start_provisioning_deleted_starting_new",
      sandboxProfileVersion: 1,
    });
    await persistSandboxInstanceProvisioning(
      {
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
      },
      {
        sandboxInstanceId,
        runtimePlan: createRuntimePlan({
          sandboxProfileId: "sbp_start_provisioning_deleted_starting_new",
          version: 1,
        }),
        sandboxProfileId: "sbp_start_provisioning_deleted_starting_new",
        sandboxProfileVersion: 1,
        providerSandboxId: "provider-runtime-deleted-starting-new",
      },
    );
    await env.dataPlaneDb
      .update(env.dataPlaneTables.sandboxInstances)
      .set({
        deletedAt: "2026-05-19T00:00:00.000Z",
      })
      .where(eq(env.dataPlaneTables.sandboxInstances.id, sandboxInstanceId));

    await expect(
      markSandboxInstanceRunning(
        {
          db: env.dataPlaneDb,
          tables: env.dataPlaneTables,
        },
        {
          sandboxInstanceId,
        },
      ),
    ).rejects.toThrow("Failed to transition sandbox instance status from starting to running.");

    const persistedDeletedInstance = await env.dataPlaneDb.query.sandboxInstances.findFirst({
      columns: {
        providerSandboxId: true,
        status: true,
      },
      where: (table, { eq }) => eq(table.id, sandboxInstanceId),
    });
    expect(persistedDeletedInstance).toEqual({
      providerSandboxId: "provider-runtime-deleted-starting-new",
      status: SandboxInstanceStatuses.STARTING,
    });
  });

  it("persists and updates sandbox storage metadata", async ({ env }) => {
    const sandboxInstanceId = "sbi_start_storage_provisioning_integration_new";

    await ensurePersistentSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: "org_start_storage_provisioning_integration_new",
      sandboxProfileId: "sbp_start_storage_provisioning_integration_new",
      sandboxProfileVersion: 1,
    });

    await insertSandboxInstanceStorage(
      {
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
      },
      {
        sandboxInstanceId,
        provider: SandboxStorageProviders.ARCHIL,
        handle: "dsk-0123456789abcdef",
        region: "aws-us-east-1",
        status: SandboxStorageStatuses.READY,
        credentialCiphertext: "ciphertext-v1",
        credentialNonce: "nonce-v1",
        credentialKind: SandboxStorageCredentialKinds.DISK_TOKEN,
        organizationCredentialKeyVersion: 1,
      },
    );

    const insertedStorage = await getSandboxInstanceStorageBySandboxInstanceId(
      {
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
      },
      {
        sandboxInstanceId,
      },
    );

    expect(insertedStorage).toMatchObject({
      sandboxInstanceId,
      provider: SandboxStorageProviders.ARCHIL,
      handle: "dsk-0123456789abcdef",
      region: "aws-us-east-1",
      status: SandboxStorageStatuses.READY,
      credentialCiphertext: "ciphertext-v1",
      credentialNonce: "nonce-v1",
      credentialKind: SandboxStorageCredentialKinds.DISK_TOKEN,
      organizationCredentialKeyVersion: 1,
    });

    await updateSandboxInstanceStorageCredential(
      {
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
      },
      {
        sandboxInstanceId,
        status: SandboxStorageStatuses.FAILED,
        credentialCiphertext: "ciphertext-v2",
        credentialNonce: "nonce-v2",
        credentialKind: SandboxStorageCredentialKinds.DISK_TOKEN,
        organizationCredentialKeyVersion: 2,
      },
    );

    const updatedStorage = await getSandboxInstanceStorageBySandboxInstanceId(
      {
        db: env.dataPlaneDb,
        tables: env.dataPlaneTables,
      },
      {
        sandboxInstanceId,
      },
    );

    expect(updatedStorage).toMatchObject({
      sandboxInstanceId,
      provider: SandboxStorageProviders.ARCHIL,
      handle: "dsk-0123456789abcdef",
      region: "aws-us-east-1",
      status: SandboxStorageStatuses.FAILED,
      credentialCiphertext: "ciphertext-v2",
      credentialNonce: "nonce-v2",
      credentialKind: SandboxStorageCredentialKinds.DISK_TOKEN,
      organizationCredentialKeyVersion: 2,
    });
  });
});

function createRuntimePlan(input: {
  sandboxProfileId: string;
  version: number;
}): StartSandboxInstanceWorkflowInput["runtimePlan"] {
  return {
    sandboxProfileId: input.sandboxProfileId,
    version: input.version,
    image: {
      source: "base",
      imageRef: "registry:1",
    },
    egressRoutes: [],
    artifacts: [],
    runtimeClients: [],
    workspaceSources: [],
    agentRuntimes: [],
  };
}

async function ensureEphemeralSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    sandboxInstanceId: string;
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
  },
): Promise<void> {
  await ensureSandboxInstance(
    {
      db: env.dataPlaneDb,
      tables: env.dataPlaneTables,
      sandboxRuntime: {
        provider: "docker",
      },
    },
    {
      ...input,
      persistenceMode: SandboxInstancePersistenceModes.EPHEMERAL,
      purpose: SandboxInstancePurposes.SESSION,
      startedBy: {
        kind: "system",
        id: "worker_start_provisioning_integration_new",
      },
      source: SandboxInstanceSources.DASHBOARD,
    },
  );
}

async function ensurePersistentSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    sandboxInstanceId: string;
    organizationId: string;
    sandboxProfileId: string;
    sandboxProfileVersion: number;
  },
): Promise<void> {
  await ensureSandboxInstance(
    {
      db: env.dataPlaneDb,
      tables: env.dataPlaneTables,
      sandboxRuntime: {
        provider: "docker",
      },
    },
    {
      ...input,
      persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
      purpose: SandboxInstancePurposes.SESSION,
      startedBy: {
        kind: "system",
        id: "worker_start_storage_provisioning_integration_new",
      },
      source: SandboxInstanceSources.DASHBOARD,
    },
  );
}
