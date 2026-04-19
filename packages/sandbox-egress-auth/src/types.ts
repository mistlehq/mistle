export type EgressGrantConfig = {
  tokenSecret: string;
  tokenIssuer: string;
  tokenAudience: string;
};

export type EgressGrantAuthInjectionType = "bearer" | "basic" | "header" | "query" | "aws_sigv4";

export type EgressGrantCredentialHeaderInjection = {
  header: string;
  credentialResolver:
    | {
        kind: "integration_connection";
        connectionId: string;
        secretType: string;
        slotKey?: string;
        resolverKey?: string;
      }
    | {
        kind: "linked_principal";
        providerFamily: string;
        actingUserRequired: boolean;
        actingUserId?: string;
        credentialKind?: string;
      };
};

type EgressGrantClaimsBase = {
  sub: string;
  jti: string;
  bindingId: string;
  organizationId: string;
  familyId: string;
  variantId: string;
  upstreamBaseUrl: string;
  additionalHeaders?: Readonly<Record<string, string>>;
  additionalCredentialHeaders?: ReadonlyArray<EgressGrantCredentialHeaderInjection>;
  allowedMethods?: ReadonlyArray<string>;
  allowedPathPrefixes?: ReadonlyArray<string>;
  requestMiddleware?: ReadonlyArray<string>;
};

type IntegrationConnectionCredentialResolverClaims = {
  credentialResolverKind: "integration_connection";
  connectionId: string;
  secretType: string;
  slotKey?: string;
  resolverKey?: string;
};

type LinkedPrincipalCredentialResolverClaims = {
  credentialResolverKind: "linked_principal";
  providerFamily: string;
  actingUserRequired: boolean;
  actingUserId?: string;
  credentialKind?: string;
};

export type EgressGrantClaims =
  | (EgressGrantClaimsBase &
      (IntegrationConnectionCredentialResolverClaims | LinkedPrincipalCredentialResolverClaims) & {
        authInjectionType: "bearer" | "header" | "query";
        authInjectionTarget: string;
      })
  | (EgressGrantClaimsBase &
      (IntegrationConnectionCredentialResolverClaims | LinkedPrincipalCredentialResolverClaims) & {
        authInjectionType: "basic";
        authInjectionTarget: string;
        authInjectionUsername?: string;
      })
  | (EgressGrantClaimsBase &
      (IntegrationConnectionCredentialResolverClaims | LinkedPrincipalCredentialResolverClaims) & {
        authInjectionType: "aws_sigv4";
        authInjectionService: string;
        authInjectionRegion: string;
      });

type EgressGrantClaimsInputBase = {
  sub: string | undefined;
  jti: string | undefined;
  bindingId: string | undefined;
  organizationId: string | undefined;
  familyId: string | undefined;
  variantId: string | undefined;
  credentialResolverKind: unknown;
  connectionId?: string | undefined;
  secretType?: string | undefined;
  providerFamily?: string | undefined;
  actingUserRequired?: boolean | undefined;
  actingUserId?: string | undefined;
  credentialKind?: string | undefined;
  upstreamBaseUrl: string | undefined;
  additionalHeaders?: Readonly<Record<string, string>> | undefined;
  additionalCredentialHeaders?: ReadonlyArray<EgressGrantCredentialHeaderInjection> | undefined;
  slotKey?: string | undefined;
  resolverKey?: string | undefined;
  allowedMethods?: ReadonlyArray<string> | undefined;
  allowedPathPrefixes?: ReadonlyArray<string> | undefined;
  requestMiddleware?: ReadonlyArray<string> | undefined;
};

export type EgressGrantClaimsInput = EgressGrantClaimsInputBase & {
  authInjectionType: unknown;
  authInjectionTarget?: string | undefined;
  authInjectionUsername?: string | undefined;
  authInjectionService?: string | undefined;
  authInjectionRegion?: string | undefined;
};
