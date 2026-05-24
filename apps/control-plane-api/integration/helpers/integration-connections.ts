import type { IntegrationCredentialSecretKind } from "@mistle/db/control-plane";
import type { IntegrationTestEnvironment } from "@mistle/test-harness/integration";
import { expect } from "vitest";

import {
  decryptCredentialUtf8,
  encryptCredentialUtf8,
  encryptDeviceAuthorizationProviderStateUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../../src/lib/crypto.js";

const IntegrationMasterEncryptionKeys: Record<number, string> = {
  "1": "integration-new-master-key-testing",
};

export const IntegrationIntegrationsConfig = {
  activeMasterEncryptionKeyVersion: 1,
  masterEncryptionKeys: IntegrationMasterEncryptionKeys,
};

const IntegrationMasterKeyVersion = 1;
const MaybeIntegrationMasterEncryptionKeyMaterial =
  IntegrationMasterEncryptionKeys[IntegrationMasterKeyVersion];
if (MaybeIntegrationMasterEncryptionKeyMaterial === undefined) {
  throw new Error("Expected integration master encryption key material.");
}
const IntegrationMasterEncryptionKeyMaterial = MaybeIntegrationMasterEncryptionKeyMaterial;

export type SeedIntegrationTargetInput = {
  targetKey: string;
  familyId: string;
  variantId: string;
  enabled?: boolean;
  config: Record<string, unknown>;
};

export type ExpectedCredentialSlot = {
  slotKey: string;
  secretKind: IntegrationCredentialSecretKind;
  intendedFamilyId?: string;
  plaintext?: string;
};

export async function seedIntegrationTarget(
  env: IntegrationTestEnvironment,
  input: SeedIntegrationTargetInput,
): Promise<void> {
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.integrationTargets)
    .values({
      targetKey: input.targetKey,
      familyId: input.familyId,
      variantId: input.variantId,
      enabled: input.enabled ?? true,
      config: input.config,
    })
    .onConflictDoUpdate({
      target: env.controlPlaneTables.integrationTargets.targetKey,
      set: {
        familyId: input.familyId,
        variantId: input.variantId,
        enabled: input.enabled ?? true,
        config: input.config,
      },
    });
}

export async function createFormConnection(input: {
  env: IntegrationTestEnvironment;
  targetKey: string;
  cookie: string;
  body: unknown;
}) {
  return input.env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${encodeURIComponent(input.targetKey)}/form`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.cookie,
      },
      body: JSON.stringify(input.body),
    },
  );
}

export async function updateFormConnection(input: {
  env: IntegrationTestEnvironment;
  connectionId: string;
  cookie: string;
  body: unknown;
}) {
  return input.env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${encodeURIComponent(input.connectionId)}/form`,
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: input.cookie,
      },
      body: JSON.stringify(input.body),
    },
  );
}

export async function expectCredentialSlots(input: {
  env: IntegrationTestEnvironment;
  connectionId: string;
  organizationId: string;
  expected: ExpectedCredentialSlot[];
  previousCredentialIds?: string[];
}): Promise<void> {
  const links = await input.env.controlPlaneDb.query.integrationConnectionCredentials.findMany({
    where: (table, { eq }) => eq(table.connectionId, input.connectionId),
    orderBy: (table, { asc }) => [asc(table.slotKey)],
  });

  expect(links.map((link) => link.slotKey)).toEqual(
    input.expected.map((credentialSlot) => credentialSlot.slotKey),
  );

  if (input.previousCredentialIds !== undefined) {
    expect(links).toHaveLength(input.previousCredentialIds.length);
    links.forEach((link, index) => {
      expect(link.credentialId).not.toBe(input.previousCredentialIds?.[index]);
    });
  }

  for (const expectedSlot of input.expected) {
    const link = links.find((candidate) => candidate.slotKey === expectedSlot.slotKey);
    if (link === undefined) {
      throw new Error(`Expected credential link for slot '${expectedSlot.slotKey}'.`);
    }

    const credential = await input.env.controlPlaneDb.query.integrationCredentials.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.id, link.credentialId), eq(table.organizationId, input.organizationId)),
    });
    if (credential === undefined) {
      throw new Error(`Expected credential '${link.credentialId}'.`);
    }

    expect(credential.secretKind).toBe(expectedSlot.secretKind);
    if (expectedSlot.intendedFamilyId !== undefined) {
      expect(credential.intendedFamilyId).toBe(expectedSlot.intendedFamilyId);
    }
    if (expectedSlot.plaintext !== undefined) {
      expect(credential.ciphertext).not.toContain(expectedSlot.plaintext);
      await expect(
        decryptStoredCredential(input.env, {
          organizationId: input.organizationId,
          organizationCredentialKeyVersion: credential.organizationCredentialKeyVersion,
          nonce: credential.nonce,
          ciphertext: credential.ciphertext,
        }),
      ).resolves.toBe(expectedSlot.plaintext);
    }
  }
}

