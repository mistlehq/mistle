import {
  getControlPlaneDatabaseSchema,
  type IntegrationBindingKind,
  type ControlPlaneTransaction,
  type SandboxProfileVersionAgentRuntimeId,
  type SandboxProfileVersionDefaultPersistenceMode,
  SandboxProfileVersionStates,
} from "@mistle/db/control-plane";
import { and, eq } from "drizzle-orm";

import {
  SandboxProfilesBadRequestCodes,
  SandboxProfilesBadRequestError,
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
  validateSandboxProfileVersionRuntimeConfig,
} from "./profile-version-runtime-config.js";
import type { CreateSandboxProfilesServiceInput } from "./types.js";

type PutProfileVersionDraftInput = {
  organizationId: string;
  profileId: string;
  profileVersion: number;
  setupScript?: string | null;
  defaultPersistenceMode?: SandboxProfileVersionDefaultPersistenceMode;
  agentRuntimeId?: SandboxProfileVersionAgentRuntimeId;
  mistleMcpEnabled?: boolean;
  mistleMcpApiKeyId?: string | null;
  sandboxProvider?: string;
  sandboxConnectionId?: string | null;
  sandboxResources?: SandboxProfileVersionResources | null;
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
  agentRuntimeId: SandboxProfileVersionAgentRuntimeId;
  mistleMcpEnabled: boolean;
  mistleMcpApiKeyId: string | null;
  sandboxProvider: string | null;
  sandboxConnectionId: string | null;
  sandboxResources: SandboxProfileVersionResources | null;
  integrationBindings: Awaited<ReturnType<typeof replaceProfileVersionIntegrationBindings>>;
};

export async function putProfileVersionDraft(
  {
    db,
    integrationRegistry,
    sandboxConfig,
  }: Pick<CreateSandboxProfilesServiceInput, "db" | "integrationRegistry" | "sandboxConfig">,
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

    const nextRuntimeConfig = mapProfileVersionRuntimeConfig({
      sandboxProvider: input.sandboxProvider ?? lockedVersion.sandboxProvider,
      sandboxConnectionId:
        input.sandboxConnectionId === undefined
          ? lockedVersion.sandboxConnectionId
          : input.sandboxConnectionId,
      sandboxVcpuCount:
        input.sandboxResources === undefined
          ? lockedVersion.sandboxVcpuCount
          : (input.sandboxResources?.vcpuCount ?? null),
      sandboxMemoryMb:
        input.sandboxResources === undefined
          ? lockedVersion.sandboxMemoryMb
          : (input.sandboxResources?.memoryMb ?? null),
      sandboxStorageMb:
        input.sandboxResources === undefined
          ? lockedVersion.sandboxStorageMb
          : (input.sandboxResources?.storageMb ?? null),
    });

    const runtimeConfigIssues = await validateSandboxProfileVersionRuntimeConfig(
      { db: tx, integrationRegistry, sandboxConfig },
      {
        organizationId: input.organizationId,
        runtimeConfig: nextRuntimeConfig,
      },
    );

    if (runtimeConfigIssues.length > 0) {
      const firstIssue = runtimeConfigIssues[0];
      if (firstIssue === undefined) {
        throw new Error("Expected sandbox runtime validation issue.");
      }

      throw new SandboxProfilesBadRequestError(
        SandboxProfilesBadRequestCodes.INVALID_SANDBOX_RUNTIME_CONFIG,
        firstIssue.message,
      );
    }

    const nextMistleMcpEnabled = input.mistleMcpEnabled ?? lockedVersion.mistleMcpEnabled;
    const nextMistleMcpApiKeyId =
      input.mistleMcpApiKeyId === undefined
        ? lockedVersion.mistleMcpApiKeyId
        : input.mistleMcpApiKeyId;
    await validateMistleMcpDraftConfig(tx, {
      apiKeyId: nextMistleMcpApiKeyId,
      enabled: nextMistleMcpEnabled,
      organizationId: input.organizationId,
    });

    const hasVersionFieldUpdate =
      input.setupScript !== undefined ||
      input.defaultPersistenceMode !== undefined ||
      input.agentRuntimeId !== undefined ||
      input.mistleMcpEnabled !== undefined ||
      input.mistleMcpApiKeyId !== undefined ||
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
          ...(input.agentRuntimeId === undefined ? {} : { agentRuntimeId: input.agentRuntimeId }),
          ...(input.mistleMcpEnabled === undefined
            ? {}
            : { mistleMcpEnabled: input.mistleMcpEnabled }),
          ...(input.mistleMcpApiKeyId === undefined
            ? {}
            : { mistleMcpApiKeyId: input.mistleMcpApiKeyId }),
          ...(input.sandboxProvider === undefined
            ? {}
            : { sandboxProvider: input.sandboxProvider }),
          ...(input.sandboxConnectionId === undefined
            ? {}
            : { sandboxConnectionId: input.sandboxConnectionId }),
          ...(input.sandboxResources === undefined
            ? {}
            : input.sandboxResources === null
              ? {
                  sandboxVcpuCount: null,
                  sandboxMemoryMb: null,
                  sandboxStorageMb: null,
                }
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
          agentRuntimeId: tables.sandboxProfileVersions.agentRuntimeId,
          mistleMcpEnabled: tables.sandboxProfileVersions.mistleMcpEnabled,
          mistleMcpApiKeyId: tables.sandboxProfileVersions.mistleMcpApiKeyId,
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
        agentRuntimeId: true,
        mistleMcpEnabled: true,
        mistleMcpApiKeyId: true,
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
      agentRuntimeId: persistedVersion.agentRuntimeId,
      mistleMcpEnabled: persistedVersion.mistleMcpEnabled,
      mistleMcpApiKeyId: persistedVersion.mistleMcpApiKeyId,
      ...mapProfileVersionRuntimeConfig(persistedVersion),
      integrationBindings,
    };
  });
}

async function validateMistleMcpDraftConfig(
  db: ControlPlaneTransaction,
  input: {
    enabled: boolean;
    apiKeyId: string | null;
    organizationId: string;
  },
): Promise<void> {
  if (!input.enabled) {
    return;
  }

  if (input.apiKeyId === null) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_MISTLE_MCP_CONFIG,
      "Select an API key before allowing the agent to interact with Mistle resources.",
    );
  }

  const apiKeyId = input.apiKeyId;
  const apiKey = await db.query.apiKeys.findFirst({
    columns: {
      id: true,
    },
    where: (table, { and: whereAnd, eq: whereEq, gt, isNull, or }) =>
      whereAnd(
        whereEq(table.id, apiKeyId),
        whereEq(table.organizationId, input.organizationId),
        isNull(table.revokedAt),
        or(isNull(table.expiresAt), gt(table.expiresAt, new Date().toISOString())),
      ),
  });

  if (apiKey === undefined) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_MISTLE_MCP_CONFIG,
      "Selected Mistle MCP API key is not available.",
    );
  }
}

export type { PutProfileVersionDraftInput, PutProfileVersionDraftOutput };
