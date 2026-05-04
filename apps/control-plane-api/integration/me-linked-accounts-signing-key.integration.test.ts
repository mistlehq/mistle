/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalCredentialSecretKinds,
  UserExternalPrincipalCredentialStatuses,
} from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import {
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { describe, expect } from "vitest";

import {
  GitSshSigningCredentialKind,
  GitSshSigningSecretMetadataSchema,
  parseGitSshSigningPrivateKeyOrThrow,
} from "../src/identity-linking/github-signing.js";
import { LinkedAccountsResponseSchema } from "../src/me/index.js";
import {
  decryptPrincipalCredentialSecret,
  insertGitHubSigningCredential,
  seedGitHubLinkedPrincipal,
  seedIdentityConnection,
  seedIdentityProviderConfig,
  seedPrincipalCredential,
  upsertGitHubIdentityTarget,
} from "./helpers/identity-linking.js";

const TestGitSigningPrivateKeyPath = fileURLToPath(
  new URL("../../../packages/commit-sign/tests/fixtures/ed25519_private_key", import.meta.url),
);
const TestGitSigningPrivateKey = readFileSync(TestGitSigningPrivateKeyPath, "utf8");
const TestGitSigningKeyMetadata = parseGitSshSigningPrivateKeyOrThrow(TestGitSigningPrivateKey);

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

describe.concurrent("me linked accounts signing key integration", () => {
  it("uploads a GitHub signing key and exposes a commit-signing summary", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-me-linked-accounts-upload-signing-key@example.com",
    });
    await seedGitHubLinkedAccount(env, {
      organizationId: session.organizationId,
      userId: session.userId,
      providerConfigId: "ilp_me_linked_accounts_signing_key_upload",
      connectionId: "icn_me_linked_accounts_signing_key_upload",
      principalId: "uep_me_linked_accounts_signing_key_upload",
    });

    const formData = new FormData();
    formData.set(
      "file",
      new File([TestGitSigningPrivateKey], "id_signing", {
        type: "application/octet-stream",
      }),
    );

    const uploadResponse = await env.controlPlaneApi.http.fetch(
      "/v1/me/linked-accounts/github/signing-key",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
        },
        body: formData,
      },
    );

    expect(uploadResponse.status).toBe(204);
    const signingCredential =
      await env.controlPlaneDb.query.userExternalPrincipalCredentials.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, session.organizationId),
            eq(table.principalId, "uep_me_linked_accounts_signing_key_upload"),
            eq(table.credentialKind, GitSshSigningCredentialKind),
            eq(table.status, UserExternalPrincipalCredentialStatuses.ACTIVE),
          ),
      });
    if (signingCredential === undefined) {
      throw new Error("Expected active GitHub signing credential.");
    }

    const signingSecret =
      await env.controlPlaneDb.query.userExternalPrincipalCredentialSecrets.findFirst({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, session.organizationId),
            eq(table.credentialId, signingCredential.id),
            eq(table.secretKind, UserExternalPrincipalCredentialSecretKinds.GIT_SSH_PRIVATE_KEY),
          ),
      });
    if (signingSecret === undefined) {
      throw new Error("Expected GitHub signing secret.");
    }
    expect(signingSecret.revokedAt).toBeNull();
    expect(GitSshSigningSecretMetadataSchema.parse(signingSecret.metadata)).toEqual({
      publicKey: TestGitSigningKeyMetadata.publicKey,
      publicKeyFingerprint: TestGitSigningKeyMetadata.publicKeyFingerprint,
    });
    await expect(
      decryptPrincipalCredentialSecret(env, {
        organizationId: session.organizationId,
        organizationCredentialKeyVersion: signingSecret.organizationCredentialKeyVersion,
        nonce: signingSecret.nonce,
        ciphertext: signingSecret.ciphertext,
      }),
    ).resolves.toBe(TestGitSigningPrivateKey.trim());

    const listResponse = await env.controlPlaneApi.http.fetch("/v1/me/linked-accounts", {
      headers: {
        cookie: session.cookie,
      },
    });
    expect(listResponse.status).toBe(200);
    const payload = LinkedAccountsResponseSchema.parse(await listResponse.json());
    expect(payload.linkedAccounts[0]?.commitSigning).toEqual({
      credentialId: signingCredential.id,
      publicKeyFingerprint: TestGitSigningKeyMetadata.publicKeyFingerprint,
      updatedAt: payload.linkedAccounts[0]?.commitSigning?.updatedAt ?? "",
    });
  });

  it("replaces an existing GitHub signing key by revoking the previous credential", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-me-linked-accounts-replace-signing-key@example.com",
    });
    await seedGitHubLinkedAccount(env, {
      organizationId: session.organizationId,
      userId: session.userId,
      providerConfigId: "ilp_me_linked_accounts_signing_key_replace",
      connectionId: "icn_me_linked_accounts_signing_key_replace",
      principalId: "uep_me_linked_accounts_signing_key_replace",
    });
    await insertGitHubSigningCredential(env, {
      organizationId: session.organizationId,
      principalId: "uep_me_linked_accounts_signing_key_replace",
      credentialId: "upc_me_linked_accounts_signing_key_replace_existing",
      privateKey: TestGitSigningPrivateKey,
      metadata: {
        publicKey: TestGitSigningKeyMetadata.publicKey,
        publicKeyFingerprint: TestGitSigningKeyMetadata.publicKeyFingerprint,
      },
    });

    const formData = new FormData();
    formData.set(
      "file",
      new File([TestGitSigningPrivateKey], "id_signing", {
        type: "application/octet-stream",
      }),
    );

    const uploadResponse = await env.controlPlaneApi.http.fetch(
      "/v1/me/linked-accounts/github/signing-key",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
        },
        body: formData,
      },
    );

    expect(uploadResponse.status).toBe(204);
    const signingCredentials =
      await env.controlPlaneDb.query.userExternalPrincipalCredentials.findMany({
        where: (table, { and, eq }) =>
          and(
            eq(table.organizationId, session.organizationId),
            eq(table.principalId, "uep_me_linked_accounts_signing_key_replace"),
            eq(table.credentialKind, GitSshSigningCredentialKind),
          ),
        orderBy: (table, { asc }) => [asc(table.createdAt)],
      });
    expect(signingCredentials).toHaveLength(2);
    expect(signingCredentials[0]?.status).toBe(UserExternalPrincipalCredentialStatuses.REVOKED);
    expect(signingCredentials[1]?.status).toBe(UserExternalPrincipalCredentialStatuses.ACTIVE);
  });

  it("removes a GitHub signing key", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-me-linked-accounts-delete-signing-key@example.com",
    });
    await seedGitHubLinkedAccount(env, {
      organizationId: session.organizationId,
      userId: session.userId,
      providerConfigId: "ilp_me_linked_accounts_signing_key_delete",
      connectionId: "icn_me_linked_accounts_signing_key_delete",
      principalId: "uep_me_linked_accounts_signing_key_delete",
    });
    await insertGitHubSigningCredential(env, {
      organizationId: session.organizationId,
      principalId: "uep_me_linked_accounts_signing_key_delete",
      credentialId: "upc_me_linked_accounts_signing_key_delete_existing",
      privateKey: TestGitSigningPrivateKey,
      metadata: {
        publicKey: TestGitSigningKeyMetadata.publicKey,
        publicKeyFingerprint: TestGitSigningKeyMetadata.publicKeyFingerprint,
      },
    });

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/me/linked-accounts/github/signing-key",
      {
        method: "DELETE",
        headers: {
          cookie: session.cookie,
        },
      },
    );

    expect(response.status).toBe(204);
    const signingCredential =
      await env.controlPlaneDb.query.userExternalPrincipalCredentials.findFirst({
        where: (table, { eq }) =>
          eq(table.id, "upc_me_linked_accounts_signing_key_delete_existing"),
      });
    expect(signingCredential?.status).toBe(UserExternalPrincipalCredentialStatuses.REVOKED);

    const signingSecret =
      await env.controlPlaneDb.query.userExternalPrincipalCredentialSecrets.findFirst({
        where: (table, { eq }) =>
          eq(table.credentialId, "upc_me_linked_accounts_signing_key_delete_existing"),
      });
    expect(signingSecret?.revokedAt).toBeTruthy();
  });

  it("rejects an invalid GitHub signing key upload", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-me-linked-accounts-invalid-signing-key@example.com",
    });
    await seedGitHubLinkedAccount(env, {
      organizationId: session.organizationId,
      userId: session.userId,
      providerConfigId: "ilp_me_linked_accounts_signing_key_invalid",
      connectionId: "icn_me_linked_accounts_signing_key_invalid",
      principalId: "uep_me_linked_accounts_signing_key_invalid",
    });

    const formData = new FormData();
    formData.set(
      "file",
      new File(["not-a-private-key"], "id_signing", {
        type: "text/plain",
      }),
    );

    const response = await env.controlPlaneApi.http.fetch(
      "/v1/me/linked-accounts/github/signing-key",
      {
        method: "PUT",
        headers: {
          cookie: session.cookie,
        },
        body: formData,
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      code: "INVALID_LINKED_ACCOUNT_SIGNING_KEY_INPUT",
      message: "GitHub signing key must be a valid SSH private key.",
    });
  });
});

