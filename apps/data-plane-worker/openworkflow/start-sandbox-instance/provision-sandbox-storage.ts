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

export function createArchilDiskName(input: {
  sandboxInstanceId: string;
  namePrefix?: string;
}): string {
  return `${input.namePrefix ?? ""}${input.sandboxInstanceId}`;
}

export function createArchilDiskTokenNickname(input: { sandboxInstanceId: string }): string {
  return input.sandboxInstanceId;
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
      ...(input.managedArchilConfig.mounts === undefined
        ? {}
        : input.managedArchilConfig.mounts.length === 0
          ? { mounts: [] }
          : (() => {
              const firstMount = input.managedArchilConfig.mounts[0];
              if (firstMount === undefined) {
                throw new Error("Expected managed Archil mount entry.");
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
            })()),
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
    ...(organizationStorageConfig.mounts === undefined
      ? {}
      : organizationStorageConfig.mounts.length === 0
        ? { mounts: [] }
        : (() => {
            const firstMount = organizationStorageConfig.mounts[0];
            if (firstMount === undefined) {
              throw new Error("Expected organization Archil mount entry.");
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
          })()),
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

export async function insertSandboxInstanceStorage(
  ctx: {
    db: DataPlaneDatabase;
  },
  input: InsertSandboxInstanceStorage,
): Promise<void> {
  await ctx.db
    .insert(sandboxInstanceStorages)
    .values(input)
    .onConflictDoNothing({
      target: [sandboxInstanceStorages.sandboxInstanceId],
    });
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

  const createdToken = await currentDisk.createToken(
    createArchilDiskTokenNickname({
      sandboxInstanceId: input.sandboxInstanceId,
    }),
  );

  return createdToken.token;
}

export async function provisionSandboxStorage(input: {
  db: DataPlaneDatabase;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  workerConfig: DataPlaneWorkerConfig;
  organizationId: string;
  sandboxInstanceId: string;
}): Promise<SandboxInstanceStorage> {
  return input.db.transaction(async (tx) => {
    const lockedSandboxInstances = await tx.execute<{ id: string }>(sql`
      select ${sandboxInstances.id} as id
      from ${sandboxInstances}
      where ${sandboxInstances.id} = ${input.sandboxInstanceId}
      for update
    `);

    if (lockedSandboxInstances.rows[0] === undefined) {
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

    await insertSandboxInstanceStorage(
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

    const persistedStorage = await getSandboxInstanceStorageBySandboxInstanceId(
      {
        db: tx,
      },
      {
        sandboxInstanceId: input.sandboxInstanceId,
      },
    );

    if (persistedStorage === undefined) {
      throw new Error(
        `Sandbox storage row for sandbox instance '${input.sandboxInstanceId}' was not persisted.`,
      );
    }

    return persistedStorage;
  });
}
