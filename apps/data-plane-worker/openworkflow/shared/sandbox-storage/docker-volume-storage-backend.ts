import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxInstancePersistenceModes,
  SandboxStorageProviders,
  SandboxStorageStatuses,
  type DataPlaneDatabase,
  type DataPlaneTables,
  type SandboxInstanceStorage,
} from "@mistle/db/data-plane";
import {
  createDockerClient,
  SandboxPersistentStorageLayout,
  SandboxStorageBackend,
  type SandboxDockerVolumeStorageAttachment,
} from "@mistle/sandbox";
import { eq } from "drizzle-orm";

import type { DataPlaneWorkerConfig } from "../../core/config.js";
import type { SandboxStorageBackendAdapter, SandboxStorageBackendRecord } from "./backend.js";
import {
  deleteSandboxInstanceStorageBySandboxInstanceId,
  getSandboxInstanceStorageBySandboxInstanceId,
  insertSandboxInstanceStorage,
  registerCompensationAction,
  runCompensationActions,
  tryDeleteSandboxInstanceStorageById,
  type CompensationAction,
} from "./storage-persistence.js";
import { withSandboxStorageTelemetry } from "./telemetry.js";

type ManagedDockerVolumeConfig = NonNullable<
  NonNullable<DataPlaneWorkerConfig["sandboxStorage"]>["dockerVolume"]
>;
type EnabledWorkerDockerConfig = Extract<
  NonNullable<DataPlaneWorkerConfig["sandbox"]["docker"]>,
  { enabled: true }
>;

type DockerVolumeReadySandboxInstanceStorage = SandboxInstanceStorage & {
  provider: typeof SandboxStorageProviders.DOCKER_VOLUME;
  status: typeof SandboxStorageStatuses.READY;
  region: null;
  credentialCiphertext: null;
  credentialNonce: null;
  credentialKind: null;
  organizationCredentialKeyVersion: null;
};

function isReadyDockerVolumeSandboxStorage(
  storage: SandboxInstanceStorage,
): storage is DockerVolumeReadySandboxInstanceStorage {
  return (
    storage.provider === SandboxStorageProviders.DOCKER_VOLUME &&
    storage.status === SandboxStorageStatuses.READY &&
    storage.region === null &&
    storage.credentialCiphertext === null &&
    storage.credentialNonce === null &&
    storage.credentialKind === null &&
    storage.organizationCredentialKeyVersion === null
  );
}

function createDockerVolumeName(input: { sandboxInstanceId: string; namePrefix?: string }): string {
  return `${input.namePrefix ?? ""}${input.sandboxInstanceId}`;
}

function resolveDockerVolumeName(input: {
  managedDockerVolumeConfig: ManagedDockerVolumeConfig | undefined;
  sandboxInstanceId: string;
}): string {
  return createDockerVolumeName({
    sandboxInstanceId: input.sandboxInstanceId,
    ...(input.managedDockerVolumeConfig?.namePrefix === undefined
      ? {}
      : {
          namePrefix: input.managedDockerVolumeConfig.namePrefix,
        }),
  });
}

function toDockerSandboxConfig(config: EnabledWorkerDockerConfig) {
  return {
    socketPath: config.socketPath,
    ...(config.networkName === undefined ? {} : { networkName: config.networkName }),
  };
}

function requireReadyDockerVolumeSandboxStorage(input: {
  sandboxInstanceId: string;
  storage: SandboxInstanceStorage | undefined;
}): DockerVolumeReadySandboxInstanceStorage {
  if (input.storage === undefined) {
    throw new Error(
      `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' was not found.`,
    );
  }

  if (input.storage.provider !== SandboxStorageProviders.DOCKER_VOLUME) {
    throw new Error(
      `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' must use provider '${SandboxStorageProviders.DOCKER_VOLUME}'.`,
    );
  }

  if (input.storage.status !== SandboxStorageStatuses.READY) {
    throw new Error(
      `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' is not ready; found status '${input.storage.status}'.`,
    );
  }

  if (!isReadyDockerVolumeSandboxStorage(input.storage)) {
    throw new Error(
      `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' is not a Docker volume storage row.`,
    );
  }

  return input.storage;
}

async function tryDeleteDockerVolume(input: {
  workerConfig: DataPlaneWorkerConfig;
  volumeName: string;
}): Promise<void> {
  try {
    const dockerConfig = input.workerConfig.sandbox.docker;
    if (dockerConfig?.enabled !== true) {
      throw new Error("Expected Docker config to be defined in worker config.");
    }

    const dockerClient = createDockerClient(toDockerSandboxConfig(dockerConfig));
    await dockerClient.deleteVolume({
      volumeName: input.volumeName,
    });
  } catch {}
}

