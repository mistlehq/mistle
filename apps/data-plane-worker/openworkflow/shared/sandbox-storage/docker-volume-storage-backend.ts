import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  sandboxInstances,
  sandboxInstanceStorages,
  SandboxStorageProviders,
  SandboxStorageStatuses,
  type DataPlaneDatabase,
  type InsertSandboxInstanceStorage,
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

type ManagedDockerVolumeConfig = NonNullable<
  NonNullable<DataPlaneWorkerConfig["sandboxStorage"]>["dockerVolume"]
>;

type CompensationAction = {
  run: () => Promise<void>;
};

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

async function getSandboxInstanceStorageBySandboxInstanceId(
  ctx: {
    db: DataPlaneDatabase;
  },
  input: {
    sandboxInstanceId: string;
  },
): Promise<SandboxInstanceStorage | undefined> {
  return ctx.db.query.sandboxInstanceStorages.findFirst({
    where: (table, { eq }) => eq(table.sandboxInstanceId, input.sandboxInstanceId),
  });
}

async function insertSandboxInstanceStorage(
  ctx: {
    db: DataPlaneDatabase;
  },
  input: InsertSandboxInstanceStorage,
): Promise<SandboxInstanceStorage> {
  const insertedRows = await ctx.db
    .insert(sandboxInstanceStorages)
    .values(input)
    .onConflictDoNothing({
      target: [sandboxInstanceStorages.sandboxInstanceId],
    })
    .returning();

  const insertedRow = insertedRows[0];
  if (insertedRow === undefined) {
    throw new Error(
      `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' already exists.`,
    );
  }

  return insertedRow;
}

async function deleteSandboxInstanceStorageBySandboxInstanceId(
  ctx: {
    db: DataPlaneDatabase;
  },
  input: {
    sandboxInstanceId: string;
  },
): Promise<void> {
  const deletedRows = await ctx.db
    .delete(sandboxInstanceStorages)
    .where(eq(sandboxInstanceStorages.sandboxInstanceId, input.sandboxInstanceId))
    .returning({
      id: sandboxInstanceStorages.id,
    });

  if (deletedRows[0] === undefined) {
    throw new Error(
      `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' was not found.`,
    );
  }
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
    if (dockerConfig === undefined) {
      throw new Error("Expected Docker config to be defined in worker config.");
    }

    const dockerClient = createDockerClient(dockerConfig);
    await dockerClient.deleteVolume({
      volumeName: input.volumeName,
    });
  } catch {}
}

async function tryDeleteSandboxInstanceStorage(input: {
  db: DataPlaneDatabase;
  sandboxInstanceStorageId: string;
}): Promise<void> {
  try {
    await input.db
      .delete(sandboxInstanceStorages)
      .where(eq(sandboxInstanceStorages.id, input.sandboxInstanceStorageId));
  } catch {}
}

function registerCompensationAction(input: {
  compensationActions: CompensationAction[];
  action: CompensationAction;
}): void {
  input.compensationActions.push(input.action);
}

async function runCompensationActions(input: {
  compensationActions: readonly CompensationAction[];
}): Promise<void> {
  for (const action of [...input.compensationActions].reverse()) {
    await action.run();
  }
}

type DockerVolumeSandboxStorageBackendAdapterContext = {
  db: DataPlaneDatabase;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  workerConfig: DataPlaneWorkerConfig;
  runtimeProvider: "docker";
};

class DockerVolumeSandboxStorageBackendAdapterImpl implements SandboxStorageBackendAdapter {
  readonly #db: DataPlaneDatabase;
  readonly #workerConfig: DataPlaneWorkerConfig;

  constructor(input: DockerVolumeSandboxStorageBackendAdapterContext) {
    this.#db = input.db;
    this.#workerConfig = input.workerConfig;
  }

  async provision(input: {
    organizationId: string;
    sandboxInstanceId: string;
  }): Promise<SandboxStorageBackendRecord> {
    const compensationActions: CompensationAction[] = [];
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
        if (dockerConfig === undefined) {
          throw new Error("Expected Docker config to be defined in worker config.");
        }

        const dockerClient = createDockerClient(dockerConfig);
        const volumeName = resolveDockerVolumeName({
          managedDockerVolumeConfig: this.#workerConfig.sandboxStorage?.dockerVolume,
          sandboxInstanceId: input.sandboxInstanceId,
        });

        await dockerClient.createVolume({
          volumeName,
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

        const insertedStorage = await insertSandboxInstanceStorage(
          {
            db: tx,
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
        );

        registerCompensationAction({
          compensationActions,
          action: {
            run: async () => {
              await tryDeleteSandboxInstanceStorage({
                db: this.#db,
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
    if (dockerConfig === undefined) {
      throw new Error("Expected Docker config to be defined in worker config.");
    }

    const dockerClient = createDockerClient(dockerConfig);

    let volumeDeleteError: unknown;
    try {
      await dockerClient.deleteVolume({
        volumeName: storage.handle,
      });
    } catch (error) {
      volumeDeleteError = error;
    }

    let deleteSandboxInstanceStorageError: unknown;
    try {
      await deleteSandboxInstanceStorageBySandboxInstanceId(
        {
          db: this.#db,
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
