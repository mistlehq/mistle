/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { execFileSync } from "node:child_process";

import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxInstancePersistenceModes,
  SandboxInstancePurposes,
  SandboxStorageProviders,
  SandboxStorageStatuses,
} from "@mistle/db/data-plane";
import { SandboxProvider, SandboxStorageBackend } from "@mistle/sandbox";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import type { DataPlaneWorkerConfig } from "../openworkflow/core/config.js";
import { createSandboxStorageBackendAdapter } from "../openworkflow/shared/sandbox-storage/create-sandbox-storage-backend-adapter.js";
import { ensureSandboxInstance } from "../openworkflow/start-sandbox-instance/ensure-sandbox-instance.js";

const DockerSocketPath = "/var/run/docker.sock";
const DockerVolumeNamePrefix = "integration-new-worker-volume-";

const it = createIntegrationTest({
  services: ["data-plane-worker"],
});

describe.concurrent("data-plane worker Docker volume storage", () => {
  it("provisions a Docker volume row and reuses it on repeat calls", async ({ env }) => {
    const organizationId = "org_worker_docker_volume_provision";
    const sandboxInstanceId = typeid("sbi").toString();
    const expectedVolumeName = createDockerVolumeName(sandboxInstanceId);

    try {
      await ensurePersistentSandboxInstance({ env, organizationId, sandboxInstanceId });

      const storageBackendAdapter = createDockerVolumeStorageBackendAdapter(env);
      const provisionedStorage = await storageBackendAdapter.provision({
        organizationId,
        sandboxInstanceId,
      });

      expect(provisionedStorage).toEqual({
        backend: SandboxStorageBackend.DOCKER_VOLUME,
        handle: expectedVolumeName,
        status: "ready",
      });
      expect(volumeExists(expectedVolumeName)).toBe(true);

      const persistedStorage = await env.dataPlaneDb.query.sandboxInstanceStorages.findFirst({
        where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstanceId),
      });

      expect(persistedStorage).toMatchObject({
        sandboxInstanceId,
        provider: SandboxStorageProviders.DOCKER_VOLUME,
        handle: expectedVolumeName,
        region: null,
        status: SandboxStorageStatuses.READY,
        credentialCiphertext: null,
        credentialNonce: null,
        credentialKind: null,
        organizationCredentialKeyVersion: null,
      });

      await expect(
        storageBackendAdapter.provision({
          organizationId,
          sandboxInstanceId,
        }),
      ).resolves.toEqual(provisionedStorage);
    } finally {
      deleteVolumeIfExists(expectedVolumeName);
    }
  });

  it("deletes the Docker volume and removes the storage row", async ({ env }) => {
    const organizationId = "org_worker_docker_volume_delete";
    const sandboxInstanceId = typeid("sbi").toString();
    const expectedVolumeName = createDockerVolumeName(sandboxInstanceId);

    try {
      await ensurePersistentSandboxInstance({ env, organizationId, sandboxInstanceId });

      const storageBackendAdapter = createDockerVolumeStorageBackendAdapter(env);
      const provisionedStorage = await storageBackendAdapter.provision({
        organizationId,
        sandboxInstanceId,
      });

      expect(volumeExists(provisionedStorage.handle)).toBe(true);

      await storageBackendAdapter.deprovision({
        organizationId,
        sandboxInstanceId,
      });

      expect(volumeExists(provisionedStorage.handle)).toBe(false);
      await expect(
        env.dataPlaneDb.query.sandboxInstanceStorages.findFirst({
          where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstanceId),
        }),
      ).resolves.toBeUndefined();
    } finally {
      deleteVolumeIfExists(expectedVolumeName);
    }
  });

  it("removes the storage row when Docker volume deletion fails because the volume is already missing", async ({
    env,
  }) => {
    const organizationId = "org_worker_docker_volume_missing_delete";
    const sandboxInstanceId = typeid("sbi").toString();
    const expectedVolumeName = createDockerVolumeName(sandboxInstanceId);

    await ensurePersistentSandboxInstance({ env, organizationId, sandboxInstanceId });

    const storageBackendAdapter = createDockerVolumeStorageBackendAdapter(env);
    const provisionedStorage = await storageBackendAdapter.provision({
      organizationId,
      sandboxInstanceId,
    });

    expect(volumeExists(provisionedStorage.handle)).toBe(true);
    deleteVolumeIfExists(provisionedStorage.handle);
    expect(volumeExists(provisionedStorage.handle)).toBe(false);

    await expect(
      storageBackendAdapter.deprovision({
        organizationId,
        sandboxInstanceId,
      }),
    ).rejects.toThrow(
      `Failed to delete Docker volume sandbox storage for sandbox instance '${sandboxInstanceId}'.`,
    );

    await expect(
      env.dataPlaneDb.query.sandboxInstanceStorages.findFirst({
        where: (table, { eq }) => eq(table.sandboxInstanceId, sandboxInstanceId),
      }),
    ).resolves.toBeUndefined();

    deleteVolumeIfExists(expectedVolumeName);
  });
});

