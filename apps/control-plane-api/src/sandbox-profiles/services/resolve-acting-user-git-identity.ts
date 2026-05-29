import {
  IntegrationConnectionStatuses,
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalCredentialSecretKinds,
  UserExternalPrincipalCredentialStatuses,
  UserExternalPrincipalStatuses,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import {
  GitHubProviderFamily,
  GitSshSigningCredentialKind,
  GitSshSigningSecretMetadataSchema,
} from "../../identity-linking/github-signing.js";
import { SandboxProfilesBadRequestCodes, SandboxProfilesBadRequestError } from "../errors.js";
import { resolveGitCommitSigningPolicy } from "./git-signing-policy.js";

const GitSigningProgram = "/opt/mistle/bin/mistle-ssh-sign";

const GitHubPrincipalProfileSchema = z
  .object({
    login: z.string().min(1),
    displayName: z.string().min(1).optional(),
    preferredEmail: z.email().optional(),
  })
  .loose();

export type SandboxActingUser = {
  userId: string;
};

export type SandboxGitIdentity = {
  name: string;
  email: string;
  signing?: {
    format: "ssh";
    program: string;
    keyRef: string;
    organizationId: string;
    providerFamily: string;
    integrationConnectionId: string;
    actingUserId: string;
  };
};

function createSigningRequiredError(input: {
  organizationId: string;
  userId: string;
  reason: string;
}): SandboxProfilesBadRequestError {
  return new SandboxProfilesBadRequestError(
    SandboxProfilesBadRequestCodes.GIT_SIGNING_CONFIGURATION_REQUIRED,
    `Git commit signing is required for user '${input.userId}' in organization '${input.organizationId}', but ${input.reason}.`,
  );
}

export async function resolveActingUserGitIdentity(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    actingUser?: SandboxActingUser;
    gitCommitSigningIntegrationConnectionId?: string | null;
  },
): Promise<SandboxGitIdentity | undefined> {
  const tables = getControlPlaneDatabaseSchema(db);

  const actingUser = input.actingUser;
  if (actingUser === undefined) {
    return undefined;
  }

  const githubProviderConfig = await resolveGitHubSigningProviderConfig(db, {
    organizationId: input.organizationId,
    integrationConnectionId: input.gitCommitSigningIntegrationConnectionId ?? null,
  });

  if (githubProviderConfig === null) {
    return undefined;
  }

  const gitCommitSigningPolicy = resolveGitCommitSigningPolicy({
    policy: githubProviderConfig.policy ?? null,
    gitCommitSigningIntegrationConnectionId: githubProviderConfig.integrationConnectionId,
  });
  const gitCommitSigningMode = gitCommitSigningPolicy.mode;

  const githubPrincipal = await db.query.userExternalPrincipals.findFirst({
    columns: {
      id: true,
      profile: true,
    },
    where: (table, { and, eq }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.userId, actingUser.userId),
        eq(table.providerFamily, GitHubProviderFamily),
        eq(table.organizationProviderConfigId, githubProviderConfig.id),
        eq(table.status, UserExternalPrincipalStatuses.ACTIVE),
      ),
  });

  if (githubPrincipal === undefined) {
    if (gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: actingUser.userId,
        reason: "no active GitHub linked principal is available",
      });
    }

    return undefined;
  }

  if (githubPrincipal.profile === null || githubPrincipal.profile === undefined) {
    if (gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: actingUser.userId,
        reason: "the GitHub principal profile is missing",
      });
    }

    return undefined;
  }

  const parsedProfile = GitHubPrincipalProfileSchema.safeParse(githubPrincipal.profile);
  if (!parsedProfile.success) {
    if (gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: actingUser.userId,
        reason: "the GitHub principal profile is invalid",
      });
    }

    return undefined;
  }

  const email = parsedProfile.data.preferredEmail?.trim();
  if (email === undefined || email.length === 0) {
    if (gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: actingUser.userId,
        reason: "the GitHub principal does not expose a usable preferred email",
      });
    }

    return undefined;
  }

  const displayName = parsedProfile.data.displayName?.trim();
  const name =
    displayName === undefined || displayName.length === 0 ? parsedProfile.data.login : displayName;

  if (gitCommitSigningMode === "disabled") {
    return {
      name,
      email,
    };
  }

  if (gitCommitSigningPolicy.format !== "ssh") {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.UNSUPPORTED_GIT_SIGNING_FORMAT,
      `Git commit signing format '${gitCommitSigningPolicy.format}' is not supported yet.`,
    );
  }

  const signingCredentialRows = await db
    .select({
      metadata: tables.userExternalPrincipalCredentialSecrets.metadata,
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
          UserExternalPrincipalCredentialSecretKinds.GIT_SSH_PRIVATE_KEY,
        ),
        isNull(tables.userExternalPrincipalCredentialSecrets.revokedAt),
      ),
    )
    .where(
      and(
        eq(tables.userExternalPrincipalCredentials.organizationId, input.organizationId),
        eq(tables.userExternalPrincipalCredentials.principalId, githubPrincipal.id),
        eq(tables.userExternalPrincipalCredentials.providerFamily, GitHubProviderFamily),
        eq(tables.userExternalPrincipalCredentials.credentialKind, GitSshSigningCredentialKind),
        eq(
          tables.userExternalPrincipalCredentials.status,
          UserExternalPrincipalCredentialStatuses.ACTIVE,
        ),
      ),
    );

  if (signingCredentialRows.length > 1) {
    if (gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: actingUser.userId,
        reason: "multiple active Git SSH signing credentials are configured",
      });
    }

    return {
      name,
      email,
    };
  }

  const signingCredential = signingCredentialRows[0];
  if (signingCredential === undefined) {
    if (gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: actingUser.userId,
        reason: "no active Git SSH signing credential is available",
      });
    }

    return {
      name,
      email,
    };
  }

  const parsedSigningMetadata = GitSshSigningSecretMetadataSchema.safeParse(
    signingCredential.metadata ?? {},
  );
  if (!parsedSigningMetadata.success) {
    if (gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: actingUser.userId,
        reason: "the Git SSH signing credential is missing public key metadata",
      });
    }

    return {
      name,
      email,
    };
  }

  const publicKey = parsedSigningMetadata.data.publicKey.trim();
  if (publicKey.length === 0) {
    if (gitCommitSigningMode === "required") {
      throw createSigningRequiredError({
        organizationId: input.organizationId,
        userId: actingUser.userId,
        reason: "the Git SSH signing credential has an empty public key",
      });
    }

    return {
      name,
      email,
    };
  }

  return {
    name,
    email,
    signing: {
      format: "ssh",
      program: GitSigningProgram,
      keyRef: `key::${publicKey}`,
      organizationId: input.organizationId,
      providerFamily: GitHubProviderFamily,
      integrationConnectionId: githubProviderConfig.integrationConnectionId,
      actingUserId: actingUser.userId,
    },
  };
}

