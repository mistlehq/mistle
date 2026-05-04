/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { OrganizationIdentityLinkProviderConfigStatus } from "@mistle/db/control-plane";
import { IntegrationConnectionMethodIds } from "@mistle/integrations-core";
import { mintSigningGrant } from "@mistle/sandbox-signing-auth";
import {
  createIntegrationTest,
  type IntegrationAuthenticatedSession,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { beforeAll, describe, expect } from "vitest";

import {
  CONTROL_PLANE_INTERNAL_AUTH_HEADER,
  INTERNAL_IDENTITY_LINKING_ROUTE_BASE_PATH,
} from "../src/internal/identity-linking/index.js";
import { InternalIdentityLinkingErrorCodes } from "../src/internal/identity-linking/services/errors.js";
import { SignCommitPayloadResponseSchema } from "../src/internal/identity-linking/sign-commit-payload/schema.js";
import { ensureCommitSignBinary } from "./helpers/commit-sign.js";
import {
  insertGitHubSigningCredential,
  seedGitHubLinkedPrincipal,
  seedIdentityConnection,
  seedIdentityProviderConfig,
  seedPrincipalCredential,
  upsertGitHubIdentityTarget,
} from "./helpers/identity-linking.js";

const TestPrivateKeyPath = fileURLToPath(
  new URL("../../../packages/commit-sign/tests/fixtures/ed25519_private_key", import.meta.url),
);
const TestPrivateKey = readFileSync(TestPrivateKeyPath, "utf8");
const TestPublicKey =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILM+rvN+ot98qgEN796jTiQfZfG1KaT0PtFDJ/XFSqti user@example.com";
const InternalServiceToken = "integration-new-internal-service-token";
const IntegrationBootstrapConfig = {
  tokenSecret: "integration-new-bootstrap-token-secret",
  tokenIssuer: "integration-new-data-plane-worker",
  tokenAudience: "integration-new-data-plane-gateway",
} as const;

const it = createIntegrationTest({
  services: ["control-plane-api"],
});

beforeAll(async () => {
  await ensureCommitSignBinary();
});

describe.concurrent("internal identity-linking commit signing", () => {
  it("signs a commit payload with the linked Git SSH signing credential", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-internal-sign-commit-success@example.com",
    });
    await seedGitHubSigningContext(env, {
      credentialId: "upc_internal_sign_commit_success",
      connectionId: "icn_internal_sign_commit_success",
      principalId: "uep_internal_sign_commit_success",
      providerConfigId: "ilp_internal_sign_commit_success",
      session,
      targetKey: "github-internal-sign-commit-success",
    });
    const signingGrant = await createSigningGrant({
      actingUserId: session.userId,
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_internal_sign_commit_success",
      keyRef: `key::${TestPublicKey}`,
    });

    const response = await signCommitPayload(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_internal_sign_commit_success",
      actingUserId: session.userId,
      providerFamily: "github",
      format: "ssh",
      keyRef: `key::${TestPublicKey}`,
      grant: signingGrant,
      payload: "c2lnbi1tZQ==",
      encoding: "base64",
    });

    expect(response.status).toBe(200);
    expect(SignCommitPayloadResponseSchema.parse(await response.json())).toEqual({
      format: "ssh",
      signatureEncoding: "pem",
      signature: expect.stringMatching(
        /^-----BEGIN SSH SIGNATURE-----\n[\s\S]+-----END SSH SIGNATURE-----\n$/u,
      ),
    });
  });

  it("returns 404 when no linked principal is available for the acting user", async ({ env }) => {
    const session = await env.auth.createSession({
      email: "integration-new-internal-sign-commit-missing-principal@example.com",
    });
    await seedGitHubIdentityProvider(env, {
      connectionId: "icn_internal_sign_commit_missing_principal",
      organizationId: session.organizationId,
      providerConfigId: "ilp_internal_sign_commit_missing_principal",
      targetKey: "github-internal-sign-commit-missing-principal",
      userId: session.userId,
    });
    const signingGrant = await createSigningGrant({
      actingUserId: session.userId,
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_internal_sign_commit_missing_principal",
      keyRef: `key::${TestPublicKey}`,
    });

    const response = await signCommitPayload(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_internal_sign_commit_missing_principal",
      actingUserId: session.userId,
      providerFamily: "github",
      format: "ssh",
      keyRef: `key::${TestPublicKey}`,
      grant: signingGrant,
      payload: "c2lnbi1tZQ==",
      encoding: "base64",
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: InternalIdentityLinkingErrorCodes.PRINCIPAL_NOT_FOUND,
      message: `No active linked principal was found for user '${session.userId}' and provider 'github'.`,
    });
  });

  it("returns 404 when the requested signing key does not match the linked credential", async ({
    env,
  }) => {
    const session = await env.auth.createSession({
      email: "integration-new-internal-sign-commit-key-mismatch@example.com",
    });
    await seedGitHubSigningContext(env, {
      credentialId: "upc_internal_sign_commit_key_mismatch",
      connectionId: "icn_internal_sign_commit_key_mismatch",
      principalId: "uep_internal_sign_commit_key_mismatch",
      providerConfigId: "ilp_internal_sign_commit_key_mismatch",
      session,
      targetKey: "github-internal-sign-commit-key-mismatch",
    });
    const mismatchedKeyRef = "key::ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMismatch user@example.com";
    const signingGrant = await createSigningGrant({
      actingUserId: session.userId,
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_internal_sign_commit_key_mismatch",
      keyRef: mismatchedKeyRef,
    });

    const response = await signCommitPayload(env, {
      organizationId: session.organizationId,
      sandboxInstanceId: "sbi_internal_sign_commit_key_mismatch",
      actingUserId: session.userId,
      providerFamily: "github",
      format: "ssh",
      keyRef: mismatchedKeyRef,
      grant: signingGrant,
      payload: "c2lnbi1tZQ==",
      encoding: "base64",
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      code: InternalIdentityLinkingErrorCodes.CREDENTIAL_NOT_FOUND,
      message: `No active Git SSH signing credential matches requested key '${mismatchedKeyRef}'.`,
    });
  });
});

