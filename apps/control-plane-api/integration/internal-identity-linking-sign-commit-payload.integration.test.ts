import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  integrationConnections,
  IntegrationConnectionStatuses,
  integrationTargets,
  organizationIdentityLinkProviderConfigs,
  OrganizationIdentityLinkProviderConfigStatus,
  userExternalPrincipalCredentialSecrets,
  UserExternalPrincipalCredentialSecretKinds,
  type UserExternalPrincipalCredentialSecretKind,
  userExternalPrincipalCredentials,
  UserExternalPrincipalCredentialStatuses,
  userExternalPrincipals,
  UserExternalPrincipalStatuses,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { mintSigningGrant } from "@mistle/sandbox-signing-auth";
import { beforeAll, describe, expect } from "vitest";

import { insertInitialOrganizationCredentialKey } from "../../data-plane-worker/integration/helpers/organization-credential-keys.js";
import {
  CONTROL_PLANE_INTERNAL_AUTH_HEADER,
  INTERNAL_IDENTITY_LINKING_ROUTE_BASE_PATH,
} from "../src/internal/identity-linking/index.js";
import { InternalIdentityLinkingErrorCodes } from "../src/internal/identity-linking/services/errors.js";
import {
  encryptCredentialUtf8,
  resolveMasterEncryptionKeyMaterial,
  unwrapOrganizationCredentialKey,
} from "../src/lib/crypto.js";
import { ensureCommitSignBinary } from "./helpers/commit-sign.js";
import { it } from "./test-context.js";
import type { ControlPlaneApiIntegrationFixture } from "./test-context.js";

const TestPrivateKeyPath = fileURLToPath(
  new URL("../../../packages/commit-sign/tests/fixtures/ed25519_private_key", import.meta.url),
);
const TestPrivateKey = readFileSync(TestPrivateKeyPath, "utf8");
const TestPublicKey =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILM+rvN+ot98qgEN796jTiQfZfG1KaT0PtFDJ/XFSqti user@example.com";
const IntegrationBootstrapConfig = {
  tokenSecret: "integration-bootstrap-token-secret",
  tokenIssuer: "integration-data-plane-worker",
  tokenAudience: "integration-data-plane-gateway",
} as const;

beforeAll(async () => {
  await ensureCommitSignBinary();
});