type DockerVolumeSandboxStorageBackendAdapterContext = {
  db: DataPlaneDatabase;
  tables: Pick<DataPlaneTables, "sandboxInstanceStorages" | "sandboxInstances">;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  workerConfig: DataPlaneWorkerConfig;
  runtimeProvider: "docker";
};

class DockerVolumeSandboxStorageBackendAdapterImpl implements SandboxStorageBackendAdapter {
  readonly #db: DataPlaneDatabase;
  readonly #tables: Pick<DataPlaneTables, "sandboxInstanceStorages" | "sandboxInstances">;
  readonly #workerConfig: DataPlaneWorkerConfig;

  constructor(input: DockerVolumeSandboxStorageBackendAdapterContext) {
    this.#db = input.db;
    this.#tables = input.tables;
    this.#workerConfig = input.workerConfig;
  }

  async provision(input: {
    organizationId: string;
    sandboxInstanceId: string;
  }): Promise<SandboxStorageBackendRecord> {
    const compensationActions: CompensationAction[] = [];
    const { sandboxInstances } = this.#tables;
    void input.organizationId;

    try {
      const provisionedStorage = await this.#db.transaction(async (tx) => {
        const [lockedSandboxInstance] = await tx
          .select({
            id: sandboxInstances.id,
          })
          .from(sandboxInstances)
          .where(eq(sandboxInstances.id, input.sandboxInstanceId))
          .limit(1)
          .for("update");

        if (lockedSandboxInstance === undefined) {
          throw new Error(
            `Sandbox instance '${input.sandboxInstanceId}' was not found before storage provisioning.`,
          );
        }

        const existingStorage = await getSandboxInstanceStorageBySandboxInstanceId(
          {
            db: tx,
          },
          {
            sandboxInstanceId: input.sandboxInstanceId,
          },
        );

        if (existingStorage !== undefined) {
          if (
            existingStorage.provider === SandboxStorageProviders.DOCKER_VOLUME &&
            existingStorage.status === SandboxStorageStatuses.READY
          ) {
            return requireReadyDockerVolumeSandboxStorage({
              sandboxInstanceId: input.sandboxInstanceId,
              storage: existingStorage,
            });
          }

          throw new Error(
            `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' already exists in unsupported state '${existingStorage.status}'.`,
          );
        }

        const dockerConfig = this.#workerConfig.sandbox.docker;
        if (dockerConfig?.enabled !== true) {
          throw new Error("Expected Docker config to be defined in worker config.");
        }

        const dockerClient = createDockerClient(toDockerSandboxConfig(dockerConfig));
        const volumeName = resolveDockerVolumeName({
          managedDockerVolumeConfig: this.#workerConfig.sandboxStorage?.dockerVolume,
          sandboxInstanceId: input.sandboxInstanceId,
        });

        await withSandboxStorageTelemetry({
          operation: "provision",
          telemetry: {
            sandboxInstanceId: input.sandboxInstanceId,
            organizationId: input.organizationId,
            persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
            runtimeProvider: "docker",
            storageBackend: SandboxStorageBackend.DOCKER_VOLUME,
            operation: "provision",
          },
          providerOperation: "docker.volumes.create",
          fn: async () =>
            dockerClient.createVolume({
              volumeName,
            }),
        });

        registerCompensationAction({
          compensationActions,
          action: {
            run: async () => {
              await tryDeleteDockerVolume({
                workerConfig: this.#workerConfig,
                volumeName,
              });
            },
          },
        });

        const insertedStorage = await withSandboxStorageTelemetry({
          operation: "persist_storage_record",
          telemetry: {
            sandboxInstanceId: input.sandboxInstanceId,
            organizationId: input.organizationId,
            persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
            runtimeProvider: "docker",
            storageBackend: SandboxStorageBackend.DOCKER_VOLUME,
            operation: "persist_storage_record",
          },
          fn: async () =>
            insertSandboxInstanceStorage(
              {
                db: tx,
                tables: this.#tables,
              },
              {
                sandboxInstanceId: input.sandboxInstanceId,
                provider: SandboxStorageProviders.DOCKER_VOLUME,
                handle: volumeName,
                region: null,
                status: SandboxStorageStatuses.READY,
                credentialCiphertext: null,
                credentialNonce: null,
                credentialKind: null,
                organizationCredentialKeyVersion: null,
              },
            ),
        });

        registerCompensationAction({
          compensationActions,
          action: {
            run: async () => {
              await tryDeleteSandboxInstanceStorageById({
                db: this.#db,
                tables: this.#tables,
                sandboxInstanceStorageId: insertedStorage.id,
              });
            },
          },
        });

        return insertedStorage;
      });