export async function readCredentialIds(input: {
  env: IntegrationTestEnvironment;
  connectionId: string;
}): Promise<string[]> {
  const links = await input.env.controlPlaneDb.query.integrationConnectionCredentials.findMany({
    where: (table, { eq }) => eq(table.connectionId, input.connectionId),
    orderBy: (table, { asc }) => [asc(table.slotKey)],
  });
  return links.map((link) => link.credentialId);
}

export async function expectImplicitWebhookSource(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  connectionId: string;
  targetKey: string;
}): Promise<void> {
  const webhookSource = await input.env.controlPlaneDb.query.integrationWebhookSources.findFirst({
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.integrationConnectionId, input.connectionId),
        eq(table.targetKey, input.targetKey),
      ),
  });

  if (webhookSource === undefined) {
    throw new Error(`Expected implicit webhook source for '${input.connectionId}'.`);
  }

  expect(webhookSource.endpointKey.length).toBeGreaterThan(0);
}

export async function seedConnectionCredential(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  connectionId: string;
  slotKey: string;
  secretKind: IntegrationCredentialSecretKind;
  intendedFamilyId?: string;
  plaintext: string;
}): Promise<void> {
  const organizationCredentialKey =
    await input.env.controlPlaneDb.query.organizationCredentialKeys.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.organizationId, input.organizationId), eq(table.version, 1)),
    });

  if (organizationCredentialKey === undefined) {
    throw new Error(`Expected organization credential key for '${input.organizationId}'.`);
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: IntegrationMasterEncryptionKeys,
  });
  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const encryptedCredential = encryptCredentialUtf8({
      plaintext: input.plaintext,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
    });

    const credentials = await input.env.controlPlaneDb
      .insert(input.env.controlPlaneTables.integrationCredentials)
      .values({
        organizationId: input.organizationId,
        secretKind: input.secretKind,
        organizationCredentialKeyVersion: organizationCredentialKey.version,
        intendedFamilyId: input.intendedFamilyId,
        nonce: encryptedCredential.nonce,
        ciphertext: encryptedCredential.ciphertext,
      })
      .returning({
        id: input.env.controlPlaneTables.integrationCredentials.id,
      });
    const credential = credentials[0];
    if (credential === undefined) {
      throw new Error("Expected inserted integration credential.");
    }

    await input.env.controlPlaneDb
      .insert(input.env.controlPlaneTables.integrationConnectionCredentials)
      .values({
        connectionId: input.connectionId,
        credentialId: credential.id,
        slotKey: input.slotKey,
      });
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}

export function encryptDeviceAuthorizationProviderStateForTest(input: {
  value: Record<string, unknown>;
}): string {
  return encryptDeviceAuthorizationProviderStateUtf8({
    plaintext: JSON.stringify(input.value),
    masterKeyVersion: IntegrationMasterKeyVersion,
    masterEncryptionKeyMaterial: IntegrationMasterEncryptionKeyMaterial,
  });
}

async function decryptStoredCredential(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    organizationCredentialKeyVersion: number;
    nonce: string;
    ciphertext: string;
  },
): Promise<string> {
  const organizationCredentialKey =
    await env.controlPlaneDb.query.organizationCredentialKeys.findFirst({
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, input.organizationId),
          eq(table.version, input.organizationCredentialKeyVersion),
        ),
    });

  if (organizationCredentialKey === undefined) {
    throw new Error(
      `Expected organization credential key version '${input.organizationCredentialKeyVersion}'.`,
    );
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: IntegrationMasterEncryptionKeys,
  });
  const unwrappedOrganizationCredentialKey = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    return decryptCredentialUtf8({
      nonce: input.nonce,
      ciphertext: input.ciphertext,
      organizationCredentialKey: unwrappedOrganizationCredentialKey,
    });
  } finally {
    unwrappedOrganizationCredentialKey.fill(0);
  }
}
