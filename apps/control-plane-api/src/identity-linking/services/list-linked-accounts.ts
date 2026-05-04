import {
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalCredentialSecretKinds,
  UserExternalPrincipalCredentialStatuses,
  type UserExternalPrincipalCredentialStatus,
  type UserExternalPrincipalStatus,
  UserExternalPrincipalStatuses,
  type ControlPlaneDatabase,
  getControlPlaneDatabaseSchema,
} from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { and, eq, inArray, isNull } from "drizzle-orm";

import {
  GitSshSigningCredentialKind,
  GitSshSigningSecretMetadataSchema,
} from "../github-signing.js";
import {
  IdentityLinkProviderConfigurationStatus,
  listOrganizationIdentityLinkProviders,
} from "./list-organization-identity-link-providers.js";

function rankPrincipalStatus(status: UserExternalPrincipalStatus): number {
  if (status === UserExternalPrincipalStatuses.ACTIVE) {
    return 2;
  }

  if (status === UserExternalPrincipalStatuses.REAUTHORIZATION_REQUIRED) {
    return 1;
  }

  return 0;
}

function rankCredentialStatus(status: UserExternalPrincipalCredentialStatus): number {
  if (status === UserExternalPrincipalCredentialStatuses.ACTIVE) {
    return 3;
  }

  if (status === UserExternalPrincipalCredentialStatuses.REAUTHORIZATION_REQUIRED) {
    return 2;
  }

  if (status === UserExternalPrincipalCredentialStatuses.EXPIRED) {
    return 1;
  }

  return 0;
}

function toLinkedAccountPrincipalStatus(
  status: UserExternalPrincipalStatus,
): LinkedAccountPrincipalSummary["status"] {
  return status === UserExternalPrincipalStatuses.ACTIVE
    ? UserExternalPrincipalStatuses.ACTIVE
    : UserExternalPrincipalStatuses.REAUTHORIZATION_REQUIRED;
}

function toLinkedAccountCredentialStatus(
  status: UserExternalPrincipalCredentialStatus,
): LinkedAccountCredentialSummary["status"] {
  if (status === UserExternalPrincipalCredentialStatuses.ACTIVE) {
    return UserExternalPrincipalCredentialStatuses.ACTIVE;
  }

  if (status === UserExternalPrincipalCredentialStatuses.EXPIRED) {
    return UserExternalPrincipalCredentialStatuses.EXPIRED;
  }

  return UserExternalPrincipalCredentialStatuses.REAUTHORIZATION_REQUIRED;
}

export type LinkedAccountPrincipalSummary = {
  id: string;
  status: Exclude<UserExternalPrincipalStatus, typeof UserExternalPrincipalStatuses.UNLINKED>;
  providerSubjectId: string | null;
  profile: Record<string, unknown> | null;
  linkedAt: string;
  updatedAt: string;
};

export type LinkedAccountCredentialSummary = {
  id: string;
  credentialKind: string;
  status: Exclude<
    UserExternalPrincipalCredentialStatus,
    typeof UserExternalPrincipalCredentialStatuses.REVOKED
  >;
  accessTokenExpiresAt: string | null;
  refreshTokenExpiresAt: string | null;
  lastValidatedAt: string | null;
  updatedAt: string;
};

export type LinkedAccount = {
  providerFamily: string;
  displayName: string;
  logoKey: string;
  configurationStatus: Exclude<
    IdentityLinkProviderConfigurationStatus,
    typeof IdentityLinkProviderConfigurationStatus.UNCONFIGURED
  >;
  principal: LinkedAccountPrincipalSummary | null;
  credential: LinkedAccountCredentialSummary | null;
  commitSigning: LinkedAccountCommitSigningSummary | null;
};

export type LinkedAccountCommitSigningSummary = {
  credentialId: string;
  publicKeyFingerprint: string;
  updatedAt: string;
};

