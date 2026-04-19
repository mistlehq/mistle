import {
  EgressGrantError,
  verifyEgressGrant,
  type EgressGrantConfig,
} from "@mistle/sandbox-egress-auth";

type VerifiedEgressGrant = Awaited<ReturnType<typeof verifyEgressGrant>>;

type AuthorizedEgressGrantBase = {
  sub: string;
  jti: string;
  bindingId: string;
  organizationId: string;
  familyId: string;
  variantId: string;
  actingUserId?: string;
  upstreamBaseUrl: string;
  additionalHeaders?: Readonly<Record<string, string>>;
  additionalCredentialHeaders?: ReadonlyArray<{
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
          resolutionMode: "required" | "preferred";
          actingUserId?: string;
          credentialKind?: string;
        };
  }>;
  allowedMethods?: ReadonlyArray<string>;
  allowedPathPrefixes?: ReadonlyArray<string>;
  requestMiddleware?: ReadonlyArray<string>;
  egressRuleId: string;
};

type AuthorizedIntegrationConnectionResolver = {
  credentialResolverKind: "integration_connection";
  connectionId: string;
  secretType: string;
  slotKey?: string;
  resolverKey?: string;
};

type AuthorizedLinkedPrincipalResolver = {
  credentialResolverKind: "linked_principal";
  providerFamily: string;
  actingUserRequired: boolean;
  resolutionMode: "required" | "preferred";
  credentialKind?: string;
};

export type AuthorizedEgressGrant =
  | (AuthorizedEgressGrantBase &
      (AuthorizedIntegrationConnectionResolver | AuthorizedLinkedPrincipalResolver) & {
        authInjectionType: "bearer" | "header" | "query";
        authInjectionTarget: string;
      })
  | (AuthorizedEgressGrantBase &
      (AuthorizedIntegrationConnectionResolver | AuthorizedLinkedPrincipalResolver) & {
        authInjectionType: "basic";
        authInjectionTarget: string;
        authInjectionUsername?: string;
      })
  | (AuthorizedEgressGrantBase &
      (AuthorizedIntegrationConnectionResolver | AuthorizedLinkedPrincipalResolver) & {
        authInjectionType: "aws_sigv4";
        authInjectionService: string;
        authInjectionRegion: string;
      });

export type StaticAuthorizedEgressGrant = Exclude<
  AuthorizedEgressGrant,
  { authInjectionType: "aws_sigv4" }
>;

export type EgressGrantRequestErrorCode = "INVALID_EGRESS_GRANT" | "EGRESS_GRANT_SCOPE_VIOLATION";

export class EgressGrantRequestError extends Error {
  readonly statusCode: 401 | 403;
  readonly responseCode: EgressGrantRequestErrorCode;

