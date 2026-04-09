export type EgressGrantConfig = {
  tokenSecret: string;
  tokenIssuer: string;
  tokenAudience: string;
};

export type EgressGrantAuthInjectionType = "bearer" | "basic" | "header" | "query" | "aws_sigv4";

type EgressGrantClaimsBase = {
  sub: string;
  jti: string;
  bindingId: string;
  connectionId: string;
  secretType: string;
  upstreamBaseUrl: string;
  additionalHeaders?: Readonly<Record<string, string>>;
  slotKey?: string;
  resolverKey?: string;
  allowedMethods?: ReadonlyArray<string>;
  allowedPathPrefixes?: ReadonlyArray<string>;
};

export type EgressGrantClaims =
  | (EgressGrantClaimsBase & {
      authInjectionType: "bearer" | "header" | "query";
      authInjectionTarget: string;
    })
  | (EgressGrantClaimsBase & {
      authInjectionType: "basic";
      authInjectionTarget: string;
      authInjectionUsername?: string;
    })
  | (EgressGrantClaimsBase & {
      authInjectionType: "aws_sigv4";
      authInjectionService: string;
      authInjectionRegion: string;
    });

type EgressGrantClaimsInputBase = {
  sub: string | undefined;
  jti: string | undefined;
  bindingId: string | undefined;
  connectionId: string | undefined;
  secretType: string | undefined;
  upstreamBaseUrl: string | undefined;
  additionalHeaders?: Readonly<Record<string, string>> | undefined;
  slotKey?: string | undefined;
  resolverKey?: string | undefined;
  allowedMethods?: ReadonlyArray<string> | undefined;
  allowedPathPrefixes?: ReadonlyArray<string> | undefined;
};

export type EgressGrantClaimsInput = EgressGrantClaimsInputBase & {
  authInjectionType: unknown;
  authInjectionTarget?: string | undefined;
  authInjectionUsername?: string | undefined;
  authInjectionService?: string | undefined;
  authInjectionRegion?: string | undefined;
};
