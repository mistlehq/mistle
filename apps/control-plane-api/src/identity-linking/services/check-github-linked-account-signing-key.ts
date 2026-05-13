import {
  UserExternalPrincipalCredentialSecretKinds,
  UserExternalPrincipalCredentialStatuses,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { buildUrlWithPath } from "@mistle/http";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { GitHubTargetConfigSchema } from "@mistle/integrations-definitions";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { decryptOrganizationBackedValue } from "../../sandbox-storage/services/credential-crypto.js";
import { GitHubProviderFamily, parseGitSshSigningPrivateKeyOrThrow } from "../github-signing.js";
import {
  DefaultCommitSignBinaryPath,
  runCommitSignBinary,
  SshSigningFormat,
} from "./commit-sign-binary.js";
import { resolveActiveGitHubLinkedPrincipalOrThrow } from "./upsert-github-linked-account-signing-key.js";

const GitHubUserAccessTokenCredentialKind = "github_app_user_access_token";
const GitHubApiVersion = "2026-03-10";
const CheckSigningPayloadBase64 = Buffer.from(
  "mistle github linked-account signing key check",
  "utf8",
).toString("base64");

const GitHubSshSigningKeySchema = z
  .object({
    key: z.string().min(1),
  })
  .loose();

const GitHubSshSigningKeysResponseSchema = z.array(GitHubSshSigningKeySchema);

type GitHubSshSigningKey = z.infer<typeof GitHubSshSigningKeySchema>;

export type GitHubLinkedAccountSigningKeyCheckStatus =
  | "registered"
  | "not_registered"
  | "permission_missing";

export type GitHubLinkedAccountSigningKeyCheckResult = {
  status: GitHubLinkedAccountSigningKeyCheckStatus;
  publicKey: string;
  publicKeyFingerprint: string;
};

function splitPublicKey(publicKey: string): readonly string[] {
  return publicKey.trim().split(/\s+/u);
}

function sshPublicKeysMatch(input: {
  uploadedPublicKey: string;
  githubPublicKey: string;
}): boolean {
  const uploadedPublicKey = input.uploadedPublicKey.trim();
  const githubPublicKey = input.githubPublicKey.trim();
  if (githubPublicKey === uploadedPublicKey) {
    return true;
  }

  const uploadedParts = splitPublicKey(uploadedPublicKey);
  const githubParts = splitPublicKey(githubPublicKey);
  const uploadedKeyBody = uploadedParts[1];
  if (uploadedKeyBody === undefined) {
    throw new Error("Parsed Git SSH signing public key is missing key material.");
  }

  return githubPublicKey === uploadedKeyBody || githubParts[1] === uploadedKeyBody;
}

async function resolveGitHubApiBaseUrlOrThrow(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    principalId: string;
  },
): Promise<string> {
  const principal = await ctx.db.query.userExternalPrincipals.findFirst({
    columns: {
      integrationConnectionId: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.id, input.principalId),
        eq(table.providerFamily, GitHubProviderFamily),
      ),
  });
  if (principal === undefined) {
    throw new Error(`GitHub linked principal '${input.principalId}' was not found.`);
  }

  const connection = await ctx.db.query.integrationConnections.findFirst({
    columns: {
      targetKey: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.id, principal.integrationConnectionId),
      ),
  });
  if (connection === undefined) {
    throw new Error(
      `GitHub linked principal '${input.principalId}' references missing integration connection '${principal.integrationConnectionId}'.`,
    );
  }

  const target = await ctx.db.query.integrationTargets.findFirst({
    columns: {
      familyId: true,
      variantId: true,
      targetKey: true,
      config: true,
    },
    where: (table, { eq }) => eq(table.targetKey, connection.targetKey),
  });
  if (target === undefined) {
    throw new Error(`GitHub integration target '${connection.targetKey}' was not found.`);
  }

  const definition = ctx.integrationRegistry.getDefinition({
    familyId: target.familyId,
    variantId: target.variantId,
  });
  if (definition === undefined) {
    throw new Error(
      `Integration definition '${target.familyId}/${target.variantId}' is not registered.`,
    );
  }

  return GitHubTargetConfigSchema.parse(target.config).apiBaseUrl;
}

