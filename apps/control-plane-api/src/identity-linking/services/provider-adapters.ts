import type {
  ControlPlaneDatabase,
  IntegrationConnection,
  IntegrationTarget,
  OrganizationIdentityLinkProviderConfig,
  UserExternalPrincipalCredentialSecretKind,
} from "@mistle/db/control-plane";

import { GitHubIdentityLinkProviderAdapter } from "./github-provider-adapter.js";

type LinkedAccountCredentialSecret = {
  secretKind: UserExternalPrincipalCredentialSecretKind;
  plaintext: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
};

type LinkedAccountPrincipalKey = {
  keyType: string;
  keyValue: string;
};

export type CompletedLinkedAccountAuthorization = {
  providerSubjectId: string;
  profile?: Record<string, unknown>;
  keys: [LinkedAccountPrincipalKey, ...LinkedAccountPrincipalKey[]];
  credential?: {
    credentialKind: string;
    scopes?: string[];
    accessTokenExpiresAt?: string;
    refreshTokenExpiresAt?: string;
    secrets: LinkedAccountCredentialSecret[];
  };
};

export type IdentityLinkProviderAdapter = {
  startAuthorization(input: {
    db: ControlPlaneDatabase;
    organizationId: string;
    userId: string;
    providerFamily: string;
    organizationProviderConfig: OrganizationIdentityLinkProviderConfig;
    integrationConnection: IntegrationConnection;
    integrationTarget: IntegrationTarget;
    state: string;
    redirectUrl: string;
    integrationsConfig: {
      masterEncryptionKeys: Record<string, string>;
    };
  }): Promise<{
    authorizationUrl: string;
    pkceVerifier?: string;
    providerState?: Record<string, unknown>;
  }>;
  completeAuthorization(input: {
    db: ControlPlaneDatabase;
    organizationId: string;
    userId: string;
    providerFamily: string;
    organizationProviderConfig: OrganizationIdentityLinkProviderConfig;
    integrationConnection: IntegrationConnection;
    integrationTarget: IntegrationTarget;
    query: URLSearchParams;
    redirectUrl: string;
    pkceVerifier?: string;
    providerState?: Record<string, unknown>;
    integrationsConfig: {
      masterEncryptionKeys: Record<string, string>;
    };
  }): Promise<CompletedLinkedAccountAuthorization>;
};

export function resolveIdentityLinkProviderAdapter(
  providerFamily: string,
): IdentityLinkProviderAdapter | undefined {
  if (providerFamily === "github") {
    return GitHubIdentityLinkProviderAdapter;
  }

  return undefined;
}
