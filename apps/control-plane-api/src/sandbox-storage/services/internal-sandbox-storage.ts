import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import {
  SandboxStorageBackend,
  type SandboxStorageBackend as SandboxStorageBackendValue,
} from "@mistle/db/control-plane";
import { SandboxProvider, type SandboxProvider as SandboxProviderValue } from "@mistle/sandbox";

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
      persistentSandboxesEnabled: true;
      storageConfigSource: "managed";
      storageBackend: SandboxStorageBackendValue;
      organizationStorageConfig: null;
    }
  | {
      persistentSandboxesEnabled: true;
      storageConfigSource: "organization";
      storageBackend: typeof SandboxStorageBackend.ARCHIL;
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
  runtimeProvider: SandboxProviderValue;
  managedStorageBackend: SandboxStorageBackendValue | undefined;
  encryptionConfig: OrganizationCredentialEncryptionConfig;
}): Promise<ResolveSandboxStorageConfigurationResponse> {
  const settings = await resolveOrganizationSandboxStorageSettings(input);

  if (!settings.persistentSandboxesEnabled) {
    return {
      persistentSandboxesEnabled: false,
      storageConfigSource: "managed",
      storageBackend: null,
      organizationStorageConfig: null,
    };
  }

  if (input.managedStorageBackend === undefined) {
    throw new Error(
      `Persistent sandboxes are enabled for organization '${input.organizationId}' but no managed sandbox storage backend is configured.`,
    );
  }

  if (
    input.runtimeProvider === SandboxProvider.DOCKER ||
    settings.storageConfigSource === "managed"
  ) {
    return {
      persistentSandboxesEnabled: true,
      storageConfigSource: "managed",
      storageBackend: input.managedStorageBackend,
      organizationStorageConfig: null,
    };
  }

  if (
    settings.organizationStorageConfig === null ||
    settings.storageBackend !== SandboxStorageBackend.ARCHIL
  ) {
    throw new Error(
      `Expected organization storage override for organization '${input.organizationId}'.`,
    );
  }

  return {
    persistentSandboxesEnabled: true,
    storageConfigSource: "organization",
    storageBackend: SandboxStorageBackend.ARCHIL,
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
