import {
  EgressGrantError,
  EgressGrantErrorCode,
  missingClaimError,
  type EgressGrantErrorCode as EgressGrantErrorCodeType,
} from "./errors.js";
import type {
  EgressGrantAuthInjectionType,
  EgressGrantClaims,
  EgressGrantCredentialHeaderInjection,
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

const HeaderNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

function normalizeAdditionalHeaders(
  value: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalizedHeaders: Record<string, string> = {};

  for (const [rawHeaderName, rawHeaderValue] of Object.entries(value)) {
    const normalizedHeaderName = toNonEmptyString(rawHeaderName)?.toLowerCase();
    const normalizedHeaderValue = toNonEmptyString(rawHeaderValue);

    if (
      normalizedHeaderName === undefined ||
      !HeaderNamePattern.test(normalizedHeaderName) ||
      normalizedHeaderValue === undefined
    ) {
      return undefined;
    }

    if (normalizedHeaders[normalizedHeaderName] !== undefined) {
      return undefined;
    }

    normalizedHeaders[normalizedHeaderName] = normalizedHeaderValue;
  }

  if (Object.keys(normalizedHeaders).length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(normalizedHeaders).sort(([leftKey], [rightKey]) =>
      leftKey.localeCompare(rightKey),
    ),
  );
}

function normalizeAdditionalCredentialHeaders(
  value: ReadonlyArray<EgressGrantCredentialHeaderInjection> | undefined,
): ReadonlyArray<EgressGrantCredentialHeaderInjection> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value.length === 0) {
    return undefined;
  }

  const occupiedHeaderNames = new Set<string>();
  const normalizedHeaders = value.map((entry) => {
    const normalizedHeaderName = toNonEmptyString(entry.header)?.toLowerCase();
    const credentialResolver = normalizeAdditionalCredentialHeaderResolver(
      entry.credentialResolver,
    );

    if (
      normalizedHeaderName === undefined ||
      !HeaderNamePattern.test(normalizedHeaderName) ||
      credentialResolver === undefined
    ) {
      return undefined;
    }

    if (occupiedHeaderNames.has(normalizedHeaderName)) {
      return undefined;
    }

    occupiedHeaderNames.add(normalizedHeaderName);

    return {
      header: normalizedHeaderName,
      credentialResolver,
    };
  });

  if (
    !normalizedHeaders.every(
      (entry): entry is EgressGrantCredentialHeaderInjection => entry !== undefined,
    )
  ) {
    return undefined;
  }

  return [...normalizedHeaders].sort((left, right) => {
    if (left.header !== right.header) {
      return left.header.localeCompare(right.header);
    }

    return compareAdditionalCredentialHeaderResolvers(
      left.credentialResolver,
      right.credentialResolver,
    );
  });
}

function parseCredentialResolverKind(
  value: unknown,
): "integration_connection" | "linked_principal" | undefined {
  if (value === "integration_connection" || value === "linked_principal") {
    return value;
  }

  return undefined;
}

function normalizeAdditionalCredentialHeaderResolver(
  resolver: EgressGrantCredentialHeaderInjection["credentialResolver"],
): EgressGrantCredentialHeaderInjection["credentialResolver"] | undefined {
  if (resolver.kind === "integration_connection") {
    const connectionId = toNonEmptyString(resolver.connectionId);
    const secretType = toNonEmptyString(resolver.secretType);
    const slotKey = toNonEmptyString(resolver.slotKey);
    const resolverKey = toNonEmptyString(resolver.resolverKey);

    if (connectionId === undefined || secretType === undefined) {
      return undefined;
    }

    return {
      kind: "integration_connection",
      connectionId,
      secretType,
      ...(slotKey === undefined ? {} : { slotKey }),
      ...(resolverKey === undefined ? {} : { resolverKey }),
    };
  }

  const providerFamily = toNonEmptyString(resolver.providerFamily);
  const actingUserId = toNonEmptyString(resolver.actingUserId);
  const credentialKind = toNonEmptyString(resolver.credentialKind);

  if (providerFamily === undefined || (resolver.actingUserRequired && actingUserId === undefined)) {
    return undefined;
  }

  return {
    kind: "linked_principal",
    providerFamily,
    actingUserRequired: resolver.actingUserRequired,
    resolutionMode: resolver.resolutionMode,
    ...(actingUserId === undefined ? {} : { actingUserId }),
    ...(credentialKind === undefined ? {} : { credentialKind }),
  };
}

