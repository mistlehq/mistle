import {
  IntegrationConnectionStatuses,
  OrganizationIdentityLinkProviderConfigStatus,
  type UserExternalPrincipalCredentialSecretKind,
  UserExternalPrincipalCredentialSecretKinds,
  UserExternalPrincipalCredentialStatuses,
  UserExternalPrincipalKeyStatuses,
  UserExternalPrincipalStatuses,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { SlackConnectionMethodIds } from "@mistle/integrations-definitions";
import type {
  IntegrationAuthenticatedSession,
  IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { expect } from "vitest";

import { GitSshSigningCredentialKind } from "../../src/identity-linking/github-signing.js";
import {
  decryptCredentialUtf8,
  encryptCredentialUtf8,
  unwrapOrganizationCredentialKey,
} from "../../src/lib/crypto.js";

export async function upsertGitHubIdentityTarget(
  env: IntegrationTestEnvironment,
  input: {
    targetKey?: string;
    apiBaseUrl?: string;
    webBaseUrl?: string;
  } = {},
): Promise<void> {
  const targetKey = input.targetKey ?? "github-cloud";
  const apiBaseUrl = input.apiBaseUrl ?? "https://api.github.com";
  const webBaseUrl = input.webBaseUrl ?? "https://github.com";

  await env.controlPlaneDb
    .insert(env.controlPlaneTables.integrationTargets)
    .values({
      targetKey,
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: apiBaseUrl,
        web_base_url: webBaseUrl,
      },
    })
    .onConflictDoUpdate({
      target: env.controlPlaneTables.integrationTargets.targetKey,
      set: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: apiBaseUrl,
          web_base_url: webBaseUrl,
        },
      },
    });
}

export async function upsertSlackIdentityTarget(
  env: IntegrationTestEnvironment,
  input: {
    targetKey?: string;
    apiBaseUrl?: string;
  } = {},
): Promise<void> {
  const targetKey = input.targetKey ?? "slack-default";
  const apiBaseUrl = input.apiBaseUrl ?? "https://slack.com/api";

  await env.controlPlaneDb
    .insert(env.controlPlaneTables.integrationTargets)
    .values({
      targetKey,
      familyId: "slack",
      variantId: "slack-default",
      enabled: true,
      config: {
        api_base_url: apiBaseUrl,
      },
    })
    .onConflictDoUpdate({
      target: env.controlPlaneTables.integrationTargets.targetKey,
      set: {
        familyId: "slack",
        variantId: "slack-default",
        enabled: true,
        config: {
          api_base_url: apiBaseUrl,
        },
      },
    });
}

