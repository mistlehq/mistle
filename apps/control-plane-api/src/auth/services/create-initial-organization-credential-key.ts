import { randomBytes } from "node:crypto";

import { ControlPlaneDbSchema, type ControlPlaneDatabase } from "@mistle/db/control-plane";

import {
  resolveMasterEncryptionKeyMaterial,
  wrapOrganizationCredentialKey,
} from "../../integration-credentials/crypto.js";

const ORGANIZATION_CREDENTIAL_KEY_VERSION = 1;
const ORGANIZATION_CREDENTIAL_KEY_BYTE_LENGTH = 32;

type CreateInitialOrganizationCredentialKeyInput = {
  db: ControlPlaneDatabase;
  organizationId: string;
  activeMasterEncryptionKeyVersion: number;
  masterEncryptionKeys: Record<string, string>;
};

export async function createInitialOrganizationCredentialKey(
  input: CreateInitialOrganizationCredentialKeyInput,
): Promise<void> {
  const organizationCredentialKey = randomBytes(ORGANIZATION_CREDENTIAL_KEY_BYTE_LENGTH);
  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: input.activeMasterEncryptionKeyVersion,
    masterEncryptionKeys: input.masterEncryptionKeys,
  });

  try {
    const ciphertext = wrapOrganizationCredentialKey({
      organizationCredentialKey,
      masterEncryptionKeyMaterial,
    });

    await input.db.insert(ControlPlaneDbSchema.organizationCredentialKeys).values({
      organizationId: input.organizationId,
      version: ORGANIZATION_CREDENTIAL_KEY_VERSION,
      masterKeyVersion: input.activeMasterEncryptionKeyVersion,
      ciphertext,
    });
  } finally {
    organizationCredentialKey.fill(0);
  }
}
