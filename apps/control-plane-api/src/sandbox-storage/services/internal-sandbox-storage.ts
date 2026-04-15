import type { ControlPlaneDatabase } from "@mistle/db/control-plane";

import type { OrganizationSandboxStorageConfigV1 } from "../storage-config.js";
import {
  decryptOrganizationBackedValue,
  encryptOrganizationBackedValue,
} from "./credential-crypto.js";
import {
  createPublicOrganizationSandboxStorageSettingsResponse,
  resolveOrganizationSandboxStorageSettings,
} from "./organization-sandbox-storage-settings.js";

type OrganizationCredentialEncryptionConfig = {
  masterEncryptionKeys: Record<string, string>;
};

type ResolveSandboxStorageConfigurationResponse =
  | {
      persistentSandboxesEnabled: false;
      storageConfigSource: "managed";
      storageBackend: null;
      organizationStorageConfig: null;
    }
  | {
      persistentSandboxesEnabled: false;
      storageConfigSource: "organization";
      storageBackend: "archil";
      organizationStorageConfig: OrganizationSandboxStorageConfigV1;
    }
  | {
      persistentSandboxesEnabled: true;
      storageConfigSource: "managed";
      storageBackend: null;
      organizationStorageConfig: null;
    }
  | {
      persistentSandboxesEnabled: true;
      storageConfigSource: "organization";
      storageBackend: "archil";
      organizationStorageConfig: OrganizationSandboxStorageConfigV1;
    };

export async function resolveSandboxStoragePersistenceMode(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
}): Promise<{
  persistentSandboxesEnabled: boolean;
}> {
  const settings = await input.db.query.organizationSandboxStorageSettings.findFirst({
    columns: {
      persistentSandboxesEnabled: true,
      storageConfigSource: true,
    },
    where: (table, { eq }) => eq(table.organizationId, input.organizationId),
  });

  return {
    persistentSandboxesEnabled: settings?.persistentSandboxesEnabled ?? false,
  };
}

export async function resolveSandboxStorageConfiguration(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  encryptionConfig: OrganizationCredentialEncryptionConfig;
}): Promise<ResolveSandboxStorageConfigurationResponse> {
  const settings = await resolveOrganizationSandboxStorageSettings(input);

  if (settings.storageConfigSource === "managed") {
    return {
      persistentSandboxesEnabled: settings.persistentSandboxesEnabled,
      storageConfigSource: "managed",
      storageBackend: null,
      organizationStorageConfig: null,
    };
  }

  if (settings.organizationStorageConfig === null || settings.storageBackend !== "archil") {
    throw new Error(
      `Expected organization storage override for organization '${input.organizationId}'.`,
    );
  }

  return {
    persistentSandboxesEnabled: settings.persistentSandboxesEnabled,
    storageConfigSource: "organization",
    storageBackend: "archil",
    organizationStorageConfig: settings.organizationStorageConfig,
  };
}

export async function encryptSandboxStorageCredential(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  credentialKind: "disk_token";
  plaintext: string;
  encryptionConfig: OrganizationCredentialEncryptionConfig;
}): Promise<{
  credentialKind: "disk_token";
  ciphertext: string;
  nonce: string;
  organizationCredentialKeyVersion: number;
}> {
  const encrypted = await encryptOrganizationBackedValue({
    db: input.db,
    organizationId: input.organizationId,
    plaintext: input.plaintext,
    encryptionConfig: input.encryptionConfig,
  });

  return {
    credentialKind: input.credentialKind,
    ...encrypted,
  };
}

export async function resolveSandboxStorageCredential(input: {
  db: ControlPlaneDatabase;
  organizationId: string;
  credentialKind: "disk_token";
  ciphertext: string;
  nonce: string;
  organizationCredentialKeyVersion: number;
  encryptionConfig: OrganizationCredentialEncryptionConfig;
}): Promise<{
  credentialKind: "disk_token";
  plaintext: string;
}> {
  const plaintext = await decryptOrganizationBackedValue({
    db: input.db,
    organizationId: input.organizationId,
    ciphertext: input.ciphertext,
    nonce: input.nonce,
    organizationCredentialKeyVersion: input.organizationCredentialKeyVersion,
    encryptionConfig: input.encryptionConfig,
  });

  return {
    credentialKind: input.credentialKind,
    plaintext,
  };
}

export { createPublicOrganizationSandboxStorageSettingsResponse };