export async function createGitHubIdentityConnection(
  env: IntegrationTestEnvironment,
  input: {
    displayName: string;
    session: IntegrationAuthenticatedSession;
    targetKey?: string;
    includeClientSecret?: boolean;
  },
): Promise<string> {
  const targetKey = input.targetKey ?? "github-cloud";
  const response = await env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${encodeURIComponent(targetKey)}/form`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.session.cookie,
      },
      body: JSON.stringify({
        displayName: input.displayName,
        methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
        config: {
          connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
          app_id: "123",
          app_slug: "mistle-github-app",
          client_id: "Iv1.client123",
        },
        secrets: {
          appPrivateKeyPem: "-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----",
          ...(input.includeClientSecret === false ? {} : { clientSecret: "github-client-secret" }),
          webhookSecret: "github-webhook-secret",
        },
      }),
    },
  );

  expect(response.status).toBe(201);
  const connectionId = readStringField(await response.json().catch(() => null), "id");
  if (connectionId === null) {
    throw new Error("Expected GitHub App connection create response to include id.");
  }

  return connectionId;
}

export async function createSlackIdentityConnection(
  env: IntegrationTestEnvironment,
  input: {
    displayName: string;
    session: IntegrationAuthenticatedSession;
    targetKey?: string;
  },
): Promise<string> {
  const targetKey = input.targetKey ?? "slack-default";
  const response = await env.controlPlaneApi.http.fetch(
    `/v1/integration/connections/${encodeURIComponent(targetKey)}/form`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: input.session.cookie,
      },
      body: JSON.stringify({
        displayName: input.displayName,
        methodId: SlackConnectionMethodIds.SLACK_APP,
        config: {
          connection_method: SlackConnectionMethodIds.SLACK_APP,
          client_id: "123.456",
        },
        secrets: {
          botToken: "xoxb-slack-bot-token",
          signingSecret: "slack-signing-secret",
          clientSecret: "slack-client-secret",
        },
      }),
    },
  );

  expect(response.status).toBe(201);
  const connectionId = readStringField(await response.json().catch(() => null), "id");
  if (connectionId === null) {
    throw new Error("Expected Slack App connection create response to include id.");
  }

  return connectionId;
}

export async function seedIdentityProviderConfig(
  env: IntegrationTestEnvironment,
  input: {
    configId: string;
    connectionId: string;
    organizationId: string;
    providerFamily: string;
    status: OrganizationIdentityLinkProviderConfigStatus;
    targetKey: string;
    userId: string;
  },
): Promise<void> {
  await env.controlPlaneDb
    .insert(env.controlPlaneTables.organizationIdentityLinkProviderConfigs)
    .values({
      id: input.configId,
      organizationId: input.organizationId,
      providerFamily: input.providerFamily,
      status: input.status,
      integrationTargetKey: input.targetKey,
      integrationConnectionId: input.connectionId,
      createdByUserId: input.userId,
      updatedByUserId: input.userId,
    });
}

export async function seedIdentityConnection(
  env: IntegrationTestEnvironment,
  input: {
    connectionId: string;
    displayName: string;
    organizationId: string;
    targetKey: string;
    methodId: string;
    config?: Record<string, unknown>;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.integrationConnections).values({
    id: input.connectionId,
    organizationId: input.organizationId,
    targetKey: input.targetKey,
    displayName: input.displayName,
    status: IntegrationConnectionStatuses.ACTIVE,
    config: {
      connection_method: input.methodId,
      ...input.config,
    },
  });
}

export async function seedGitHubLinkedPrincipal(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    userId: string;
    principalId: string;
    providerConfigId: string;
    connectionId: string;
    providerSubjectId?: string;
    profile?: Record<string, unknown>;
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.userExternalPrincipals).values({
    id: input.principalId,
    organizationId: input.organizationId,
    userId: input.userId,
    providerFamily: "github",
    providerSubjectId: input.providerSubjectId ?? "12345",
    organizationProviderConfigId: input.providerConfigId,
    integrationConnectionId: input.connectionId,
    status: UserExternalPrincipalStatuses.ACTIVE,
    profile: input.profile ?? {
      login: "mistle-user",
    },
  });
  await env.controlPlaneDb.insert(env.controlPlaneTables.userExternalPrincipalKeys).values({
    organizationId: input.organizationId,
    principalId: input.principalId,
    providerFamily: "github",
    keyType: "account_id",
    keyValue: input.providerSubjectId ?? "12345",
    status: UserExternalPrincipalKeyStatuses.ACTIVE,
  });
}

export async function seedPrincipalCredential(
  env: IntegrationTestEnvironment,
  input: {
    credentialId: string;
    organizationId: string;
    principalId: string;
    providerFamily: string;
    credentialKind: string;
    accessTokenExpiresAt?: string | null;
    refreshTokenExpiresAt?: string | null;
    scopes?: string[];
  },
): Promise<void> {
  await env.controlPlaneDb.insert(env.controlPlaneTables.userExternalPrincipalCredentials).values({
    id: input.credentialId,
    organizationId: input.organizationId,
    principalId: input.principalId,
    providerFamily: input.providerFamily,
    credentialKind: input.credentialKind,
    status: UserExternalPrincipalCredentialStatuses.ACTIVE,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    refreshTokenExpiresAt: input.refreshTokenExpiresAt,
    scopes: input.scopes,
  });
}

export async function insertPrincipalCredentialSecret(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    credentialId: string;
    secretKind: UserExternalPrincipalCredentialSecretKind;
    plaintext: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const organizationCredentialKey = await readOrganizationCredentialKey(env, input.organizationId);
  const masterKeyMaterial = readMasterKeyMaterial(organizationCredentialKey.masterKeyVersion);
  const organizationCredentialKeyMaterial = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial: masterKeyMaterial,
  });

  try {
    const encrypted = encryptCredentialUtf8({
      plaintext: input.plaintext,
      organizationCredentialKey: organizationCredentialKeyMaterial,
    });
    await env.controlPlaneDb
      .insert(env.controlPlaneTables.userExternalPrincipalCredentialSecrets)
      .values({
        organizationId: input.organizationId,
        credentialId: input.credentialId,
        secretKind: input.secretKind,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        organizationCredentialKeyVersion: organizationCredentialKey.version,
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      });
  } finally {
    organizationCredentialKeyMaterial.fill(0);
  }
}

export async function insertGitHubSigningCredential(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    principalId: string;
    credentialId: string;
    privateKey: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  await seedPrincipalCredential(env, {
    credentialId: input.credentialId,
    organizationId: input.organizationId,
    principalId: input.principalId,
    providerFamily: "github",
    credentialKind: GitSshSigningCredentialKind,
  });
  await insertPrincipalCredentialSecret(env, {
    organizationId: input.organizationId,
    credentialId: input.credentialId,
    secretKind: UserExternalPrincipalCredentialSecretKinds.GIT_SSH_PRIVATE_KEY,
    plaintext: input.privateKey,
    metadata: input.metadata,
  });
}

export async function decryptPrincipalCredentialSecret(
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
    throw new Error("Expected organization credential key.");
  }

  const organizationCredentialKeyMaterial = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial: readMasterKeyMaterial(organizationCredentialKey.masterKeyVersion),
  });

  try {
    return decryptCredentialUtf8({
      nonce: input.nonce,
      ciphertext: input.ciphertext,
      organizationCredentialKey: organizationCredentialKeyMaterial,
    });
  } finally {
    organizationCredentialKeyMaterial.fill(0);
  }
}

export async function decryptPrincipalCredentialSecretByKind(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    credentialId: string;
    secretKind: UserExternalPrincipalCredentialSecretKind;
  },
): Promise<string> {
  const secret = await env.controlPlaneDb.query.userExternalPrincipalCredentialSecrets.findFirst({
    where: (table, { and, eq, isNull }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.credentialId, input.credentialId),
        eq(table.secretKind, input.secretKind),
        isNull(table.revokedAt),
      ),
  });
  if (secret === undefined) {
    throw new Error("Expected encrypted linked-principal credential secret.");
  }

  return decryptPrincipalCredentialSecret(env, {
    organizationId: input.organizationId,
    organizationCredentialKeyVersion: secret.organizationCredentialKeyVersion,
    nonce: secret.nonce,
    ciphertext: secret.ciphertext,
  });
}

async function readOrganizationCredentialKey(
  env: IntegrationTestEnvironment,
  organizationId: string,
) {
  const organizationCredentialKey =
    await env.controlPlaneDb.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, organizationId),
    });
  if (organizationCredentialKey === undefined) {
    throw new Error("Expected organization credential key.");
  }

  return organizationCredentialKey;
}

function readMasterKeyMaterial(masterKeyVersion: number): string {
  if (masterKeyVersion !== 1) {
    throw new Error(`Unexpected integration-new master key version '${String(masterKeyVersion)}'.`);
  }

  return "integration-new-master-key-testing";
}

function readStringField(payload: unknown, field: string): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }

  const value = Reflect.get(payload, field);
  return typeof value === "string" && value.length > 0 ? value : null;
}