async function resolveGitHubAccessTokenOrThrow(
  ctx: {
    db: ControlPlaneDatabase;
    integrationsConfig: {
      masterEncryptionKeys: Record<string, string>;
    };
  },
  input: {
    organizationId: string;
    principalId: string;
  },
): Promise<string> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);
  const tokenSecrets = await ctx.db
    .select({
      credentialId: tables.userExternalPrincipalCredentials.id,
      ciphertext: tables.userExternalPrincipalCredentialSecrets.ciphertext,
      nonce: tables.userExternalPrincipalCredentialSecrets.nonce,
      organizationCredentialKeyVersion:
        tables.userExternalPrincipalCredentialSecrets.organizationCredentialKeyVersion,
    })
    .from(tables.userExternalPrincipalCredentials)
    .innerJoin(
      tables.userExternalPrincipalCredentialSecrets,
      and(
        eq(tables.userExternalPrincipalCredentialSecrets.organizationId, input.organizationId),
        eq(
          tables.userExternalPrincipalCredentialSecrets.credentialId,
          tables.userExternalPrincipalCredentials.id,
        ),
        eq(
          tables.userExternalPrincipalCredentialSecrets.secretKind,
          UserExternalPrincipalCredentialSecretKinds.OAUTH2_ACCESS_TOKEN,
        ),
        isNull(tables.userExternalPrincipalCredentialSecrets.revokedAt),
      ),
    )
    .where(
      and(
        eq(tables.userExternalPrincipalCredentials.organizationId, input.organizationId),
        eq(tables.userExternalPrincipalCredentials.principalId, input.principalId),
        eq(tables.userExternalPrincipalCredentials.providerFamily, GitHubProviderFamily),
        eq(
          tables.userExternalPrincipalCredentials.credentialKind,
          GitHubUserAccessTokenCredentialKind,
        ),
        eq(
          tables.userExternalPrincipalCredentials.status,
          UserExternalPrincipalCredentialStatuses.ACTIVE,
        ),
      ),
    );

  if (tokenSecrets.length === 0) {
    throw new Error(
      `Active GitHub linked principal '${input.principalId}' is missing an OAuth access token secret.`,
    );
  }

  if (tokenSecrets.length > 1) {
    throw new Error(
      `Active GitHub linked principal '${input.principalId}' has multiple OAuth access token secrets.`,
    );
  }

  const tokenSecret = tokenSecrets[0];
  if (tokenSecret === undefined) {
    throw new Error("Expected GitHub OAuth access token secret candidate.");
  }

  return await decryptOrganizationBackedValue({
    db: ctx.db,
    organizationId: input.organizationId,
    ciphertext: tokenSecret.ciphertext,
    nonce: tokenSecret.nonce,
    organizationCredentialKeyVersion: tokenSecret.organizationCredentialKeyVersion,
    encryptionConfig: ctx.integrationsConfig,
  });
}

async function listGitHubSshSigningKeys(input: {
  apiBaseUrl: string;
  accessToken: string;
}): Promise<"permission_missing" | readonly GitHubSshSigningKey[]> {
  const url = new URL(buildUrlWithPath(input.apiBaseUrl, "/user/ssh_signing_keys"));
  url.searchParams.set("per_page", "100");

  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${input.accessToken}`,
      "x-github-api-version": GitHubApiVersion,
    },
  });

  if (response.status === 403) {
    return "permission_missing";
  }

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `GitHub SSH signing key lookup failed with status ${response.status.toString()}.${responseText.length === 0 ? "" : ` Response body: ${responseText}`}`,
    );
  }

  const payload: unknown = await response.json();
  return GitHubSshSigningKeysResponseSchema.parse(payload);
}

export async function checkGitHubLinkedAccountSigningKey(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
    integrationsConfig: {
      masterEncryptionKeys: Record<string, string>;
    };
    commitSignConfig?: {
      binaryPath: string;
    };
  },
  input: {
    organizationId: string;
    userId: string;
    privateKey: string;
  },
): Promise<GitHubLinkedAccountSigningKeyCheckResult> {
  const principalId = await resolveActiveGitHubLinkedPrincipalOrThrow(ctx, input);
  const parsedSigningKey = parseGitSshSigningPrivateKeyOrThrow(input.privateKey);
  await runCommitSignBinary({
    binaryPath: ctx.commitSignConfig?.binaryPath ?? DefaultCommitSignBinaryPath,
    format: SshSigningFormat,
    privateKey: parsedSigningKey.privateKey,
    payloadBase64: CheckSigningPayloadBase64,
  });

  const [apiBaseUrl, accessToken] = await Promise.all([
    resolveGitHubApiBaseUrlOrThrow(ctx, {
      organizationId: input.organizationId,
      principalId,
    }),
    resolveGitHubAccessTokenOrThrow(ctx, {
      organizationId: input.organizationId,
      principalId,
    }),
  ]);
  const gitHubSigningKeys = await listGitHubSshSigningKeys({
    apiBaseUrl,
    accessToken,
  });

  if (gitHubSigningKeys === "permission_missing") {
    return {
      status: "permission_missing",
      publicKey: parsedSigningKey.publicKey,
      publicKeyFingerprint: parsedSigningKey.publicKeyFingerprint,
    };
  }

  const isRegistered = gitHubSigningKeys.some((candidate) =>
    sshPublicKeysMatch({
      uploadedPublicKey: parsedSigningKey.publicKey,
      githubPublicKey: candidate.key,
    }),
  );

  return {
    status: isRegistered ? "registered" : "not_registered",
    publicKey: parsedSigningKey.publicKey,
    publicKeyFingerprint: parsedSigningKey.publicKeyFingerprint,
  };
}
