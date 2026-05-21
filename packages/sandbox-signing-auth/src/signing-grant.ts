import { createSecretKey } from "node:crypto";

import { SignJWT, errors as JoseErrors, jwtVerify } from "jose";

import { SigningGrantError, SigningGrantErrorCode } from "./errors.js";
import type {
  SigningGrantClaims,
  SigningGrantConfig,
  SigningGrantFormat,
  VerifiedSigningGrant,
} from "./types.js";

const AllowedSigningGrantAlgorithms = ["HS256"];
const JwtSecretEncoder = new TextEncoder();

function toNonEmptyString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }

  return normalized;
}

function toSecretKey(secret: string): ReturnType<typeof createSecretKey> {
  return createSecretKey(JwtSecretEncoder.encode(secret));
}

function toSigningGrantFormat(value: unknown): SigningGrantFormat | undefined {
  if (value === "ssh") {
    return value;
  }

  return undefined;
}

function mapClaimValidationErrorCode(
  error: JoseErrors.JWTClaimValidationFailed,
): SigningGrantErrorCode {
  if (error.claim === "iss") {
    return SigningGrantErrorCode.TOKEN_INVALID_ISSUER;
  }

  if (error.claim === "aud") {
    return SigningGrantErrorCode.TOKEN_INVALID_AUDIENCE;
  }

  return SigningGrantErrorCode.TOKEN_INVALID_CLAIMS;
}

export async function mintSigningGrant(input: {
  config: SigningGrantConfig;
  claims: SigningGrantClaims;
  ttlSeconds: number;
}): Promise<string> {
  const normalizedSubject = toNonEmptyString(input.claims.sub);
  if (normalizedSubject === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.SUBJECT_REQUIRED,
      message: "Signing grant sub claim is required.",
    });
  }

  const normalizedJti = toNonEmptyString(input.claims.jti);
  if (normalizedJti === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.JTI_REQUIRED,
      message: "Signing grant jti claim is required.",
    });
  }

  const normalizedOrganizationId = toNonEmptyString(input.claims.organizationId);
  if (normalizedOrganizationId === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.ORGANIZATION_ID_REQUIRED,
      message: "Signing grant organizationId claim is required.",
    });
  }

  const normalizedActingUserId = toNonEmptyString(input.claims.actingUserId);
  if (normalizedActingUserId === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.ACTING_USER_ID_REQUIRED,
      message: "Signing grant actingUserId claim is required.",
    });
  }

  const normalizedProviderFamily = toNonEmptyString(input.claims.providerFamily);
  if (normalizedProviderFamily === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.PROVIDER_FAMILY_REQUIRED,
      message: "Signing grant providerFamily claim is required.",
    });
  }

  const normalizedIntegrationConnectionId = toNonEmptyString(input.claims.integrationConnectionId);
  if (normalizedIntegrationConnectionId === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.INTEGRATION_CONNECTION_ID_REQUIRED,
      message: "Signing grant integrationConnectionId claim is required.",
    });
  }

  const normalizedFormat = toSigningGrantFormat(input.claims.format);
  if (normalizedFormat === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.FORMAT_REQUIRED,
      message: "Signing grant format claim is required.",
    });
  }

  const normalizedKeyRef = toNonEmptyString(input.claims.keyRef);
  if (normalizedKeyRef === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.KEY_REF_REQUIRED,
      message: "Signing grant keyRef claim is required.",
    });
  }

  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.INVALID_TTL_SECONDS,
      message: "Signing grant ttlSeconds must be an integer greater than or equal to 1.",
    });
  }

  const nowEpochSeconds = Math.floor(Date.now() / 1000);

  try {
    return await new SignJWT({
      organizationId: normalizedOrganizationId,
      actingUserId: normalizedActingUserId,
      providerFamily: normalizedProviderFamily,
      integrationConnectionId: normalizedIntegrationConnectionId,
      format: normalizedFormat,
      keyRef: normalizedKeyRef,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(normalizedSubject)
      .setJti(normalizedJti)
      .setIssuer(input.config.tokenIssuer)
      .setAudience(input.config.tokenAudience)
      .setIssuedAt(nowEpochSeconds)
      .setExpirationTime(nowEpochSeconds + input.ttlSeconds)
      .sign(toSecretKey(input.config.tokenSecret));
  } catch (error) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.TOKEN_SIGNING_FAILED,
      message: "Failed to sign sandbox signing grant.",
      cause: error,
    });
  }
}

