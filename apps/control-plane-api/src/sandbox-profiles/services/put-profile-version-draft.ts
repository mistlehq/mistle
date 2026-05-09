import {
  getControlPlaneDatabaseSchema,
  type IntegrationBindingKind,
  type SandboxProfileVersionDefaultPersistenceMode,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";

import {
  SandboxProfilesConflictCodes,
  SandboxProfilesConflictError,
  SandboxProfilesNotFoundCodes,
  SandboxProfilesNotFoundError,
} from "../errors.js";
import { lockProfileVersionForUpdateOrThrow } from "./lock-profile-version-for-update.js";
import {
  replaceProfileVersionIntegrationBindings,
  validateProfileVersionIntegrationBindings,
} from "./profile-version-integration-bindings-write.js";
import {
  mapProfileVersionRuntimeConfig,
  type SandboxProfileVersionResources,
} from "./profile-version-runtime-config.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type PutProfileVersionDraftInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  setupScript?: string | null;
  defaultPersistenceMode?: SandboxProfileVersionDefaultPersistenceMode;
  sandboxProvider?: string;
  sandboxConnectionId?: string | null;
  sandboxResources?: SandboxProfileVersionResources;
  integrationBindings?: {
    bindings: Array<{
      id?: string;
      clientRef?: string;
      connectionId: string;
      kind: IntegrationBindingKind;
      config: Record<string, unknown>;
    }>;
  };
};

type PutProfileVersionDraftOutput = {
  sandboxProfileId: string;
  version: number;
  setupScript: string | null;
  defaultPersistenceMode: SandboxProfileVersionDefaultPersistenceMode;
  sandboxProvider: string | null;
  sandboxConnectionId: string | null;
  sandboxResources: SandboxProfileVersionResources | null;
  integrationBindings: Awaited<ReturnType<typeof replaceProfileVersionIntegrationBindings>>;
};

export async function putProfileVersionDraft(
  { db }: Pick<CreateSandboxProfilesServiceInput, "db">,
  input: PutProfileVersionDraftInput,
): Promise<PutProfileVersionDraftOutput> {
  const sandboxProfile = await db.query.sandboxProfiles.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and: whereAnd, eq: whereEq }) =>
      whereAnd(
        whereEq(table.id, input.profileId),
        whereEq(table.organizationId, input.organizationId),
      ),
  });

  if (sandboxProfile === undefined) {
    throw new SandboxProfilesNotFoundError(
      SandboxProfilesNotFoundCodes.PROFILE_NOT_FOUND,
      "Sandbox profile was not found.",
    );
  }

  const validatedBindings =
    input.integrationBindings === undefined
      ? null
      : await validateProfileVersionIntegrationBindings(
          { db },
          {
            organizationId: input.organizationId,
            profileId: input.profileId,
            profileVersion: input.profileVersion,
            bindings: input.integrationBindings.bindings,
          },
        );

  return db.transaction(async (tx) => {
    const tables = getControlPlaneDatabaseSchema(tx);
    const lockedVersion = await lockProfileVersionForUpdateOrThrow({
      db: tx,
      tables,
      profileId: input.profileId,
      profileVersion: input.profileVersion,
    });

    if (lockedVersion.state !== SandboxProfileVersionStates.DRAFT) {
      throw new SandboxProfilesConflictError(
        SandboxProfilesConflictCodes.PROFILE_VERSION_NOT_DRAFT,
        `Sandbox profile version '${String(input.profileVersion)}' is not a draft.`,
      );
    }

    const hasVersionFieldUpdate =
      input.setupScript !== undefined ||
      input.defaultPersistenceMode !== undefined ||
      input.sandboxProvider !== undefined ||
      input.sandboxConnectionId !== undefined ||
      input.sandboxResources !== undefined;

    if (hasVersionFieldUpdate) {
      const [updatedVersion] = await tx
        .update(tables.sandboxProfileVersions)
        .set({
          ...(input.setupScript === undefined ? {} : { setupScript: input.setupScript }),
          ...(input.defaultPersistenceMode === undefined
            ? {}
            : { defaultPersistenceMode: input.defaultPersistenceMode }),
          ...(input.sandboxProvider === undefined
            ? {}
            : { sandboxProvider: input.sandboxProvider }),
          ...(input.sandboxConnectionId === undefined
            ? {}
            : { sandboxConnectionId: input.sandboxConnectionId }),
          ...(input.sandboxResources === undefined
            ? {}
            : {
                sandboxVcpuCount: input.sandboxResources.vcpuCount,
                sandboxMemoryMb: input.sandboxResources.memoryMb,
                sandboxStorageMb: input.sandboxResources.storageMb ?? null,
              }),
        })
        .where(
          and(
            eq(tables.sandboxProfileVersions.sandboxProfileId, input.profileId),
            eq(tables.sandboxProfileVersions.version, input.profileVersion),
          ),
        )
        .returning({
          sandboxProfileId: tables.sandboxProfileVersions.sandboxProfileId,
          version: tables.sandboxProfileVersions.version,
          setupScript: tables.sandboxProfileVersions.setupScript,
          defaultPersistenceMode: tables.sandboxProfileVersions.defaultPersistenceMode,
        });

      if (updatedVersion === undefined) {
        throw new SandboxProfilesNotFoundError(
          SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
          "Sandbox profile version was not found.",
        );
      }
    }

    const integrationBindings =
      input.integrationBindings === undefined
        ? {
            bindings: await tx.query.sandboxProfileVersionIntegrationBindings.findMany({
              where: (table, { and: whereAnd, eq: whereEq }) =>
                whereAnd(
                  whereEq(table.sandboxProfileId, input.profileId),
                  whereEq(table.sandboxProfileVersion, input.profileVersion),
                ),
              orderBy: (table, { asc }) => [asc(table.id)],
            }),
          }
        : await replaceProfileVersionIntegrationBindings(tx, {
            profileId: input.profileId,
            profileVersion: input.profileVersion,
            bindings: input.integrationBindings.bindings,
            validatedBindings: validatedBindings ?? [],
          });

    const persistedVersion = await tx.query.sandboxProfileVersions.findFirst({
      columns: {
        sandboxProfileId: true,
        version: true,
        setupScript: true,
        defaultPersistenceMode: true,
        sandboxProvider: true,
        sandboxConnectionId: true,
        sandboxVcpuCount: true,
        sandboxMemoryMb: true,
        sandboxStorageMb: true,
      },
      where: (table, { and: whereAnd, eq: whereEq }) =>
        whereAnd(
          whereEq(table.sandboxProfileId, input.profileId),
          whereEq(table.version, input.profileVersion),
        ),
    });

    if (persistedVersion === undefined) {
      throw new SandboxProfilesNotFoundError(
        SandboxProfilesNotFoundCodes.PROFILE_VERSION_NOT_FOUND,
        "Sandbox profile version was not found.",
      );
    }

    return {
      sandboxProfileId: persistedVersion.sandboxProfileId,
      version: persistedVersion.version,
      setupScript: persistedVersion.setupScript,
      defaultPersistenceMode: persistedVersion.defaultPersistenceMode,
      ...mapProfileVersionRuntimeConfig(persistedVersion),
      integrationBindings,
    };
  });
}

export type { PutProfileVersionDraftInput, PutProfileVersionDraftOutput };