  constructor(input: {
    message: string;
    statusCode: 401 | 403;
    responseCode: EgressGrantRequestErrorCode;
    cause?: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "EgressGrantRequestError";
    this.statusCode = input.statusCode;
    this.responseCode = input.responseCode;
  }
}

function normalizePath(path: string): string {
  if (path.length === 0) {
    return "/";
  }

  return path.startsWith("/") ? path : `/${path}`;
}

function methodAllowed(allowedMethods: ReadonlyArray<string>, requestMethod: string): boolean {
  const normalizedRequestMethod = requestMethod.trim().toUpperCase();
  return allowedMethods.some(
    (allowedMethod) => allowedMethod.toUpperCase() === normalizedRequestMethod,
  );
}

function pathAllowed(allowedPathPrefixes: ReadonlyArray<string>, targetPath: string): boolean {
  const normalizedTargetPath = normalizePath(targetPath);
  return allowedPathPrefixes.some((pathPrefix) =>
    normalizedTargetPath.startsWith(normalizePath(pathPrefix)),
  );
}

function toAuthorizedResolver(
  verifiedGrant: VerifiedEgressGrant,
): AuthorizedIntegrationConnectionResolver | AuthorizedLinkedPrincipalResolver {
  if (verifiedGrant.credentialResolverKind === "integration_connection") {
    return {
      credentialResolverKind: "integration_connection",
      connectionId: verifiedGrant.connectionId,
      secretType: verifiedGrant.secretType,
      ...(verifiedGrant.slotKey === undefined ? {} : { slotKey: verifiedGrant.slotKey }),
      ...(verifiedGrant.resolverKey === undefined
        ? {}
        : { resolverKey: verifiedGrant.resolverKey }),
    };
  }

  return {
    credentialResolverKind: "linked_principal",
    providerFamily: verifiedGrant.providerFamily,
    actingUserRequired: verifiedGrant.actingUserRequired,
    resolutionMode: verifiedGrant.resolutionMode,
    ...(verifiedGrant.credentialKind === undefined
      ? {}
      : { credentialKind: verifiedGrant.credentialKind }),
  };
}

function toAuthorizedAdditionalCredentialHeaders(
  headers: NonNullable<VerifiedEgressGrant["additionalCredentialHeaders"]>,
): NonNullable<AuthorizedEgressGrantBase["additionalCredentialHeaders"]> {
  return headers.map((header) => ({
    header: header.header,
    credentialResolver:
      header.credentialResolver.kind === "integration_connection"
        ? {
            kind: "integration_connection",
            connectionId: header.credentialResolver.connectionId,
            secretType: header.credentialResolver.secretType,
            ...(header.credentialResolver.slotKey === undefined
              ? {}
              : { slotKey: header.credentialResolver.slotKey }),
            ...(header.credentialResolver.resolverKey === undefined
              ? {}
              : { resolverKey: header.credentialResolver.resolverKey }),
          }
        : {
            kind: "linked_principal",
            providerFamily: header.credentialResolver.providerFamily,
            actingUserRequired: header.credentialResolver.actingUserRequired,
            resolutionMode: header.credentialResolver.resolutionMode,
            ...(header.credentialResolver.actingUserId === undefined
              ? {}
              : { actingUserId: header.credentialResolver.actingUserId }),
            ...(header.credentialResolver.credentialKind === undefined
              ? {}
              : { credentialKind: header.credentialResolver.credentialKind }),
          },
  }));
}

export async function authorizeEgressGrant(input: {
  grantToken: string | undefined;
  config: EgressGrantConfig;
  method: string;
  targetPath: string;
}): Promise<AuthorizedEgressGrant> {
  let verifiedGrant: Awaited<ReturnType<typeof verifyEgressGrant>>;

  try {
    verifiedGrant = await verifyEgressGrant({
      config: input.config,
      token: input.grantToken ?? "",
    });
  } catch (error) {
    if (error instanceof EgressGrantError) {
      throw new EgressGrantRequestError({
        message: error.message,
        statusCode: 401,
        responseCode: "INVALID_EGRESS_GRANT",
        cause: error,
      });
    }

    throw error;
  }

  if (
    verifiedGrant.allowedMethods !== undefined &&
    !methodAllowed(verifiedGrant.allowedMethods, input.method)
  ) {
    throw new EgressGrantRequestError({
      message: `Egress grant does not allow method '${input.method}'.`,
      statusCode: 403,
      responseCode: "EGRESS_GRANT_SCOPE_VIOLATION",
    });
  }

  if (
    verifiedGrant.allowedPathPrefixes !== undefined &&
    !pathAllowed(verifiedGrant.allowedPathPrefixes, input.targetPath)
  ) {
    throw new EgressGrantRequestError({
      message: `Egress grant does not allow path '${normalizePath(input.targetPath)}'.`,
      statusCode: 403,
      responseCode: "EGRESS_GRANT_SCOPE_VIOLATION",
    });
  }

  if (verifiedGrant.authInjectionType === "aws_sigv4") {
    return {
      sub: verifiedGrant.sub,
      jti: verifiedGrant.jti,
      bindingId: verifiedGrant.bindingId,
      organizationId: verifiedGrant.organizationId,
      familyId: verifiedGrant.familyId,
      variantId: verifiedGrant.variantId,
      ...(verifiedGrant.actingUserId === undefined
        ? {}
        : { actingUserId: verifiedGrant.actingUserId }),
      upstreamBaseUrl: verifiedGrant.upstreamBaseUrl,
      ...toAuthorizedResolver(verifiedGrant),
      authInjectionType: verifiedGrant.authInjectionType,
      authInjectionService: verifiedGrant.authInjectionService,
      authInjectionRegion: verifiedGrant.authInjectionRegion,
      ...(verifiedGrant.additionalHeaders === undefined
        ? {}
        : { additionalHeaders: verifiedGrant.additionalHeaders }),
      ...(verifiedGrant.additionalCredentialHeaders === undefined
        ? {}
        : {
            additionalCredentialHeaders: toAuthorizedAdditionalCredentialHeaders(
              verifiedGrant.additionalCredentialHeaders,
            ),
          }),
      ...(verifiedGrant.allowedMethods === undefined
        ? {}
        : { allowedMethods: verifiedGrant.allowedMethods }),
      ...(verifiedGrant.allowedPathPrefixes === undefined
        ? {}
        : { allowedPathPrefixes: verifiedGrant.allowedPathPrefixes }),
      ...(verifiedGrant.requestMiddleware === undefined
        ? {}
        : { requestMiddleware: verifiedGrant.requestMiddleware }),
      egressRuleId: verifiedGrant.jti,
    };
  }

  return {
    sub: verifiedGrant.sub,
    jti: verifiedGrant.jti,
    bindingId: verifiedGrant.bindingId,
    organizationId: verifiedGrant.organizationId,
    familyId: verifiedGrant.familyId,
    variantId: verifiedGrant.variantId,
    ...(verifiedGrant.actingUserId === undefined
      ? {}
      : { actingUserId: verifiedGrant.actingUserId }),
    upstreamBaseUrl: verifiedGrant.upstreamBaseUrl,
    ...toAuthorizedResolver(verifiedGrant),
    authInjectionType: verifiedGrant.authInjectionType,
    authInjectionTarget: verifiedGrant.authInjectionTarget,
    ...(verifiedGrant.additionalHeaders === undefined
      ? {}
      : { additionalHeaders: verifiedGrant.additionalHeaders }),
    ...(verifiedGrant.authInjectionType !== "basic" ||
    verifiedGrant.authInjectionUsername === undefined
      ? {}
      : { authInjectionUsername: verifiedGrant.authInjectionUsername }),
    ...(verifiedGrant.additionalCredentialHeaders === undefined
      ? {}
      : {
          additionalCredentialHeaders: toAuthorizedAdditionalCredentialHeaders(
            verifiedGrant.additionalCredentialHeaders,
          ),
        }),
    ...(verifiedGrant.allowedMethods === undefined
      ? {}
      : { allowedMethods: verifiedGrant.allowedMethods }),
    ...(verifiedGrant.allowedPathPrefixes === undefined
      ? {}
      : { allowedPathPrefixes: verifiedGrant.allowedPathPrefixes }),
    ...(verifiedGrant.requestMiddleware === undefined
      ? {}
      : { requestMiddleware: verifiedGrant.requestMiddleware }),
    egressRuleId: verifiedGrant.jti,
  };
}
