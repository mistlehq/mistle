/* eslint-disable jest/no-standalone-expect --
 * The test cases use an extended Vitest fixture created by the test harness.
 */

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxInstancePersistenceModes,
  SandboxInstancePurposes,
  SandboxInstanceSources,
  SandboxStorageCredentialKinds,
  SandboxStorageProviders,
  SandboxStorageStatuses,
} from "@mistle/db/data-plane";
import { SandboxProvider, SandboxStorageBackend } from "@mistle/sandbox";
import {
  createIntegrationTest,
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import type { DataPlaneWorkerConfig } from "../openworkflow/core/config.js";
import { createSandboxStorageBackendAdapter } from "../openworkflow/shared/sandbox-storage/create-sandbox-storage-backend-adapter.js";
import { insertSandboxInstanceStorage } from "../openworkflow/shared/sandbox-storage/storage-persistence.js";
import { ensureSandboxInstance } from "../openworkflow/start-sandbox-instance/ensure-sandbox-instance.js";

const InternalServiceToken = "integration-new-internal-service-token";

const it = createIntegrationTest({
  services: ["control-plane-api", "data-plane-worker"],
});

describe.concurrent("data-plane worker Archil sandbox storage resolution", () => {
  it("loads ready storage metadata and resolves its disk token through control plane", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      organizationName: "Worker Storage Resolve",
    });
    const sandboxInstanceId = "sbi_storage_resolve_ready_integration_new";
    const controlPlaneInternalClient = createControlPlaneInternalClient(env);

    await ensurePersistentSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: session.organizationId,
    });
    const encryptedCredential = await controlPlaneInternalClient.encryptStorageCredential({
      organizationId: session.organizationId,
      credentialKind: "disk_token",
      plaintext: "disk-token-integration-new",
    });
    await insertReadyStorage(env, {
      sandboxInstanceId,
      encryptedCredential,
    });

    const resolvedStorage = await createArchilStorageBackendAdapter({
      env,
      controlPlaneInternalClient,
    }).resolveAttachment({
      organizationId: session.organizationId,
      sandboxInstanceId,
    });

    if (resolvedStorage.backend !== SandboxStorageBackend.ARCHIL) {
      throw new Error("Expected Archil sandbox storage attachment.");
    }

    expect(resolvedStorage).toMatchObject({
      backend: SandboxStorageBackend.ARCHIL,
      handle: "dsk-integration-new-ready",
      region: "aws-us-east-1",
      credential: "disk-token-integration-new",
    });
  });

  it("fails when no sandbox storage row exists", async ({ env }) => {
    const session = await env.auth.createSession({
      organizationName: "Worker Storage Missing Row",
    });
    const sandboxInstanceId = "sbi_storage_resolve_missing_integration_new";

    await ensurePersistentSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: session.organizationId,
    });

    await expect(
      createArchilStorageBackendAdapter({
        env,
        controlPlaneInternalClient: createControlPlaneInternalClient(env),
      }).resolveAttachment({
        organizationId: session.organizationId,
        sandboxInstanceId,
      }),
    ).rejects.toThrow(
      `Sandbox storage row for sandbox instance '${sandboxInstanceId}' was not found.`,
    );
  });

  it("fails when the sandbox storage row is not ready", async ({ env }) => {
    const session = await env.auth.createSession({
      organizationName: "Worker Storage Not Ready",
    });
    const sandboxInstanceId = "sbi_storage_resolve_failed_integration_new";
    const controlPlaneInternalClient = createControlPlaneInternalClient(env);

    await ensurePersistentSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: session.organizationId,
    });
    const encryptedCredential = await controlPlaneInternalClient.encryptStorageCredential({
      organizationId: session.organizationId,
      credentialKind: "disk_token",
      plaintext: "disk-token-failed",
    });
    await env.dataPlaneDb.insert(env.dataPlaneTables.sandboxInstanceStorages).values({
      sandboxInstanceId,
      provider: SandboxStorageProviders.ARCHIL,
      handle: "dsk-integration-new-failed",
      region: "aws-us-east-1",
      status: SandboxStorageStatuses.FAILED,
      credentialCiphertext: encryptedCredential.ciphertext,
      credentialNonce: encryptedCredential.nonce,
      credentialKind: SandboxStorageCredentialKinds.DISK_TOKEN,
      organizationCredentialKeyVersion: encryptedCredential.organizationCredentialKeyVersion,
    });

    await expect(
      createArchilStorageBackendAdapter({
        env,
        controlPlaneInternalClient,
      }).resolveAttachment({
        organizationId: session.organizationId,
        sandboxInstanceId,
      }),
    ).rejects.toThrow(
      `Sandbox storage row for sandbox instance '${sandboxInstanceId}' is not ready; found status 'failed'.`,
    );
  });

  it("propagates control-plane decrypt failures unchanged", async ({ env }) => {
    const session = await env.auth.createSession({
      organizationName: "Worker Storage Wrong Organization",
    });
    const otherSession = await env.auth.createSession({
      organizationName: "Worker Storage Other Organization",
    });
    const sandboxInstanceId = "sbi_storage_resolve_wrong_org_integration_new";
    const controlPlaneInternalClient = createControlPlaneInternalClient(env);

    await ensurePersistentSandboxInstance(env, {
      sandboxInstanceId,
      organizationId: session.organizationId,
    });
    const encryptedCredential = await controlPlaneInternalClient.encryptStorageCredential({
      organizationId: session.organizationId,
      credentialKind: "disk_token",
      plaintext: "disk-token-wrong-organization",
    });
    await insertReadyStorage(env, {
      sandboxInstanceId,
      encryptedCredential,
    });

    await expect(
      createArchilStorageBackendAdapter({
        env,
        controlPlaneInternalClient,
      }).resolveAttachment({
        organizationId: otherSession.organizationId,
        sandboxInstanceId,
      }),
    ).rejects.toThrow(
      "Control-plane internal storage credential resolve failed with status 500: Unknown control-plane internal API error.",
    );
  });
});