describe("internal identity-linking commit signing", () => {
  it("signs a commit payload with the linked Git SSH signing credential", async ({ fixture }) => {
    const session = await fixture.authSession({
      email: "internal-identity-linking-sign-commit-payload-success@example.com",
    });

    await insertGitHubSigningContext({
      fixture,
      organizationId: session.organizationId,
      userId: session.userId,
      principalId: "uep_sign_commit_success",
      providerConfigId: "ilp_sign_commit_success",
      connectionId: "icn_sign_commit_success",
      credentialId: "upc_sign_commit_success",
      publicKey: TestPublicKey,
      privateKey: TestPrivateKey,
    });
    const signingGrant = await mintSigningGrant({
      config: IntegrationBootstrapConfig,
      claims: {
        sub: "sbi_sign_commit_success",
        jti: randomUUID(),
        organizationId: session.organizationId,
        actingUserId: session.userId,
        providerFamily: "github",
        format: "ssh",
        keyRef: `key::${TestPublicKey}`,
      },
      ttlSeconds: 60,
    });

    const response = await fixture.request(
      `${INTERNAL_IDENTITY_LINKING_ROUTE_BASE_PATH}/sign-commit-payload`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: session.organizationId,
          sandboxInstanceId: "sbi_sign_commit_success",
          actingUserId: session.userId,
          providerFamily: "github",
          format: "ssh",
          keyRef: `key::${TestPublicKey}`,
          grant: signingGrant,
          payload: "c2lnbi1tZQ==",
          encoding: "base64",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      format: "ssh",
      signatureEncoding: "pem",
      signature: expect.stringMatching(
        /^-----BEGIN SSH SIGNATURE-----\n[\s\S]+-----END SSH SIGNATURE-----\n$/,
      ),
    });
  });

  it("returns 404 when no linked principal is available for the acting user", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "internal-identity-linking-sign-commit-payload-missing-principal@example.com",
    });

    await upsertGitHubTarget(fixture);
    await fixture.db.insert(integrationConnections).values({
      id: "icn_sign_commit_missing_principal",
      organizationId: session.organizationId,
      targetKey: "github-cloud",
      displayName: "GitHub Identity",
      status: IntegrationConnectionStatuses.ACTIVE,
      config: {
        connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
      },
    });
    await fixture.db.insert(organizationIdentityLinkProviderConfigs).values({
      id: "ilp_sign_commit_missing_principal",
      organizationId: session.organizationId,
      providerFamily: "github",
      status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
      integrationTargetKey: "github-cloud",
      integrationConnectionId: "icn_sign_commit_missing_principal",
      createdByUserId: session.userId,
      updatedByUserId: session.userId,
    });
    const signingGrant = await mintSigningGrant({
      config: IntegrationBootstrapConfig,
      claims: {
        sub: "sbi_sign_commit_missing_principal",
        jti: randomUUID(),
        organizationId: session.organizationId,
        actingUserId: session.userId,
        providerFamily: "github",
        format: "ssh",
        keyRef: `key::${TestPublicKey}`,
      },
      ttlSeconds: 60,
    });

    const response = await fixture.request(
      `${INTERNAL_IDENTITY_LINKING_ROUTE_BASE_PATH}/sign-commit-payload`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: session.organizationId,
          sandboxInstanceId: "sbi_sign_commit_missing_principal",
          actingUserId: session.userId,
          providerFamily: "github",
          format: "ssh",
          keyRef: `key::${TestPublicKey}`,
          grant: signingGrant,
          payload: "c2lnbi1tZQ==",
          encoding: "base64",
        }),
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: InternalIdentityLinkingErrorCodes.PRINCIPAL_NOT_FOUND,
      message: `No active linked principal was found for user '${session.userId}' and provider 'github'.`,
    });
  });

  it("returns 404 when the requested signing key does not match the linked credential", async ({
    fixture,
  }) => {
    const session = await fixture.authSession({
      email: "internal-identity-linking-sign-commit-payload-key-mismatch@example.com",
    });

    await insertGitHubSigningContext({
      fixture,
      organizationId: session.organizationId,
      userId: session.userId,
      principalId: "uep_sign_commit_key_mismatch",
      providerConfigId: "ilp_sign_commit_key_mismatch",
      connectionId: "icn_sign_commit_key_mismatch",
      credentialId: "upc_sign_commit_key_mismatch",
      publicKey: TestPublicKey,
      privateKey: TestPrivateKey,
    });
    const signingGrant = await mintSigningGrant({
      config: IntegrationBootstrapConfig,
      claims: {
        sub: "sbi_sign_commit_key_mismatch",
        jti: randomUUID(),
        organizationId: session.organizationId,
        actingUserId: session.userId,
        providerFamily: "github",
        format: "ssh",
        keyRef: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMismatch user@example.com",
      },
      ttlSeconds: 60,
    });

    const response = await fixture.request(
      `${INTERNAL_IDENTITY_LINKING_ROUTE_BASE_PATH}/sign-commit-payload`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: fixture.internalAuthServiceToken,
        },
        body: JSON.stringify({
          organizationId: session.organizationId,
          sandboxInstanceId: "sbi_sign_commit_key_mismatch",
          actingUserId: session.userId,
          providerFamily: "github",
          format: "ssh",
          keyRef: "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMismatch user@example.com",
          grant: signingGrant,
          payload: "c2lnbi1tZQ==",
          encoding: "base64",
        }),
      },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: InternalIdentityLinkingErrorCodes.CREDENTIAL_NOT_FOUND,
      message:
        "No active Git SSH signing credential matches requested key 'key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMismatch user@example.com'.",
    });
  });
});

async function upsertGitHubTarget(fixture: ControlPlaneApiIntegrationFixture): Promise<void> {
  await fixture.db
    .insert(integrationTargets)
    .values({
      targetKey: "github-cloud",
      familyId: "github",
      variantId: "github-cloud",
      enabled: true,
      config: {
        api_base_url: "https://api.github.com",
        web_base_url: "https://github.com",
      },
    })
    .onConflictDoUpdate({
      target: integrationTargets.targetKey,
      set: {
        familyId: "github",
        variantId: "github-cloud",
        enabled: true,
        config: {
          api_base_url: "https://api.github.com",
          web_base_url: "https://github.com",
        },
      },
    });
}

