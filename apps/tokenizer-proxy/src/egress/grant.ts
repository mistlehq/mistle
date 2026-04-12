import {
  EgressGrantError,
  verifyEgressGrant,
  type EgressGrantConfig,
} from "@mistle/sandbox-egress-auth";

type AuthorizedEgressGrantBase = {
  sub: string;
  jti: string;
  bindingId: string;
  connectionId: string;
  secretType: string;
  upstreamBaseUrl: string;
  additionalHeaders?: Readonly<Record<string, string>>;
  additionalCredentialHeaders?: ReadonlyArray<{
    header: string;
    connectionId: string;
    secretType: string;
    slotKey?: string;
    resolverKey?: string;
  }>;
  slotKey?: string;
  resolverKey?: string;
  allowedMethods?: ReadonlyArray<string>;
  allowedPathPrefixes?: ReadonlyArray<string>;
  egressRuleId: string;
};

export type AuthorizedEgressGrant =
  | (AuthorizedEgressGrantBase & {
      authInjectionType: "bearer" | "header" | "query";
      authInjectionTarget: string;
    })
  | (AuthorizedEgressGrantBase & {
      authInjectionType: "basic";
      authInjectionTarget: string;
      authInjectionUsername?: string;
    })
  | (AuthorizedEgressGrantBase & {
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
      connectionId: verifiedGrant.connectionId,
      secretType: verifiedGrant.secretType,
      upstreamBaseUrl: verifiedGrant.upstreamBaseUrl,
      authInjectionType: verifiedGrant.authInjectionType,
      authInjectionService: verifiedGrant.authInjectionService,
      authInjectionRegion: verifiedGrant.authInjectionRegion,
      ...(verifiedGrant.additionalHeaders === undefined
        ? {}
        : { additionalHeaders: verifiedGrant.additionalHeaders }),
      ...(verifiedGrant.additionalCredentialHeaders === undefined
        ? {}
        : { additionalCredentialHeaders: verifiedGrant.additionalCredentialHeaders }),
      ...(verifiedGrant.slotKey === undefined ? {} : { slotKey: verifiedGrant.slotKey }),
      ...(verifiedGrant.resolverKey === undefined
        ? {}
        : { resolverKey: verifiedGrant.resolverKey }),
      ...(verifiedGrant.allowedMethods === undefined
        ? {}
        : { allowedMethods: verifiedGrant.allowedMethods }),
      ...(verifiedGrant.allowedPathPrefixes === undefined
        ? {}
        : { allowedPathPrefixes: verifiedGrant.allowedPathPrefixes }),
      egressRuleId: verifiedGrant.jti,
    };
  }

  return {
    sub: verifiedGrant.sub,
    jti: verifiedGrant.jti,
    bindingId: verifiedGrant.bindingId,
    connectionId: verifiedGrant.connectionId,
    secretType: verifiedGrant.secretType,
    upstreamBaseUrl: verifiedGrant.upstreamBaseUrl,
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
      : { additionalCredentialHeaders: verifiedGrant.additionalCredentialHeaders }),
    ...(verifiedGrant.slotKey === undefined ? {} : { slotKey: verifiedGrant.slotKey }),
    ...(verifiedGrant.resolverKey === undefined ? {} : { resolverKey: verifiedGrant.resolverKey }),
    ...(verifiedGrant.allowedMethods === undefined
      ? {}
      : { allowedMethods: verifiedGrant.allowedMethods }),
    ...(verifiedGrant.allowedPathPrefixes === undefined
      ? {}
      : { allowedPathPrefixes: verifiedGrant.allowedPathPrefixes }),
    egressRuleId: verifiedGrant.jti,
  };
}
