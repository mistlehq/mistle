import {
  type ControlPlaneDatabase,
  type UserExternalPrincipalCredentialSecretKind,
  UserExternalPrincipalCredentialSecretKinds,
} from "@mistle/db/control-plane";

import {
  decryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../../lib/crypto.js";
import { InternalIdentityLinkingError, InternalIdentityLinkingErrorCodes } from "./errors.js";

export type LoadedCredentialSecret = {
  secretKind: UserExternalPrincipalCredentialSecretKind;
  ciphertext: string;
  nonce: string;
  organizationCredentialKeyVersion: number;
  expiresAt: string | null;
  revokedAt: string | null;
};

export function resolvePrincipalCredentialSecretKindOrThrow(
  secretKind: string,
): UserExternalPrincipalCredentialSecretKind {
  for (const candidate of Object.values(UserExternalPrincipalCredentialSecretKinds)) {
    if (candidate === secretKind) {
      return candidate;
    }
  }

  throw new Error(`Unsupported linked-principal credential secret kind '${secretKind}'.`);
}

export async function createCredentialSecretResolver(input: {
  tx: ControlPlaneDatabase;
  organizationId: string;
  integrationsConfig: {
    masterEncryptionKeys: Record<string, string>;
  };
  secrets: LoadedCredentialSecret[];
}): Promise<{
  resolve: (secretKind: string) => Promise<string>;
  cleanup: () => void;
}> {
  const secretByKind = new Map<string, LoadedCredentialSecret>();
  for (const secret of input.secrets) {
    if (secret.revokedAt !== null) {
      continue;
    }

    secretByKind.set(secret.secretKind, secret);
  }

  const keyMaterialByVersion = new Map<number, Buffer>();
  const plaintextBySecretKind = new Map<string, string>();

  return {
    resolve: async (secretKind: string): Promise<string> => {
      const cachedPlaintext = plaintextBySecretKind.get(secretKind);
      if (cachedPlaintext !== undefined) {
        return cachedPlaintext;
      }

      const secret = secretByKind.get(secretKind);
      if (secret === undefined) {
        throw new InternalIdentityLinkingError(
          InternalIdentityLinkingErrorCodes.CREDENTIAL_REAUTHORIZATION_REQUIRED,
          400,
          `Linked-principal credential is missing required secret '${secretKind}'.`,
        );
      }

      let organizationCredentialKey = keyMaterialByVersion.get(
        secret.organizationCredentialKeyVersion,
      );
      if (organizationCredentialKey === undefined) {
        const organizationCredentialKeyRow =
          await input.tx.query.organizationCredentialKeys.findFirst({
            where: (table, { and, eq }) =>
              and(
                eq(table.organizationId, input.organizationId),
                eq(table.version, secret.organizationCredentialKeyVersion),
              ),
          });

        if (organizationCredentialKeyRow === undefined) {
          throw new Error(
            `Organization credential key version '${String(secret.organizationCredentialKeyVersion)}' is missing for '${input.organizationId}'.`,
          );
        }

        const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
          masterKeyVersion: organizationCredentialKeyRow.masterKeyVersion,
          masterEncryptionKeys: input.integrationsConfig.masterEncryptionKeys,
        });
        organizationCredentialKey = unwrapOrganizationCredentialKey({
          wrappedCiphertext: organizationCredentialKeyRow.ciphertext,
          masterEncryptionKeyMaterial,
        });
        keyMaterialByVersion.set(
          secret.organizationCredentialKeyVersion,
          organizationCredentialKey,
        );
      }

      const plaintext = decryptCredentialUtf8({
        nonce: secret.nonce,
        ciphertext: secret.ciphertext,
        organizationCredentialKey,
      });
      plaintextBySecretKind.set(secretKind, plaintext);
      return plaintext;
    },
    cleanup() {
      for (const keyMaterial of keyMaterialByVersion.values()) {
        keyMaterial.fill(0);
      }

      keyMaterialByVersion.clear();
      plaintextBySecretKind.clear();
    },
  };
}