async function seedGitHubSigningContext(
  env: IntegrationTestEnvironment,
  input: {
    session: IntegrationAuthenticatedSession;
    targetKey: string;
    connectionId: string;
    providerConfigId: string;
    principalId: string;
    credentialId: string;
  },
): Promise<void> {
  await seedGitHubIdentityProvider(env, {
    connectionId: input.connectionId,
    organizationId: input.session.organizationId,
    providerConfigId: input.providerConfigId,
    targetKey: input.targetKey,
    userId: input.session.userId,
  });
  await seedGitHubLinkedPrincipal(env, {
    organizationId: input.session.organizationId,
    userId: input.session.userId,
    principalId: input.principalId,
    providerConfigId: input.providerConfigId,
    connectionId: input.connectionId,
    providerSubjectId: randomUUID(),
    profile: {
      login: "mistle-user",
      preferredEmail: "mistle-user@example.com",
    },
  });
  await seedPrincipalCredential(env, {
    credentialId: `upc_oauth_${input.principalId}`,
    organizationId: input.session.organizationId,
    principalId: input.principalId,
    providerFamily: "github",
    credentialKind: "github_app_user_access_token",
  });
  await insertGitHubSigningCredential(env, {
    organizationId: input.session.organizationId,
    principalId: input.principalId,
    credentialId: input.credentialId,
    privateKey: TestPrivateKey,
    metadata: {
      publicKey: TestPublicKey,
      publicKeyFingerprint: "SHA256:test-sign-commit-payload",
    },
  });
}

async function seedGitHubIdentityProvider(
  env: IntegrationTestEnvironment,
  input: {
    organizationId: string;
    userId: string;
    targetKey: string;
    connectionId: string;
    providerConfigId: string;
  },
): Promise<void> {
  await upsertGitHubIdentityTarget(env, {
    targetKey: input.targetKey,
  });
  await seedIdentityConnection(env, {
    connectionId: input.connectionId,
    displayName: "GitHub Identity",
    methodId: IntegrationConnectionMethodIds.GITHUB_APP_INSTALLATION,
    organizationId: input.organizationId,
    targetKey: input.targetKey,
  });
  await seedIdentityProviderConfig(env, {
    configId: input.providerConfigId,
    connectionId: input.connectionId,
    organizationId: input.organizationId,
    providerFamily: "github",
    status: OrganizationIdentityLinkProviderConfigStatus.ACTIVE,
    targetKey: input.targetKey,
    userId: input.userId,
  });
}

async function createSigningGrant(input: {
  organizationId: string;
  actingUserId: string;
  sandboxInstanceId: string;
  keyRef: string;
}): Promise<string> {
  return await mintSigningGrant({
    config: IntegrationBootstrapConfig,
    claims: {
      sub: input.sandboxInstanceId,
      jti: randomUUID(),
      organizationId: input.organizationId,
      actingUserId: input.actingUserId,
      providerFamily: "github",
      format: "ssh",
      keyRef: input.keyRef,
    },
    ttlSeconds: 60,
  });
}

async function signCommitPayload(
  env: IntegrationTestEnvironment,
  body: {
    organizationId: string;
    sandboxInstanceId: string;
    actingUserId: string;
    providerFamily: string;
    format: "ssh";
    keyRef: string;
    grant: string;
    payload: string;
    encoding: "base64";
  },
) {
  return await env.controlPlaneApi.http.fetch(
    `${INTERNAL_IDENTITY_LINKING_ROUTE_BASE_PATH}/sign-commit-payload`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [CONTROL_PLANE_INTERNAL_AUTH_HEADER]: InternalServiceToken,
      },
      body: JSON.stringify(body),
    },
  );
}