function compareAdditionalCredentialHeaderResolvers(
  left: EgressGrantCredentialHeaderInjection["credentialResolver"],
  right: EgressGrantCredentialHeaderInjection["credentialResolver"],
): number {
  if (left.kind !== right.kind) {
    return left.kind.localeCompare(right.kind);
  }

  if (left.kind === "integration_connection" && right.kind === "integration_connection") {
    if (left.connectionId !== right.connectionId) {
      return left.connectionId.localeCompare(right.connectionId);
    }

    if (left.secretType !== right.secretType) {
      return left.secretType.localeCompare(right.secretType);
    }

    if (left.slotKey !== right.slotKey) {
      return (left.slotKey ?? "").localeCompare(right.slotKey ?? "");
    }

    return (left.resolverKey ?? "").localeCompare(right.resolverKey ?? "");
  }

  if (left.kind !== "linked_principal" || right.kind !== "linked_principal") {
    throw new Error("Expected credential header resolvers to share the same kind.");
  }

  if (left.providerFamily !== right.providerFamily) {
    return left.providerFamily.localeCompare(right.providerFamily);
  }

  if (left.credentialKind !== right.credentialKind) {
    return (left.credentialKind ?? "").localeCompare(right.credentialKind ?? "");
  }

  if (left.resolutionMode !== right.resolutionMode) {
    return left.resolutionMode.localeCompare(right.resolutionMode);
  }

  if (left.actingUserRequired !== right.actingUserRequired) {
    return Number(left.actingUserRequired) - Number(right.actingUserRequired);
  }

  return (left.actingUserId ?? "").localeCompare(right.actingUserId ?? "");
}

