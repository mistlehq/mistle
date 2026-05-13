import type { ControlPlaneDatabase } from "@mistle/db/control-plane";
import { buildUrlWithPath } from "@mistle/http";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { GitHubTargetConfigSchema } from "@mistle/integrations-definitions";
import { z } from "zod";

import { GitHubProviderFamily, parseGitSshSigningPrivateKeyOrThrow } from "../github-signing.js";
import {
  DefaultCommitSignBinaryPath,
  runCommitSignBinary,
  SshSigningFormat,
} from "./commit-sign-binary.js";
import { resolveActiveGitHubLinkedPrincipalOrThrow } from "./upsert-github-linked-account-signing-key.js";

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

const GitHubPrincipalProfileSchema = z
  .object({
    login: z.string().min(1),
  })
  .loose();

export type GitHubLinkedAccountSigningKeyCheckStatus = "registered" | "not_registered";

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

function resolveGitHubPrincipalLoginOrThrow(profile: unknown): string {
  return GitHubPrincipalProfileSchema.parse(profile).login;
}

async function resolveGitHubSigningKeyLookupContextOrThrow(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    principalId: string;
  },
): Promise<{
  apiBaseUrl: string;
  login: string;
}> {
  const principal = await ctx.db.query.userExternalPrincipals.findFirst({
    columns: {
      integrationConnectionId: true,
      profile: true,
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
  const login = resolveGitHubPrincipalLoginOrThrow(principal.profile);

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

  return {
    apiBaseUrl: GitHubTargetConfigSchema.parse(target.config).apiBaseUrl,
    login,
  };
}

async function listGitHubSshSigningKeys(input: {
  apiBaseUrl: string;
  login: string;
}): Promise<readonly GitHubSshSigningKey[]> {
  const url = new URL(
    buildUrlWithPath(
      input.apiBaseUrl,
      `/users/${encodeURIComponent(input.login)}/ssh_signing_keys`,
    ),
  );
  url.searchParams.set("per_page", "100");

  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": GitHubApiVersion,
    },
  });

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

  const lookupContext = await resolveGitHubSigningKeyLookupContextOrThrow(ctx, {
    organizationId: input.organizationId,
    principalId,
  });
  const gitHubSigningKeys = await listGitHubSshSigningKeys({
    apiBaseUrl: lookupContext.apiBaseUrl,
    login: lookupContext.login,
  });

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
