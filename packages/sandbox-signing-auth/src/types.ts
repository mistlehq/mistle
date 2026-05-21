export type SigningGrantFormat = "ssh";

export type SigningGrantConfig = {
  tokenSecret: string;
  tokenIssuer: string;
  tokenAudience: string;
};

export type SigningGrantClaims = {
  sub: string;
  jti: string;
  organizationId: string;
  actingUserId: string;
  providerFamily: string;
  integrationConnectionId: string;
  format: SigningGrantFormat;
  keyRef: string;
};

export type VerifiedSigningGrant = SigningGrantClaims;