async function insertGitHubSigningContext(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  userId: string;
  principalId: string;
  providerConfigId: string;
  connectionId: string;
  credentialId: string;
  publicKey: string;
  privateKey: string;
}): Promise<void> {
  const existingOrganizationCredentialKey =
    await input.fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, input.organizationId),
    });
  if (existingOrganizationCredentialKey === undefined) {
    await insertInitialOrganizationCredentialKey({
      db: input.fixture.db,
      organizationId: input.organizationId,
      organizationCredentialKeyVersion: 1,
      masterEncryptionKeyVersion:
        input.fixture.config.integrations.activeMasterEncryptionKeyVersion,
      masterEncryptionKeys: input.fixture.config.integrations.masterEncryptionKeys,
    });
  }
  await upsertGitHubTarget(input.fixture);
  await input.fixture.db.insert(integrationConnections).values({
    id: input.connectionId,
    organizationId: input.organizationId,
    targetKey: "github-cloud",
    displayName: "GitHub Identity",
    status: IntegrationConnectionStatuses.ACTIVE,
    config: {
      connection_method: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    },
  });
  await input.fixture.db.insert(organizationIdentityLinkProviderConfigs).values({
    id: input.providerConfigId,
    organizationId: input.organizationId,
    providerFamily: "github",
    status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    integrationTargetKey: "github-cloud",
    integrationConnectionId: input.connectionId,
    createdByUserId: input.userId,
    updatedByUserId: input.userId,
  });
  await input.fixture.db.insert(userExternalPrincipals).values({
    id: input.principalId,
    organizationId: input.organizationId,
    userId: input.userId,
    providerFamily: "github",
    providerSubjectId: randomUUID(),
    organizationProviderConfigId: input.providerConfigId,
    integrationConnectionId: input.connectionId,
    status: UserExternalPrincipalStatuses.ACTIVE,
    profile: {
      login: "mistle-user",
      preferredEmail: "mistle-user@example.com",
    },
  });
  await input.fixture.db.insert(userExternalPrincipalCredentials).values({
    id: input.credentialId,
    organizationId: input.organizationId,
    principalId: input.principalId,
    providerFamily: "github",
    credentialKind: "git_ssh_signing_key",
    status: UserExternalPrincipalCredentialStatuses.ACTIVE,
  });
  await insertPrincipalCredentialSecret({
    fixture: input.fixture,
    organizationId: input.organizationId,
    credentialId: input.credentialId,
    secretKind: UserExternalPrincipalCredentialSecretKinds.GIT_SSH_PRIVATE_KEY,
    plaintext: input.privateKey,
    metadata: {
      publicKey: input.publicKey,
      publicKeyFingerprint: "SHA256:test-sign-commit-payload",
    },
  });
}

async function insertPrincipalCredentialSecret(input: {
  fixture: ControlPlaneApiIntegrationFixture;
  organizationId: string;
  credentialId: string;
  secretKind: UserExternalPrincipalCredentialSecretKind;
  plaintext: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const organizationCredentialKey =
    await input.fixture.db.query.organizationCredentialKeys.findFirst({
      where: (table, { eq }) => eq(table.organizationId, input.organizationId),
    });
  if (organizationCredentialKey === undefined) {
    throw new Error("Expected organization credential key.");
  }

  const masterEncryptionKeyMaterial = resolveMasterEncryptionKeyMaterial({
    masterKeyVersion: organizationCredentialKey.masterKeyVersion,
    masterEncryptionKeys: input.fixture.config.integrations.masterEncryptionKeys,
  });
  const organizationCredentialKeyMaterial = unwrapOrganizationCredentialKey({
    wrappedCiphertext: organizationCredentialKey.ciphertext,
    masterEncryptionKeyMaterial,
  });

  try {
    const encryptedSecret = encryptCredentialUtf8({
      plaintext: input.plaintext,
      organizationCredentialKey: organizationCredentialKeyMaterial,
    });

    await input.fixture.db.insert(userExternalPrincipalCredentialSecrets).values({
      organizationId: input.organizationId,
      credentialId: input.credentialId,
      secretKind: input.secretKind,
      ciphertext: encryptedSecret.ciphertext,
      nonce: encryptedSecret.nonce,
      organizationCredentialKeyVersion: organizationCredentialKey.version,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    });
  } finally {
    organizationCredentialKeyMaterial.fill(0);
  }
}
