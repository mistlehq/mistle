import {
  organizationSandboxStorageSettings,
  SandboxStorageBackend as SandboxStorageBackendValues,
  SandboxStorageConfigSources,
  type ControlPlaneDatabase,
  type SandboxStorageBackend,
  type SandboxStorageConfigSource,
} from "@mistle/db/control-plane";
import { sql } from "drizzle-orm";

import {
  OrganizationSandboxStorageConfigVersion,
  OrganizationSandboxStorageConfigV1Schema,
  summarizeOrganizationSandboxStorageConfig,
  type OrganizationSandboxStorageConfigSummary,
  type OrganizationSandboxStorageConfigV1,
} from "../storage-config.js";
import {
  decryptOrganizationBackedValue,
  encryptOrganizationBackedValue,
} from "./credential-crypto.js";

type OrganizationCredentialEncryptionConfig = {
  masterEncryptionKeys: Record<string, string>;
};

export type ResolvedOrganizationSandboxStorageSettings = {
  persistentSandboxesEnabled: boolean;
  storageConfigSource: SandboxStorageConfigSource;
  storageBackend: SandboxStorageBackend | null;
  storageConfigVersion: number | null;
  organizationStorageConfig: OrganizationSandboxStorageConfigV1 | null;
};

export type PublicOrganizationSandboxStorageSettingsResponse = {
  persistentSandboxesEnabled: boolean;
  storageConfigSource: SandboxStorageConfigSource;
  storageBackend: typeof SandboxStorageBackendValues.ARCHIL | null;
  storageConfigVersion: number | null;
  organizationStorageConfigSummary: OrganizationSandboxStorageConfigSummary | null;
};

async function getStoredOrganizationSandboxStorageSettings(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
}) {
  return input.db.query.organizationSandboxStorageSettings.findFirst({
    where: (table, { eq }) => eq(table.organizationId, input.organizationId),
  });
}

export async function resolveOrganizationSandboxStorageSettings(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  encryptionConfig: OrganizationCredentialEncryptionConfig;
}): Promise<ResolvedOrganizationSandboxStorageSettings> {
  const settings = await getStoredOrganizationSandboxStorageSettings(input);
  if (settings === undefined) {
    return {
      persistentSandboxesEnabled: false,
      storageConfigSource: SandboxStorageConfigSources.MANAGED,
      storageBackend: null,
      storageConfigVersion: null,
      organizationStorageConfig: null,
    };
  }

  if (settings.storageConfigSource === SandboxStorageConfigSources.MANAGED) {
    return {
      persistentSandboxesEnabled: settings.persistentSandboxesEnabled,
      storageConfigSource: SandboxStorageConfigSources.MANAGED,
      storageBackend: null,
      storageConfigVersion: null,
      organizationStorageConfig: null,
    };
  }

  if (settings.storageBackend !== SandboxStorageBackendValues.ARCHIL) {
    throw new Error(
      `Unsupported organization sandbox storage backend '${String(settings.storageBackend)}' for organization '${input.organizationId}'.`,
    );
  }
  if (settings.storageConfigVersion !== OrganizationSandboxStorageConfigVersion) {
    throw new Error(
      `Unsupported organization sandbox storage config version '${String(settings.storageConfigVersion)}' for organization '${input.organizationId}'.`,
    );
  }
  if (
    settings.storageConfigCiphertext === null ||
    settings.storageConfigNonce === null ||
    settings.organizationCredentialKeyVersion === null
  ) {
    throw new Error(
      `Organization sandbox storage override for organization '${input.organizationId}' is incomplete.`,
    );
  }

  const plaintext = await decryptOrganizationBackedValue({
    db: input.db,
    organizationId: input.organizationId,
    ciphertext: settings.storageConfigCiphertext,
    nonce: settings.storageConfigNonce,
    organizationCredentialKeyVersion: settings.organizationCredentialKeyVersion,
    encryptionConfig: input.encryptionConfig,
  });

  return {
    persistentSandboxesEnabled: settings.persistentSandboxesEnabled,
    storageConfigSource: SandboxStorageConfigSources.ORGANIZATION,
    storageBackend: SandboxStorageBackendValues.ARCHIL,
    storageConfigVersion: OrganizationSandboxStorageConfigVersion,
    organizationStorageConfig: OrganizationSandboxStorageConfigV1Schema.parse(
      JSON.parse(plaintext),
    ),
  };
}

