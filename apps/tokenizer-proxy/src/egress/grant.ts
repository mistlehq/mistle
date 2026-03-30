import {
  EgressGrantError,
  verifyEgressGrant,
  type EgressGrantConfig,
} from "@mistle/sandbox-egress-auth";

export type AuthorizedEgressGrant = {
  sub: string;
  jti: string;
  bindingId: string;
  connectionId: string;
  secretType: string;
  upstreamBaseUrl: string;
  authInjectionType: "bearer" | "basic" | "header" | "query";
  authInjectionTarget: string;
  authInjectionUsername?: string;
  purpose?: string;
  resolverKey?: string;
  allowedMethods?: ReadonlyArray<string>;
  allowedPathPrefixes?: ReadonlyArray<string>;
  egressRuleId: string;
};

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
  let verifiedGrant: Omit<AuthorizedEgressGrant, "egressRuleId">;

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

  return {
    ...verifiedGrant,
    egressRuleId: verifiedGrant.jti,
  };
}