export async function verifySigningGrant(input: {
  config: SigningGrantConfig;
  token: string;
}): Promise<VerifiedSigningGrant> {
  const normalizedToken = toNonEmptyString(input.token);
  if (normalizedToken === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.TOKEN_REQUIRED,
      message: "Signing grant token is required.",
    });
  }

  let payloadSubject: string | undefined;
  let payloadJti: string | undefined;
  let payloadOrganizationId: string | undefined;
  let payloadActingUserId: string | undefined;
  let payloadProviderFamily: string | undefined;
  let payloadIntegrationConnectionId: string | undefined;
  let payloadFormat: SigningGrantFormat | undefined;
  let payloadKeyRef: string | undefined;

  try {
    const verificationResult = await jwtVerify(
      normalizedToken,
      toSecretKey(input.config.tokenSecret),
      {
        algorithms: AllowedSigningGrantAlgorithms,
        issuer: input.config.tokenIssuer,
        audience: input.config.tokenAudience,
      },
    );

    payloadSubject = verificationResult.payload.sub;
    payloadJti = verificationResult.payload.jti;
    if (typeof verificationResult.payload.organizationId === "string") {
      payloadOrganizationId = verificationResult.payload.organizationId;
    }
    if (typeof verificationResult.payload.actingUserId === "string") {
      payloadActingUserId = verificationResult.payload.actingUserId;
    }
    if (typeof verificationResult.payload.providerFamily === "string") {
      payloadProviderFamily = verificationResult.payload.providerFamily;
    }
    if (typeof verificationResult.payload.integrationConnectionId === "string") {
      payloadIntegrationConnectionId = verificationResult.payload.integrationConnectionId;
    }
    payloadFormat = toSigningGrantFormat(verificationResult.payload.format);
    if (typeof verificationResult.payload.keyRef === "string") {
      payloadKeyRef = verificationResult.payload.keyRef;
    }
  } catch (error) {
    if (error instanceof JoseErrors.JWTExpired) {
      throw new SigningGrantError({
        code: SigningGrantErrorCode.TOKEN_EXPIRED,
        message: "Signing grant token is expired.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JWTClaimValidationFailed) {
      throw new SigningGrantError({
        code: mapClaimValidationErrorCode(error),
        message: "Signing grant claim validation failed.",
        cause: error,
      });
    }

    if (error instanceof JoseErrors.JOSEError) {
      throw new SigningGrantError({
        code: SigningGrantErrorCode.TOKEN_VERIFICATION_FAILED,
        message: "Signing grant verification failed.",
        cause: error,
      });
    }

    throw new SigningGrantError({
      code: SigningGrantErrorCode.TOKEN_VERIFICATION_FAILED,
      message: "Signing grant verification failed with unexpected error.",
      cause: error,
    });
  }

  const normalizedSubject = toNonEmptyString(payloadSubject);
  if (normalizedSubject === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.SUBJECT_REQUIRED,
      message: "Signing grant sub claim is required.",
    });
  }

  const normalizedJti = toNonEmptyString(payloadJti);
  if (normalizedJti === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.JTI_REQUIRED,
      message: "Signing grant jti claim is required.",
    });
  }

  const normalizedOrganizationId = toNonEmptyString(payloadOrganizationId);
  if (normalizedOrganizationId === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.ORGANIZATION_ID_REQUIRED,
      message: "Signing grant organizationId claim is required.",
    });
  }

  const normalizedActingUserId = toNonEmptyString(payloadActingUserId);
  if (normalizedActingUserId === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.ACTING_USER_ID_REQUIRED,
      message: "Signing grant actingUserId claim is required.",
    });
  }

  const normalizedProviderFamily = toNonEmptyString(payloadProviderFamily);
  if (normalizedProviderFamily === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.PROVIDER_FAMILY_REQUIRED,
      message: "Signing grant providerFamily claim is required.",
    });
  }

  const normalizedIntegrationConnectionId = toNonEmptyString(payloadIntegrationConnectionId);
  if (normalizedIntegrationConnectionId === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.INTEGRATION_CONNECTION_ID_REQUIRED,
      message: "Signing grant integrationConnectionId claim is required.",
    });
  }

  if (payloadFormat === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.FORMAT_REQUIRED,
      message: "Signing grant format claim is required.",
    });
  }

  const normalizedKeyRef = toNonEmptyString(payloadKeyRef);
  if (normalizedKeyRef === undefined) {
    throw new SigningGrantError({
      code: SigningGrantErrorCode.KEY_REF_REQUIRED,
      message: "Signing grant keyRef claim is required.",
    });
  }

  return {
    sub: normalizedSubject,
    jti: normalizedJti,
    organizationId: normalizedOrganizationId,
    actingUserId: normalizedActingUserId,
    providerFamily: normalizedProviderFamily,
    integrationConnectionId: normalizedIntegrationConnectionId,
    format: payloadFormat,
    keyRef: normalizedKeyRef,
  };
}
