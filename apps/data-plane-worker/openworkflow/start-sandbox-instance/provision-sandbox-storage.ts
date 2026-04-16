import {
  Archil,
  type CreateDiskRequest,
  type CreateDiskResult,
  type S3CompatibleMount,
} from "@archildata/client/api";
import type { ResolveStorageConfigurationOutput } from "@mistle/control-plane-internal-client";
import { type ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  SandboxStorageCredentialKinds,
  sandboxInstances,
  sandboxInstanceStorages,
  SandboxStorageProviders,
  SandboxStorageStatuses,
  type DataPlaneDatabase,
  type InsertSandboxInstanceStorage,
  type SandboxInstanceStorage,
} from "@mistle/db/data-plane";
import { eq, sql } from "drizzle-orm";

import type { DataPlaneWorkerConfig } from "../core/config.js";

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

type CompensationAction = {
  run: () => Promise<void>;
};

type SandboxInstanceStorageValidationCandidate = Omit<
  SandboxInstanceStorage,
  "provider" | "status" | "credentialKind"
> & {
  provider: string;
  status: string;
  credentialKind: string;
};

type ArchilReadySandboxInstanceStorage = SandboxInstanceStorage & {
  provider: typeof SandboxStorageProviders.ARCHIL;
  status: typeof SandboxStorageStatuses.READY;
  credentialKind: typeof SandboxStorageCredentialKinds.DISK_TOKEN;
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

  if (input.resolvedStorageConfiguration.storageBackend !== "archil") {
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

export async function getSandboxInstanceStorageBySandboxInstanceId(
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
  storage: ArchilReadySandboxInstanceStorage;
}): Promise<string> {
  const resolvedCredential = await input.controlPlaneInternalClient.resolveStorageCredential({
    organizationId: input.organizationId,
    credentialKind: input.storage.credentialKind,
    ciphertext: input.storage.credentialCiphertext,
    nonce: input.storage.credentialNonce,
    organizationCredentialKeyVersion: input.storage.organizationCredentialKeyVersion,
  });

  return resolvedCredential.plaintext;
}

export async function resolveReadyArchilSandboxStorage(input: {
  db: DataPlaneDatabase;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  organizationId: string;
  sandboxInstanceId: string;
}): Promise<{
  storage: ArchilReadySandboxInstanceStorage;
  diskToken: string;
}> {
  const storage = requireReadyArchilSandboxStorage({
    sandboxInstanceId: input.sandboxInstanceId,
    storage: await getSandboxInstanceStorageBySandboxInstanceId(
      {
        db: input.db,
      },
      {
        sandboxInstanceId: input.sandboxInstanceId,
      },
    ),
  });

  const diskToken = await resolveSandboxStorageDiskToken({
    controlPlaneInternalClient: input.controlPlaneInternalClient,
    organizationId: input.organizationId,
    storage,
  });

  return {
    storage,
    diskToken,
  };
}

export async function insertSandboxInstanceStorage(
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

export async function updateSandboxInstanceStorageCredential(
  ctx: {
    db: DataPlaneDatabase;
  },
  input: {
    sandboxInstanceId: string;
    status: SandboxInstanceStorage["status"];
    credentialCiphertext: string;
    credentialNonce: string;
    organizationCredentialKeyVersion: number;
    credentialKind: SandboxInstanceStorage["credentialKind"];
  },
): Promise<void> {
  const updatedRows = await ctx.db
    .update(sandboxInstanceStorages)
    .set({
      status: input.status,
      credentialCiphertext: input.credentialCiphertext,
      credentialNonce: input.credentialNonce,
      organizationCredentialKeyVersion: input.organizationCredentialKeyVersion,
      credentialKind: input.credentialKind,
      updatedAt: sql`now()`,
    })
    .where(eq(sandboxInstanceStorages.sandboxInstanceId, input.sandboxInstanceId))
    .returning({
      id: sandboxInstanceStorages.id,
    });

  if (updatedRows[0] === undefined) {
    throw new Error(
      `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' was not found.`,
    );
  }
}

export async function deleteSandboxInstanceStorageBySandboxInstanceId(
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

export async function provisionSandboxStorage(input: {
  db: DataPlaneDatabase;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  workerConfig: DataPlaneWorkerConfig;
  organizationId: string;
  sandboxInstanceId: string;
}): Promise<SandboxInstanceStorage> {
  const compensationActions: CompensationAction[] = [];

  try {
    const provisionedStorage = await input.db.transaction(async (tx) => {
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

      const resolvedStorageConfiguration =
        await input.controlPlaneInternalClient.resolveStorageConfiguration({
          organizationId: input.organizationId,
        });

      const archilProfile = resolveArchilProvisioningProfile({
        managedArchilConfig: input.workerConfig.sandboxStorage?.archil,
        resolvedStorageConfiguration,
      });

      const archil = new Archil({
        apiKey: archilProfile.apiKey,
        region: archilProfile.region,
      });

      const createdDisk = await archil.disks.create(
        createArchilDiskRequest({
          sandboxInstanceId: input.sandboxInstanceId,
          profile: archilProfile,
        }),
      );

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

      const encryptedToken = await input.controlPlaneInternalClient.encryptStorageCredential({
        organizationId: input.organizationId,
        credentialKind: "disk_token",
        plaintext: plaintextToken,
      });

      const insertedStorage = await insertSandboxInstanceStorage(
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

      registerCompensationAction({
        compensationActions,
        action: {
          run: async () => {
            await tryDeleteSandboxInstanceStorage({
              db: input.db,
              sandboxInstanceStorageId: insertedStorage.id,
            });
          },
        },
      });

      return insertedStorage;
    });

    compensationActions.length = 0;
    return provisionedStorage;
  } catch (error) {
    await runCompensationActions({
      compensationActions,
    });
    throw error;
  }
}
