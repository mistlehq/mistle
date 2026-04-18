import type {
  IntegrationConnection,
  IntegrationTarget,
  OrganizationIdentityLinkProviderConfig,
  UserExternalPrincipalCredentialSecretKind,
} from "@mistle/db/control-plane";

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
    organizationId: string;
    userId: string;
    providerFamily: string;
    organizationProviderConfig: OrganizationIdentityLinkProviderConfig;
    integrationConnection: IntegrationConnection;
    integrationTarget: IntegrationTarget;
    state: string;
    redirectUrl: string;
  }): Promise<{
    authorizationUrl: string;
    pkceVerifier?: string;
    providerState?: Record<string, unknown>;
  }>;
  completeAuthorization(input: {
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
  }): Promise<CompletedLinkedAccountAuthorization>;
};

export function resolveIdentityLinkProviderAdapter(
  _providerFamily: string,
): IdentityLinkProviderAdapter | undefined {
  return undefined;
}