export async function listLinkedAccounts(
  ctx: {
    db: ControlPlaneDatabase;
    integrationRegistry: IntegrationRegistry;
  },
  input: {
    organizationId: string;
    userId: string;
  },
): Promise<LinkedAccount[]> {
  const tables = getControlPlaneDatabaseSchema(ctx.db);

  const configuredProviders = (await listOrganizationIdentityLinkProviders(ctx, input)).filter(
    (provider) =>
      provider.configurationStatus !== IdentityLinkProviderConfigurationStatus.UNCONFIGURED,
  );

  if (configuredProviders.length === 0) {
    return [];
  }

  const providerFamilies = configuredProviders.map((provider) => provider.providerFamily);
  const candidatePrincipals = await ctx.db.query.userExternalPrincipals.findMany({
    columns: {
      id: true,
      providerFamily: true,
      status: true,
      providerSubjectId: true,
      profile: true,
      linkedAt: true,
      updatedAt: true,
    },
    where: (table, { and, eq, inArray, ne }) =>
      and(
        eq(table.organizationId, input.organizationId),
        eq(table.userId, input.userId),
        inArray(table.providerFamily, providerFamilies),
        ne(table.status, UserExternalPrincipalStatuses.UNLINKED),
      ),
  });

  const principalsByProviderFamily = new Map<string, (typeof candidatePrincipals)[number]>();
  for (const principal of candidatePrincipals) {
    const existing = principalsByProviderFamily.get(principal.providerFamily);
    if (
      existing === undefined ||
      rankPrincipalStatus(principal.status) > rankPrincipalStatus(existing.status)
    ) {
      principalsByProviderFamily.set(principal.providerFamily, principal);
    }
  }

  const selectedPrincipalIds = [...principalsByProviderFamily.values()].map(
    (principal) => principal.id,
  );
  const candidateCredentials =
    selectedPrincipalIds.length === 0
      ? []
      : await ctx.db.query.userExternalPrincipalCredentials.findMany({
          columns: {
            id: true,
            principalId: true,
            credentialKind: true,
            status: true,
            accessTokenExpiresAt: true,
            refreshTokenExpiresAt: true,
            lastValidatedAt: true,
            updatedAt: true,
          },
          where: (table, { and, inArray, ne }) =>
            and(
              eq(table.organizationId, input.organizationId),
              inArray(table.principalId, selectedPrincipalIds),
              ne(table.credentialKind, GitSshSigningCredentialKind),
              ne(table.status, UserExternalPrincipalCredentialStatuses.REVOKED),
            ),
        });

  const credentialsByPrincipalId = new Map<string, (typeof candidateCredentials)[number]>();
  for (const credential of candidateCredentials) {
    const existing = credentialsByPrincipalId.get(credential.principalId);
    if (
      existing === undefined ||
      rankCredentialStatus(credential.status) > rankCredentialStatus(existing.status)
    ) {
      credentialsByPrincipalId.set(credential.principalId, credential);
    }
  }

  const commitSigningRows =
    selectedPrincipalIds.length === 0
      ? []
      : await ctx.db
          .select({
            principalId: tables.userExternalPrincipalCredentials.principalId,
            credentialId: tables.userExternalPrincipalCredentials.id,
            metadata: tables.userExternalPrincipalCredentialSecrets.metadata,
            updatedAt: tables.userExternalPrincipalCredentials.updatedAt,
          })
          .from(tables.userExternalPrincipalCredentials)
          .innerJoin(
            tables.userExternalPrincipalCredentialSecrets,
            and(
              eq(
                tables.userExternalPrincipalCredentialSecrets.organizationId,
                input.organizationId,
              ),
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
              inArray(tables.userExternalPrincipalCredentials.principalId, selectedPrincipalIds),
              eq(
                tables.userExternalPrincipalCredentials.credentialKind,
                GitSshSigningCredentialKind,
              ),
              eq(
                tables.userExternalPrincipalCredentials.status,
                UserExternalPrincipalCredentialStatuses.ACTIVE,
              ),
            ),
          );

  const commitSigningByPrincipalId = new Map<string, LinkedAccountCommitSigningSummary>();
  for (const row of commitSigningRows) {
    if (commitSigningByPrincipalId.has(row.principalId)) {
      throw new Error(
        `Multiple active Git SSH signing credentials were found for principal '${row.principalId}'.`,
      );
    }

    const parsedMetadata = GitSshSigningSecretMetadataSchema.safeParse(row.metadata ?? {});
    if (!parsedMetadata.success) {
      throw new Error(
        `Git SSH signing credential '${row.credentialId}' is missing required metadata.`,
      );
    }

    commitSigningByPrincipalId.set(row.principalId, {
      credentialId: row.credentialId,
      publicKeyFingerprint: parsedMetadata.data.publicKeyFingerprint,
      updatedAt: row.updatedAt,
    });
  }

  return configuredProviders.map((provider) => {
    const principal = principalsByProviderFamily.get(provider.providerFamily);
    const credential =
      principal === undefined ? undefined : credentialsByPrincipalId.get(principal.id);
    const commitSigning =
      principal === undefined ? undefined : commitSigningByPrincipalId.get(principal.id);

    return {
      providerFamily: provider.providerFamily,
      displayName: provider.displayName,
      logoKey: provider.logoKey,
      configurationStatus:
        provider.configurationStatus === OrganizationIdentityLinkProviderConfigStatus.ACTIVE
          ? OrganizationIdentityLinkProviderConfigStatus.ACTIVE
          : OrganizationIdentityLinkProviderConfigStatus.DISABLED,
      principal:
        principal === undefined
          ? null
          : {
              id: principal.id,
              status: toLinkedAccountPrincipalStatus(principal.status),
              providerSubjectId: principal.providerSubjectId,
              profile: principal.profile ?? null,
              linkedAt: principal.linkedAt,
              updatedAt: principal.updatedAt,
            },
      credential:
        credential === undefined
          ? null
          : {
              id: credential.id,
              credentialKind: credential.credentialKind,
              status: toLinkedAccountCredentialStatus(credential.status),
              accessTokenExpiresAt: credential.accessTokenExpiresAt ?? null,
              refreshTokenExpiresAt: credential.refreshTokenExpiresAt ?? null,
              lastValidatedAt: credential.lastValidatedAt ?? null,
              updatedAt: credential.updatedAt,
            },
      commitSigning: commitSigning ?? null,
    };
  });
}
