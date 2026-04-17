import {
  Archil,
  type CreateDiskRequest,
  type CreateDiskResult,
  type S3CompatibleMount,
} from "@archildata/client/api";
import type { ResolveStorageConfigurationOutput } from "@mistle/control-plane-internal-client";
import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxInstancePersistenceModes,
  SandboxStorageCredentialKinds,
  sandboxInstances,
  SandboxStorageProviders,
  SandboxStorageStatuses,
  type DataPlaneDatabase,
  type SandboxInstanceStorage,
} from "@mistle/db/data-plane";
import {
  SandboxPersistentStorageLayout,
  SandboxStorageBackend,
  type SandboxArchilStorageAttachment,
  type SandboxArchilStorageCleanup,
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

type ManagedArchilConfig = NonNullable<
  NonNullable<DataPlaneWorkerConfig["sandboxStorage"]>["archil"]
>;

type ArchilProvisioningMount = {
  type: "s3-compatible";
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
};

type ArchilProvisioningProfile = {
  apiKey: string;
  region: string;
  namePrefix?: string;
  mounts?: [] | [ArchilProvisioningMount];
};

type ArchilMountInput = {
  type: "s3-compatible";
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
};

type SandboxInstanceStorageValidationCandidate = Omit<
  SandboxInstanceStorage,
  "provider" | "status" | "credentialKind"
> & {
  provider: string;
  status: string;
  credentialKind: string | null;
};

type ArchilReadySandboxInstanceStorage = SandboxInstanceStorage & {
  provider: typeof SandboxStorageProviders.ARCHIL;
  status: typeof SandboxStorageStatuses.READY;
  credentialKind: typeof SandboxStorageCredentialKinds.DISK_TOKEN;
  credentialCiphertext: string;
  credentialNonce: string;
  organizationCredentialKeyVersion: number;
  region: string;
};

function isArchilReadySandboxInstanceStorage(
  storage: SandboxInstanceStorageValidationCandidate,
): storage is ArchilReadySandboxInstanceStorage {
  return (
    storage.provider === SandboxStorageProviders.ARCHIL &&
    storage.status === SandboxStorageStatuses.READY &&
    storage.credentialKind === SandboxStorageCredentialKinds.DISK_TOKEN
  );
}

function resolveArchilProvisioningMounts(input: {
  mounts: readonly ArchilMountInput[] | undefined;
}): Pick<ArchilProvisioningProfile, "mounts"> | object {
  if (input.mounts === undefined) {
    return {};
  }

  if (input.mounts.length === 0) {
    return { mounts: [] };
  }

  const firstMount = input.mounts[0];
  if (firstMount === undefined) {
    throw new Error("Expected Archil mount entry.");
  }

  return {
    mounts: [
      {
        type: firstMount.type,
        bucket: firstMount.bucket,
        endpoint: firstMount.endpoint,
        accessKeyId: firstMount.accessKeyId,
        secretAccessKey: firstMount.secretAccessKey,
      },
    ] satisfies [ArchilProvisioningMount],
  };
}

export function createArchilDiskName(input: {
  sandboxInstanceId: string;
  namePrefix?: string;
}): string {
  return `${input.namePrefix ?? ""}${input.sandboxInstanceId}`;
}

export function resolveArchilProvisioningProfile(input: {
  managedArchilConfig: ManagedArchilConfig | undefined;
  resolvedStorageConfiguration: ResolveStorageConfigurationOutput;
}): ArchilProvisioningProfile {
  if (input.resolvedStorageConfiguration.storageConfigSource === "managed") {
    if (input.managedArchilConfig === undefined) {
      throw new Error("Expected managed Archil config to be defined in data-plane worker config.");
    }

    return {
      apiKey: input.managedArchilConfig.apiKey,
      region: input.managedArchilConfig.region,
      ...(input.managedArchilConfig.namePrefix === undefined
        ? {}
        : { namePrefix: input.managedArchilConfig.namePrefix }),
      ...resolveArchilProvisioningMounts({
        mounts: input.managedArchilConfig.mounts,
      }),
    };
  }

  if (input.resolvedStorageConfiguration.storageBackend !== SandboxStorageBackend.ARCHIL) {
    throw new Error("Expected organization sandbox storage override to use the Archil backend.");
  }

  const organizationStorageConfig = input.resolvedStorageConfiguration.organizationStorageConfig;
  if (organizationStorageConfig === null) {
    throw new Error("Expected organization sandbox storage override configuration.");
  }

  return {
    apiKey: organizationStorageConfig.apiKey,
    region: organizationStorageConfig.region,
    ...(organizationStorageConfig.namePrefix === undefined
      ? {}
      : { namePrefix: organizationStorageConfig.namePrefix }),
    ...resolveArchilProvisioningMounts({
      mounts: organizationStorageConfig.mounts,
    }),
  };
}

export function createArchilDiskRequest(input: {
  sandboxInstanceId: string;
  profile: ArchilProvisioningProfile;
}): CreateDiskRequest {
  const name = createArchilDiskName({
    sandboxInstanceId: input.sandboxInstanceId,
    ...(input.profile.namePrefix === undefined ? {} : { namePrefix: input.profile.namePrefix }),
  });

  if (input.profile.mounts === undefined || input.profile.mounts.length === 0) {
    return { name };
  }

  const firstMount = input.profile.mounts[0];
  if (firstMount === undefined) {
    throw new Error("Expected Archil mount entry.");
  }

  const mount: S3CompatibleMount = {
    type: firstMount.type,
    bucketName: firstMount.bucket,
    bucketEndpoint: firstMount.endpoint,
    accessKeyId: firstMount.accessKeyId,
    secretAccessKey: firstMount.secretAccessKey,
    bucketPrefix: input.sandboxInstanceId,
  };

  return {
    name,
    mounts: [mount],
  };
}

export function requireReadyArchilSandboxStorage(input: {
  sandboxInstanceId: string;
  storage: SandboxInstanceStorageValidationCandidate | undefined;
}): ArchilReadySandboxInstanceStorage {
  if (input.storage === undefined) {
    throw new Error(
      `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' was not found.`,
    );
  }

  if (input.storage.provider !== SandboxStorageProviders.ARCHIL) {
    throw new Error(
      `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' must use provider '${SandboxStorageProviders.ARCHIL}'.`,
    );
  }

  if (input.storage.credentialKind !== SandboxStorageCredentialKinds.DISK_TOKEN) {
    throw new Error(
      `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' must use credential kind '${SandboxStorageCredentialKinds.DISK_TOKEN}'.`,
    );
  }

  if (!isArchilReadySandboxInstanceStorage(input.storage)) {
    throw new Error(
      `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' is not ready; found status '${input.storage.status}'.`,
    );
  }

  return input.storage;
}

export async function resolveSandboxStorageDiskToken(input: {
  controlPlaneInternalClient: ControlPlaneInternalClient;
  organizationId: string;
  sandboxInstanceId: string;
  runtimeProvider: "e2b";
  storage: ArchilReadySandboxInstanceStorage;
}): Promise<string> {
  const resolvedCredential = await withSandboxStorageTelemetry({
    operation: "load_and_decrypt_credential",
    telemetry: {
      sandboxInstanceId: input.sandboxInstanceId,
      organizationId: input.organizationId,
      persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
      runtimeProvider: input.runtimeProvider,
      storageBackend: SandboxStorageBackend.ARCHIL,
      region: input.storage.region,
      operation: "load_and_decrypt_credential",
    },
    providerOperation: "control_plane.resolve_storage_credential",
    fn: async () =>
      input.controlPlaneInternalClient.resolveStorageCredential({
        organizationId: input.organizationId,
        credentialKind: input.storage.credentialKind,
        ciphertext: input.storage.credentialCiphertext,
        nonce: input.storage.credentialNonce,
        organizationCredentialKeyVersion: input.storage.organizationCredentialKeyVersion,
      }),
  });

  return resolvedCredential.plaintext;
}

async function resolveArchilDiskToken(input: {
  archil: Archil;
  createdDisk: CreateDiskResult;
  sandboxInstanceId: string;
}): Promise<string> {
  if (input.createdDisk.token !== null) {
    return input.createdDisk.token;
  }

  const currentDisk = await input.archil.disks.get(input.createdDisk.disk.id);
  const existingSandboxTokenUsers = (currentDisk.authorizedUsers ?? []).filter(
    (user) => user.type === "token" && user.nickname === input.sandboxInstanceId,
  );

  for (const tokenUser of existingSandboxTokenUsers) {
    if (tokenUser.identifier === undefined) {
      continue;
    }

    await currentDisk.removeTokenUser(tokenUser.identifier);
  }

  const createdToken = await currentDisk.createToken(input.sandboxInstanceId);

  return createdToken.token;
}

async function tryDeleteArchilDisk(input: { archil: Archil; diskId: string }): Promise<void> {
  try {
    const disk = await input.archil.disks.get(input.diskId);
    await disk.delete();
  } catch {}
}

type ArchilSandboxStorageBackendAdapterContext = {
  db: DataPlaneDatabase;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  workerConfig: DataPlaneWorkerConfig;
  runtimeProvider: "e2b";
};

class ArchilSandboxStorageBackendAdapterImpl implements SandboxStorageBackendAdapter {
  readonly #db: DataPlaneDatabase;
  readonly #controlPlaneInternalClient: ControlPlaneInternalClient;
  readonly #workerConfig: DataPlaneWorkerConfig;
  readonly #runtimeProvider: "e2b";

  constructor(input: ArchilSandboxStorageBackendAdapterContext) {
    this.#db = input.db;
    this.#controlPlaneInternalClient = input.controlPlaneInternalClient;
    this.#workerConfig = input.workerConfig;
    this.#runtimeProvider = input.runtimeProvider;
  }

  async provision(input: {
    organizationId: string;
    sandboxInstanceId: string;
  }): Promise<SandboxStorageBackendRecord> {
    const compensationActions: CompensationAction[] = [];

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
            existingStorage.provider === SandboxStorageProviders.ARCHIL &&
            existingStorage.status === SandboxStorageStatuses.READY
          ) {
            return existingStorage;
          }

          throw new Error(
            `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' already exists in unsupported state '${existingStorage.status}'.`,
          );
        }

        const resolvedStorageConfiguration = await withSandboxStorageTelemetry({
          operation: "resolve_storage_profile",
          telemetry: {
            sandboxInstanceId: input.sandboxInstanceId,
            organizationId: input.organizationId,
            persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
            runtimeProvider: this.#runtimeProvider,
            storageBackend: SandboxStorageBackend.ARCHIL,
            operation: "resolve_storage_profile",
          },
          providerOperation: "control_plane.resolve_storage_configuration",
          fn: async ({ setAttributes }) => {
            const output = await this.#controlPlaneInternalClient.resolveStorageConfiguration({
              organizationId: input.organizationId,
              runtimeProvider: this.#runtimeProvider,
            });
            setAttributes({
              "mistle.sandbox.storage.config_source": output.storageConfigSource,
            });
            return output;
          },
        });

        const archilProfile = resolveArchilProvisioningProfile({
          managedArchilConfig: this.#workerConfig.sandboxStorage?.archil,
          resolvedStorageConfiguration,
        });

        const archil = new Archil({
          apiKey: archilProfile.apiKey,
          region: archilProfile.region,
        });

        const createdDisk = await withSandboxStorageTelemetry({
          operation: "provision",
          telemetry: {
            sandboxInstanceId: input.sandboxInstanceId,
            organizationId: input.organizationId,
            persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
            runtimeProvider: this.#runtimeProvider,
            storageBackend: SandboxStorageBackend.ARCHIL,
            storageConfigSource: resolvedStorageConfiguration.storageConfigSource,
            region: archilProfile.region,
            operation: "provision",
          },
          providerOperation: "archil.disks.create",
          fn: async () =>
            archil.disks.create(
              createArchilDiskRequest({
                sandboxInstanceId: input.sandboxInstanceId,
                profile: archilProfile,
              }),
            ),
        });

        registerCompensationAction({
          compensationActions,
          action: {
            run: async () => {
              await tryDeleteArchilDisk({
                archil,
                diskId: createdDisk.disk.id,
              });
            },
          },
        });

        const plaintextToken = await resolveArchilDiskToken({
          archil,
          createdDisk,
          sandboxInstanceId: input.sandboxInstanceId,
        });

        const insertedStorage = await withSandboxStorageTelemetry({
          operation: "encrypt_and_persist_credential",
          telemetry: {
            sandboxInstanceId: input.sandboxInstanceId,
            organizationId: input.organizationId,
            persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
            runtimeProvider: this.#runtimeProvider,
            storageBackend: SandboxStorageBackend.ARCHIL,
            storageConfigSource: resolvedStorageConfiguration.storageConfigSource,
            region: archilProfile.region,
            operation: "encrypt_and_persist_credential",
          },
          providerOperation: "control_plane.encrypt_storage_credential",
          fn: async () => {
            const encryptedToken = await this.#controlPlaneInternalClient.encryptStorageCredential({
              organizationId: input.organizationId,
              credentialKind: "disk_token",
              plaintext: plaintextToken,
            });

            return insertSandboxInstanceStorage(
              {
                db: tx,
              },
              {
                sandboxInstanceId: input.sandboxInstanceId,
                provider: SandboxStorageProviders.ARCHIL,
                handle: createdDisk.disk.id,
                region: archilProfile.region,
                status: SandboxStorageStatuses.READY,
                credentialCiphertext: encryptedToken.ciphertext,
                credentialNonce: encryptedToken.nonce,
                credentialKind: SandboxStorageCredentialKinds.DISK_TOKEN,
                organizationCredentialKeyVersion: encryptedToken.organizationCredentialKeyVersion,
              },
            );
          },
        });

        registerCompensationAction({
          compensationActions,
          action: {
            run: async () => {
              await tryDeleteSandboxInstanceStorageById({
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
        backend: SandboxStorageBackend.ARCHIL,
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
  }): Promise<SandboxArchilStorageAttachment> {
    const storage = requireReadyArchilSandboxStorage({
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

    const credential = await resolveSandboxStorageDiskToken({
      controlPlaneInternalClient: this.#controlPlaneInternalClient,
      organizationId: input.organizationId,
      sandboxInstanceId: input.sandboxInstanceId,
      runtimeProvider: this.#runtimeProvider,
      storage,
    });

    return {
      backend: SandboxStorageBackend.ARCHIL,
      handle: storage.handle,
      region: storage.region,
      credential,
      layout: SandboxPersistentStorageLayout,
    };
  }

  async resolveCleanup(input: { sandboxInstanceId: string }): Promise<SandboxArchilStorageCleanup> {
    const storage = requireReadyArchilSandboxStorage({
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
      backend: SandboxStorageBackend.ARCHIL,
      handle: storage.handle,
      region: storage.region,
      layout: SandboxPersistentStorageLayout,
    };
  }

  async deprovision(input: { organizationId: string; sandboxInstanceId: string }): Promise<void> {
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

    const storage = requireReadyArchilSandboxStorage({
      sandboxInstanceId: input.sandboxInstanceId,
      storage: existingStorage,
    });

    const resolvedStorageConfiguration = await withSandboxStorageTelemetry({
      operation: "resolve_storage_profile",
      telemetry: {
        sandboxInstanceId: input.sandboxInstanceId,
        organizationId: input.organizationId,
        persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
        runtimeProvider: this.#runtimeProvider,
        storageBackend: SandboxStorageBackend.ARCHIL,
        region: storage.region,
        operation: "resolve_storage_profile",
      },
      providerOperation: "control_plane.resolve_storage_configuration",
      fn: async ({ setAttributes }) => {
        const output = await this.#controlPlaneInternalClient.resolveStorageConfiguration({
          organizationId: input.organizationId,
          runtimeProvider: this.#runtimeProvider,
        });
        setAttributes({
          "mistle.sandbox.storage.config_source": output.storageConfigSource,
        });
        return output;
      },
    });

    const archilProfile = resolveArchilProvisioningProfile({
      managedArchilConfig: this.#workerConfig.sandboxStorage?.archil,
      resolvedStorageConfiguration,
    });

    const archil = new Archil({
      apiKey: archilProfile.apiKey,
      region: storage.region,
    });

    let diskDeleteError: unknown;
    try {
      await withSandboxStorageTelemetry({
        operation: "deprovision",
        telemetry: {
          sandboxInstanceId: input.sandboxInstanceId,
          organizationId: input.organizationId,
          persistenceMode: SandboxInstancePersistenceModes.PERSISTENT,
          runtimeProvider: this.#runtimeProvider,
          storageBackend: SandboxStorageBackend.ARCHIL,
          storageConfigSource: resolvedStorageConfiguration.storageConfigSource,
          region: storage.region,
          operation: "deprovision",
        },
        providerOperation: "archil.disks.delete",
        fn: async () => {
          const disk = await archil.disks.get(storage.handle);
          await disk.delete();
        },
      });
    } catch (error) {
      diskDeleteError = error;
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

    if (diskDeleteError !== undefined && deleteSandboxInstanceStorageError !== undefined) {
      throw new Error(
        `Failed to delete Archil sandbox storage disk and failed to delete sandbox storage row for sandbox instance '${input.sandboxInstanceId}'.`,
        {
          cause: {
            diskDeleteError,
            deleteSandboxInstanceStorageError,
          },
        },
      );
    }

    if (diskDeleteError !== undefined) {
      throw new Error(
        `Failed to delete Archil sandbox storage disk for sandbox instance '${input.sandboxInstanceId}'.`,
        {
          cause: diskDeleteError,
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

export function createArchilSandboxStorageBackendAdapter(
  input: ArchilSandboxStorageBackendAdapterContext,
): SandboxStorageBackendAdapter {
  return new ArchilSandboxStorageBackendAdapterImpl(input);
}