export function parseAuthInjectionType(value: unknown): EgressGrantAuthInjectionType | undefined {
  if (
    value === "bearer" ||
    value === "basic" ||
    value === "header" ||
    value === "query" ||
    value === "aws_sigv4"
  ) {
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
  claimName: string,
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

  const additionalHeaders = normalizeAdditionalHeaders(input.additionalHeaders);
  if (input.additionalHeaders !== undefined && additionalHeaders === undefined) {
    throw new EgressGrantError({
      code: EgressGrantErrorCode.ADDITIONAL_HEADERS_INVALID,
      message:
        "Egress grant additionalHeaders must contain unique valid header names and non-empty values.",
    });
  }

  const additionalCredentialHeaders = normalizeAdditionalCredentialHeaders(
    input.additionalCredentialHeaders,
  );
  if (
    input.additionalCredentialHeaders !== undefined &&
    additionalCredentialHeaders === undefined
  ) {
    throw new EgressGrantError({
      code: EgressGrantErrorCode.ADDITIONAL_CREDENTIAL_HEADERS_INVALID,
      message:
        "Egress grant additionalCredentialHeaders must contain unique valid header names and valid credential resolvers.",
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

  const requestMiddleware = toOptionalNonEmptyStringArray(input.requestMiddleware);
  if (input.requestMiddleware !== undefined && requestMiddleware === undefined) {
    throw new EgressGrantError({
      code: EgressGrantErrorCode.REQUEST_MIDDLEWARE_INVALID,
      message: "Egress grant requestMiddleware must contain only non-empty values.",
    });
  }

  const slotKey = toNonEmptyString(input.slotKey);
  const resolverKey = toNonEmptyString(input.resolverKey);
  const actingUserId = toNonEmptyString(input.actingUserId);
  const credentialResolverKind = parseCredentialResolverKind(input.credentialResolverKind);
  if (credentialResolverKind === undefined) {
    throw missingClaimError(
      EgressGrantErrorCode.CREDENTIAL_RESOLVER_KIND_REQUIRED,
      "credentialResolverKind",
    );
  }

  let credentialResolverClaims:
    | {
        credentialResolverKind: "integration_connection";
        connectionId: string;
        secretType: string;
        slotKey?: string;
        resolverKey?: string;
      }
    | {
        credentialResolverKind: "linked_principal";
        providerFamily: string;
        actingUserRequired: boolean;
        resolutionMode: "required" | "preferred";
        credentialKind?: string;
      };
  if (credentialResolverKind === "integration_connection") {
    credentialResolverClaims = {
      credentialResolverKind: "integration_connection",
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
      ...(slotKey === undefined ? {} : { slotKey }),
      ...(resolverKey === undefined ? {} : { resolverKey }),
    };
  } else {
    const providerFamily = requireClaim(
      input.providerFamily,
      EgressGrantErrorCode.PROVIDER_FAMILY_REQUIRED,
      "providerFamily",
    );
    const credentialKind = toNonEmptyString(input.credentialKind);
    const resolutionMode = input.resolutionMode ?? "required";

    if (typeof input.actingUserRequired !== "boolean") {
      throw missingClaimError(EgressGrantErrorCode.ACTING_USER_ID_REQUIRED, "actingUserRequired");
    }

    if (input.actingUserRequired && actingUserId === undefined) {
      throw missingClaimError(EgressGrantErrorCode.ACTING_USER_ID_REQUIRED, "actingUserId");
    }

    credentialResolverClaims = {
      credentialResolverKind: "linked_principal",
      providerFamily,
      actingUserRequired: input.actingUserRequired,
      resolutionMode,
      ...(credentialKind === undefined ? {} : { credentialKind }),
    };
  }

  const baseClaims = {
    sub: requireClaim(input.sub, EgressGrantErrorCode.SUBJECT_REQUIRED, "sub"),
    jti: requireClaim(input.jti, EgressGrantErrorCode.JTI_REQUIRED, "jti"),
    bindingId: requireClaim(input.bindingId, EgressGrantErrorCode.BINDING_ID_REQUIRED, "bindingId"),
    organizationId: requireClaim(
      input.organizationId,
      EgressGrantErrorCode.ORGANIZATION_ID_REQUIRED,
      "organizationId",
    ),
    familyId: requireClaim(input.familyId, EgressGrantErrorCode.FAMILY_ID_REQUIRED, "familyId"),
    variantId: requireClaim(input.variantId, EgressGrantErrorCode.VARIANT_ID_REQUIRED, "variantId"),
    ...(actingUserId === undefined ? {} : { actingUserId }),
    upstreamBaseUrl: requireClaim(
      input.upstreamBaseUrl,
      EgressGrantErrorCode.UPSTREAM_BASE_URL_REQUIRED,
      "upstreamBaseUrl",
    ),
    ...credentialResolverClaims,
    ...(allowedMethods === undefined ? {} : { allowedMethods }),
    ...(allowedPathPrefixes === undefined ? {} : { allowedPathPrefixes }),
    ...(requestMiddleware === undefined ? {} : { requestMiddleware }),
  };

  if (authInjectionType === "aws_sigv4") {
    if (additionalCredentialHeaders !== undefined) {
      throw new EgressGrantError({
        code: EgressGrantErrorCode.ADDITIONAL_CREDENTIAL_HEADERS_INVALID,
        message:
          "Egress grant additionalCredentialHeaders cannot be combined with aws_sigv4 auth injection.",
      });
    }

    return {
      ...baseClaims,
      authInjectionType,
      authInjectionService: requireClaim(
        input.authInjectionService,
        EgressGrantErrorCode.AUTH_INJECTION_SERVICE_REQUIRED,
        "authInjectionService",
      ),
      authInjectionRegion: requireClaim(
        input.authInjectionRegion,
        EgressGrantErrorCode.AUTH_INJECTION_REGION_REQUIRED,
        "authInjectionRegion",
      ),
    };
  }

  return {
    ...baseClaims,
    authInjectionType,
    authInjectionTarget: requireClaim(
      input.authInjectionTarget,
      EgressGrantErrorCode.AUTH_INJECTION_TARGET_REQUIRED,
      "authInjectionTarget",
    ),
    ...(additionalHeaders === undefined ? {} : { additionalHeaders }),
    ...(additionalCredentialHeaders === undefined ? {} : { additionalCredentialHeaders }),
    ...(authInjectionType !== "basic" || authInjectionUsername === undefined
      ? {}
      : { authInjectionUsername }),
  };
}
