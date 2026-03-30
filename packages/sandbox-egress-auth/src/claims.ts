import {
  EgressGrantError,
  EgressGrantErrorCode,
  missingClaimError,
  type EgressGrantErrorCode as EgressGrantErrorCodeType,
} from "./errors.js";
import type {
  EgressGrantAuthInjectionType,
  EgressGrantClaims,
  EgressGrantClaimsInput,
} from "./types.js";

function toNonEmptyString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }

  return normalized;
}

function toOptionalNonEmptyStringArray(
  value: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  const normalizedValues = value.map((entry) => toNonEmptyString(entry));
  if (!normalizedValues.every((entry): entry is string => entry !== undefined)) {
    return undefined;
  }

  return normalizedValues;
}

export function parseAuthInjectionType(value: unknown): EgressGrantAuthInjectionType | undefined {
  if (value === "bearer" || value === "basic" || value === "header" || value === "query") {
    return value;
  }

  return undefined;
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function requireClaim(
  value: string | undefined,
  code: EgressGrantErrorCodeType,
  claimName: keyof EgressGrantClaims,
): string {
  const normalized = toNonEmptyString(value);
  if (normalized === undefined) {
    throw missingClaimError(code, claimName);
  }

  return normalized;
}

export function normalizeClaims(input: EgressGrantClaimsInput): EgressGrantClaims {
  const authInjectionType = parseAuthInjectionType(input.authInjectionType);
  if (authInjectionType === undefined) {
    throw missingClaimError(EgressGrantErrorCode.AUTH_INJECTION_TYPE_REQUIRED, "authInjectionType");
  }

  const authInjectionUsername = toNonEmptyString(input.authInjectionUsername);
  if (authInjectionUsername !== undefined && authInjectionType !== "basic") {
    throw new EgressGrantError({
      code: EgressGrantErrorCode.AUTH_INJECTION_USERNAME_INVALID,
      message: "Egress grant authInjectionUsername is valid only for basic auth injection.",
    });
  }

  const allowedMethods = toOptionalNonEmptyStringArray(input.allowedMethods);
  if (input.allowedMethods !== undefined && allowedMethods === undefined) {
    throw new EgressGrantError({
      code: EgressGrantErrorCode.ALLOWED_METHODS_INVALID,
      message: "Egress grant allowedMethods must contain only non-empty values.",
    });
  }

  const allowedPathPrefixes = toOptionalNonEmptyStringArray(input.allowedPathPrefixes);
  if (input.allowedPathPrefixes !== undefined && allowedPathPrefixes === undefined) {
    throw new EgressGrantError({
      code: EgressGrantErrorCode.ALLOWED_PATH_PREFIXES_INVALID,
      message: "Egress grant allowedPathPrefixes must contain only non-empty values.",
    });
  }

  const purpose = toNonEmptyString(input.purpose);
  const resolverKey = toNonEmptyString(input.resolverKey);

  return {
    sub: requireClaim(input.sub, EgressGrantErrorCode.SUBJECT_REQUIRED, "sub"),
    jti: requireClaim(input.jti, EgressGrantErrorCode.JTI_REQUIRED, "jti"),
    bindingId: requireClaim(input.bindingId, EgressGrantErrorCode.BINDING_ID_REQUIRED, "bindingId"),
    connectionId: requireClaim(
      input.connectionId,
      EgressGrantErrorCode.CONNECTION_ID_REQUIRED,
      "connectionId",
    ),
    secretType: requireClaim(
      input.secretType,
      EgressGrantErrorCode.SECRET_TYPE_REQUIRED,
      "secretType",
    ),
    upstreamBaseUrl: requireClaim(
      input.upstreamBaseUrl,
      EgressGrantErrorCode.UPSTREAM_BASE_URL_REQUIRED,
      "upstreamBaseUrl",
    ),
    authInjectionType,
    authInjectionTarget: requireClaim(
      input.authInjectionTarget,
      EgressGrantErrorCode.AUTH_INJECTION_TARGET_REQUIRED,
      "authInjectionTarget",
    ),
    ...(authInjectionUsername === undefined ? {} : { authInjectionUsername }),
    ...(purpose === undefined ? {} : { purpose }),
    ...(resolverKey === undefined ? {} : { resolverKey }),
    ...(allowedMethods === undefined ? {} : { allowedMethods }),
    ...(allowedPathPrefixes === undefined ? {} : { allowedPathPrefixes }),
  };
}
