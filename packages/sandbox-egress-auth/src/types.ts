export type EgressGrantConfig = {
  tokenSecret: string;
  tokenIssuer: string;
  tokenAudience: string;
};

export type EgressGrantAuthInjectionType = "bearer" | "basic" | "header" | "query";

export type EgressGrantClaims = {
  sub: string;
  jti: string;
  bindingId: string;
  connectionId: string;
  secretType: string;
  upstreamBaseUrl: string;
  authInjectionType: EgressGrantAuthInjectionType;
  authInjectionTarget: string;
  authInjectionUsername?: string;
  purpose?: string;
  resolverKey?: string;
  allowedMethods?: ReadonlyArray<string>;
  allowedPathPrefixes?: ReadonlyArray<string>;
};

export type EgressGrantClaimsInput = {
  sub: string | undefined;
  jti: string | undefined;
  bindingId: string | undefined;
  connectionId: string | undefined;
  secretType: string | undefined;
  upstreamBaseUrl: string | undefined;
  authInjectionType: unknown;
  authInjectionTarget: string | undefined;
  authInjectionUsername?: string | undefined;
  purpose?: string | undefined;
  resolverKey?: string | undefined;
  allowedMethods?: ReadonlyArray<string> | undefined;
  allowedPathPrefixes?: ReadonlyArray<string> | undefined;
};