async function resolveGitHubSigningProviderConfig(
  db: ControlPlaneDatabase,
  input: {
    organizationId: string;
    integrationConnectionId: string | null;
  },
): Promise<{
  id: string;
  integrationConnectionId: string;
  policy: unknown;
} | null> {
  if (input.integrationConnectionId === null) {
    return null;
  }

  const integrationConnectionId = input.integrationConnectionId;
  const [selectedConfig, selectedConnection] = await Promise.all([
    db.query.organizationIdentityLinkProviderConfigs.findFirst({
      columns: {
        id: true,
        integrationConnectionId: true,
        policy: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, input.organizationId),
          eq(table.providerFamily, GitHubProviderFamily),
          eq(table.integrationConnectionId, integrationConnectionId),
          eq(table.status, OrganizationIdentityLinkProviderConfigStatus.ACTIVE),
        ),
    }),
    db.query.integrationConnections.findFirst({
      columns: {
        id: true,
      },
      where: (table, { and, eq }) =>
        and(
          eq(table.organizationId, input.organizationId),
          eq(table.id, integrationConnectionId),
          eq(table.status, IntegrationConnectionStatuses.ACTIVE),
        ),
    }),
  ]);

  if (selectedConfig === undefined || selectedConnection === undefined) {
    throw new SandboxProfilesBadRequestError(
      SandboxProfilesBadRequestCodes.INVALID_GIT_SIGNING_CONFIG,
      "Selected GitHub commit-signing connection is not an active identity-linking configuration.",
    );
  }

  return selectedConfig;
}