      compensationActions.length = 0;
      return {
        backend: SandboxStorageBackend.DOCKER_VOLUME,
        handle: provisionedStorage.handle,
        status: "ready",
      };
    } catch (error) {
      await runCompensationActions({
        compensationActions,
      });
      throw error;
    }
  }

  async resolveAttachment(input: {
    organizationId: string;
    sandboxInstanceId: string;
  }): Promise<SandboxDockerVolumeStorageAttachment> {
    void input.organizationId;

    const storage = requireReadyDockerVolumeSandboxStorage({
      sandboxInstanceId: input.sandboxInstanceId,
      storage: await getSandboxInstanceStorageBySandboxInstanceId(
        {
          db: this.#db,
        },
        {
          sandboxInstanceId: input.sandboxInstanceId,
        },
      ),
    });

    return {
      backend: SandboxStorageBackend.DOCKER_VOLUME,
      handle: storage.handle,
      layout: SandboxPersistentStorageLayout,
    };
  }

  async resolveCleanup(input: {
    sandboxInstanceId: string;
  }): Promise<SandboxDockerVolumeStorageAttachment> {
    const storage = requireReadyDockerVolumeSandboxStorage({
      sandboxInstanceId: input.sandboxInstanceId,
      storage: await getSandboxInstanceStorageBySandboxInstanceId(
        {
          db: this.#db,
        },
        {
          sandboxInstanceId: input.sandboxInstanceId,
        },
      ),
    });

    return {
      backend: SandboxStorageBackend.DOCKER_VOLUME,
      handle: storage.handle,
      layout: SandboxPersistentStorageLayout,
    };
  }

  async deprovision(input: { organizationId: string; sandboxInstanceId: string }): Promise<void> {
    void input.organizationId;

    const existingStorage = await getSandboxInstanceStorageBySandboxInstanceId(
      {
        db: this.#db,
      },
      {
        sandboxInstanceId: input.sandboxInstanceId,
      },
    );

    if (existingStorage === undefined) {
      return;
    }

    const storage = requireReadyDockerVolumeSandboxStorage({
      sandboxInstanceId: input.sandboxInstanceId,
      storage: existingStorage,
    });

    const dockerConfig = this.#workerConfig.sandbox.docker;
    if (dockerConfig?.enabled !== true) {
      throw new Error("Expected Docker config to be defined in worker config.");
    }

    const dockerClient = createDockerClient(toDockerSandboxConfig(dockerConfig));

    let volumeDeleteError: unknown;
    try {
      await withSandboxStorageTelemetry({
        operation: "deprovision",
        telemetry: {
          sandboxInstanceId: input.sandboxInstanceId,
          organizationId: input.organizationId,
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          runtimeProvider: "docker",
          storageBackend: SandboxStorageBackend.DOCKER_VOLUME,
          operation: "deprovision",
        },
        providerOperation: "docker.volumes.delete",
        fn: async () =>
          dockerClient.deleteVolume({
            volumeName: storage.handle,
          }),
      });
    } catch (error) {
      volumeDeleteError = error;
    }

    let deleteSandboxInstanceStorageError: unknown;
    try {
      await deleteSandboxInstanceStorageBySandboxInstanceId(
        {
          db: this.#db,
          tables: this.#tables,
        },
        {
          sandboxInstanceId: input.sandboxInstanceId,
        },
      );
    } catch (error) {
      deleteSandboxInstanceStorageError = error;
    }

    if (volumeDeleteError !== undefined && deleteSandboxInstanceStorageError !== undefined) {
      throw new Error(
        `Failed to delete Docker volume sandbox storage and failed to delete sandbox storage row for sandbox instance '${input.sandboxInstanceId}'.`,
        {
          cause: {
            volumeDeleteError,
            deleteSandboxInstanceStorageError,
          },
        },
      );
    }

    if (volumeDeleteError !== undefined) {
      throw new Error(
        `Failed to delete Docker volume sandbox storage for sandbox instance '${input.sandboxInstanceId}'.`,
        {
          cause: volumeDeleteError,
        },
      );
    }

    if (deleteSandboxInstanceStorageError !== undefined) {
      throw new Error(
        `Failed to delete sandbox storage row for sandbox instance '${input.sandboxInstanceId}'.`,
        {
          cause: deleteSandboxInstanceStorageError,
        },
      );
    }
  }
}

export function createDockerVolumeSandboxStorageBackendAdapter(
  input: DockerVolumeSandboxStorageBackendAdapterContext,
): SandboxStorageBackendAdapter {
  return new DockerVolumeSandboxStorageBackendAdapterImpl(input);
}

export { createDockerVolumeName, requireReadyDockerVolumeSandboxStorage };