async function seedGitHubLinkedAccount(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    userId: string;
    providerConfigId: string;
    connectionId: string;
    principalId: string;
  },
): Promise<void> {
  await upsertGitHubIdentityTarget(env);
  await seedIdentityConnection(env, {
    connectionId: input.connectionId,
    displayName: "GitHub Identity",
    methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    organizationId: input.organizationId,
    targetKey: "github-cloud",
  });
  await seedIdentityProviderConfig(env, {
    configId: input.providerConfigId,
    connectionId: input.connectionId,
    organizationId: input.organizationId,
    providerFamily: "github",
    status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    targetKey: "github-cloud",
    userId: input.userId,
  });
  await seedGitHubLinkedPrincipal(env, {
    organizationId: input.organizationId,
    userId: input.userId,
    principalId: input.principalId,
    providerConfigId: input.providerConfigId,
    connectionId: input.connectionId,
    profile: {
      login: "mistle-user",
      preferredEmail: "mistle-user@example.com",
      availableEmails: [
        {
          email: "mistle-user@example.com",
          primary: true,
          verified: true,
        },
      ],
    },
  });
  await seedPrincipalCredential(env, {
    credentialId: `upc_oauth_${input.principalId}`,
    organizationId: input.organizationId,
    principalId: input.principalId,
    providerFamily: "github",
    credentialKind: "github_app_user_access_token",
  });
}