export function createPublicOrganizationSandboxStorageSettingsResponse(
  input: ResolvedOrganizationSandboxStorageSettings,
): PublicOrganizationSandboxStorageSettingsResponse {
  const storageBackend =
    input.storageBackend === SandboxStorageBackendValues.ARCHIL
      ? SandboxStorageBackendValues.ARCHIL
      : null;

  return {
    persistentSandboxesEnabled: input.persistentSandboxesEnabled,
    storageConfigSource: input.storageConfigSource,
    storageBackend,
    storageConfigVersion: input.storageConfigVersion,
    organizationStorageConfigSummary:
      input.organizationStorageConfig === null
        ? null
        : summarizeOrganizationSandboxStorageConfig(input.organizationStorageConfig),
  };
}

export async function upsertOrganizationSandboxStorageSettings(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  persistentSandboxesEnabled: boolean;
  storageConfigSource: SandboxStorageConfigSource;
  organizationStorageConfig: OrganizationSandboxStorageConfigV1 | null;
  encryptionConfig: OrganizationCredentialEncryptionConfig;
}): Promise<ResolvedOrganizationSandboxStorageSettings> {
  let updateValues: Pick<
    typeof organizationSandboxStorageSettings.$inferInsert,
    | "persistentSandboxesEnabled"
    | "storageBackend"
    | "storageConfigSource"
    | "storageConfigVersion"
    | "storageConfigCiphertext"
    | "storageConfigNonce"
    | "organizationCredentialKeyVersion"
  >;

  if (input.storageConfigSource === SandboxStorageConfigSources.MANAGED) {
    if (input.organizationStorageConfig !== null) {
      throw new Error(
        "Organization storage config must be null when storage config source is managed.",
      );
    }

    updateValues = {
      persistentSandboxesEnabled: input.persistentSandboxesEnabled,
      storageBackend: null,
      storageConfigSource: SandboxStorageConfigSources.MANAGED,
      storageConfigVersion: null,
      storageConfigCiphertext: null,
      storageConfigNonce: null,
      organizationCredentialKeyVersion: null,
    };
  } else {
    if (input.organizationStorageConfig === null) {
      throw new Error("Organization storage config is required for organization storage source.");
    }

    const encryptedStorageConfig = await encryptOrganizationBackedValue({
      db: input.db,
      organizationId: input.organizationId,
      plaintext: JSON.stringify(input.organizationStorageConfig),
      encryptionConfig: input.encryptionConfig,
    });

    updateValues = {
      persistentSandboxesEnabled: input.persistentSandboxesEnabled,
      storageBackend: input.organizationStorageConfig.backend,
      storageConfigSource: SandboxStorageConfigSources.ORGANIZATION,
      storageConfigVersion: OrganizationSandboxStorageConfigVersion,
      storageConfigCiphertext: encryptedStorageConfig.ciphertext,
      storageConfigNonce: encryptedStorageConfig.nonce,
      organizationCredentialKeyVersion: encryptedStorageConfig.organizationCredentialKeyVersion,
    };
  }

  await input.db
    .insert(organizationSandboxStorageSettings)
    .values({
      organizationId: input.organizationId,
      ...updateValues,
    })
    .onConflictDoUpdate({
      target: organizationSandboxStorageSettings.organizationId,
      set: {
        ...updateValues,
        updatedAt: sql`now()`,
      },
    });

  return resolveOrganizationSandboxStorageSettings({
    db: input.db,
    organizationId: input.organizationId,
    encryptionConfig: input.encryptionConfig,
  });
}