function createControlPlaneInternalClient(
  env: IntegrationTestEnvironment,
): ControlPlaneInternalClient {
  return new ControlPlaneInternalClient({
    baseUrl: env.controlPlaneApi.hostBaseUrl,
    internalAuthServiceToken: InternalServiceToken,
    testEnvironmentId: env.id,
    testEnvironmentIdHeader: TestEnvironmentIdHeader,
  });
}

function createArchilStorageBackendAdapter(input: {
  env: IntegrationTestEnvironment;
  controlPlaneInternalClient: ControlPlaneInternalClient;
}) {
  return createSandboxStorageBackendAdapter({
    db: input.env.dataPlaneDb,
    tables: input.env.dataPlaneTables,
    controlPlaneInternalClient: input.controlPlaneInternalClient,
    workerConfig: createWorkerConfig(),
    runtimeProvider: SandboxProvider.E2B,
    storageBackend: SandboxStorageBackend.ARCHIL,
  });
}

function createWorkerConfig(): DataPlaneWorkerConfig {
  return {
    database: {
      url: "postgresql://unused",
    },
    workflow: {
      databaseUrl: "postgresql://unused",
      namespaceId: "integration-new-worker-resolve-storage",
      runMigrations: false,
      concurrency: 1,
    },
    runtimeState: {
      gatewayBaseUrl: "http://127.0.0.1:5202",
    },
    controlPlaneApi: {
      baseUrl: "http://127.0.0.1:5100",
    },
    sandbox: {
      provider: "e2b",
      storage: {
        backend: "archil",
      },
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: {
        tokenSecret: "integration-new-bootstrap-token-secret",
        tokenIssuer: "integration-new-data-plane-worker",
        tokenAudience: "integration-new-data-plane-gateway",
      },
    },
    sandboxStorage: {
      archil: {
        apiKey: "managed-api-key",
        region: "aws-us-east-1",
      },
    },
    internalAuth: {
      serviceToken: InternalServiceToken,
    },
    telemetry: {
      enabled: false,
      debug: false,
    },
  };
}

async function ensurePersistentSandboxInstance(
  env: IntegrationTestEnvironment,
  input: {
    sandboxInstanceId: string;
    organizationId: string;
  },
): Promise<void> {
  await ensureSandboxInstance(
    {
      db: env.dataPlaneDb,
      tables: env.dataPlaneTables,
      runtimeProvider: "e2b",
    },
    {
      sandboxInstanceId: input.sandboxInstanceId,
      organizationId: input.organizationId,
      sandboxProfileId: "sbp_storage_resolve_integration_new",
      sandboxProfileVersion: 1,
      persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
      purpose: SandboxInstancePurposes.SESSION,
      startedBy: {
        kind: "system",
        id: "worker_storage_resolve_integration_new",
      },
      source: SandboxInstanceSources.DASHBOARD,
    },
  );
}

async function insertReadyStorage(
  env: IntegrationTestEnvironment,
  input: {
    sandboxInstanceId: string;
    encryptedCredential: {
      ciphertext: string;
      nonce: string;
      organizationCredentialKeyVersion: number;
    };
  },
): Promise<void> {
  await insertSandboxInstanceStorage(
    {
      db: env.dataPlaneDb,
      tables: env.dataPlaneTables,
    },
    {
      sandboxInstanceId: input.sandboxInstanceId,
      provider: SandboxStorageProviders.ARCHIL,
      handle: "dsk-integration-new-ready",
      region: "aws-us-east-1",
      status: SandboxStorageStatuses.READY,
      credentialCiphertext: input.encryptedCredential.ciphertext,
      credentialNonce: input.encryptedCredential.nonce,
      credentialKind: SandboxStorageCredentialKinds.DISK_TOKEN,
      organizationCredentialKeyVersion: input.encryptedCredential.organizationCredentialKeyVersion,
    },
  );
}