async function ensurePersistentSandboxInstance(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  sandboxInstanceId: string;
}): Promise<void> {
  await ensureSandboxInstance(
    {
      db: input.env.dataPlaneDb,
      tables: input.env.dataPlaneTables,
      sandboxRuntime: {
        provider: SandboxProvider.DOCKER,
      },
    },
    {
      sandboxInstanceId: input.sandboxInstanceId,
      organizationId: input.organizationId,
      sandboxProfileId: "sbp_worker_docker_volume",
      sandboxProfileVersion: 1,
      persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
      purpose: SandboxInstancePurposes.SESSION,
      startedBy: {
        kind: "system",
        id: "worker_docker_volume",
      },
      source: "dashboard",
    },
  );
}

function createDockerVolumeStorageBackendAdapter(env: IntegrationTestEnvironment) {
  return createSandboxStorageBackendAdapter({
    db: env.dataPlaneDb,
    tables: env.dataPlaneTables,
    controlPlaneInternalClient: new ControlPlaneInternalClient({
      baseUrl: "http://127.0.0.1:1",
      internalAuthServiceToken: "unused",
    }),
    workerConfig: createWorkerConfig(),
    runtimeProvider: SandboxProvider.DOCKER,
    storageBackend: SandboxStorageBackend.DOCKER_VOLUME,
  });
}

function createWorkerConfig(): DataPlaneWorkerConfig {
  return {
    database: {
      url: "postgresql://unused",
    },
    workflow: {
      databaseUrl: "postgresql://unused",
      namespaceId: "integration-new-worker-docker-volume",
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
      provider: "docker",
      storage: {
        backend: "docker_volume",
      },
      internalGatewayWsUrl: "ws://127.0.0.1:5003/tunnel/sandbox",
      bootstrap: {
        tokenSecret: "integration-new-bootstrap-token-secret",
        tokenIssuer: "integration-new-data-plane-worker",
        tokenAudience: "integration-new-data-plane-gateway",
      },
      docker: {
        socketPath: DockerSocketPath,
      },
    },
    sandboxStorage: {
      dockerVolume: {
        namePrefix: DockerVolumeNamePrefix,
      },
    },
    internalAuth: {
      serviceToken: "integration-new-internal-service-token",
    },
    telemetry: {
      enabled: false,
      debug: false,
    },
  };
}

function createDockerVolumeName(sandboxInstanceId: string): string {
  return `${DockerVolumeNamePrefix}${sandboxInstanceId}`;
}

function volumeExists(volumeName: string): boolean {
  try {
    execFileSync("docker", ["volume", "inspect", volumeName], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function deleteVolumeIfExists(volumeName: string): void {
  try {
    execFileSync("docker", ["volume", "rm", volumeName], {
      stdio: "ignore",
    });
  } catch {}
}
