import {
  OrganizationIdentityLinkProviderConfigStatus,
  UserExternalPrincipalCredentialStatuses,
  type UserExternalPrincipalCredentialStatus,
  type UserExternalPrincipalStatus,
  UserExternalPrincipalStatuses,
  type ControlPlaneDatabase,
} from "@mistle/db/control-plane";
import type { IntegrationRegistry } from "@mistle/integrations-core";
import { eq } from "drizzle-orm";

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

  return configuredProviders.map((provider) => {
    const principal = principalsByProviderFamily.get(provider.providerFamily);
    const credential =
      principal === undefined ? undefined : credentialsByPrincipalId.get(principal.id);

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
    };
  });
}
