import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type { Context } from "hono";

import { logger } from "../logger.js";
import type { AppContextBindings } from "../types.js";
import { EGRESS_ROUTE_BASE_PATH, EgressRequestHeaders } from "./constants.js";
import { CredentialCache } from "./credential-cache.js";

type CreateEgressProxyHandlerInput = {
  controlPlaneInternalClient: ControlPlaneInternalClient;
  credentialCache: CredentialCache;
};

type EgressRouteMetadata = {
  upstreamBaseUrl: string;
  authInjectionType: "bearer" | "basic" | "header" | "query";
  authInjectionTarget: string;
  authInjectionUsername?: string;
  connectionId: string;
  secretType: string;
  purpose?: string;
  resolverKey?: string;
};

type ErrorResponse = {
  code: string;
  message: string;
};

function createErrorResponse(input: ErrorResponse): ErrorResponse {
  return {
    code: input.code,
    message: input.message,
  };
}

function readRequiredHeader(headers: Headers, headerName: string): string {
  const value = headers.get(headerName);
  if (value === null || value.trim().length === 0) {
    throw new Error(`Required header '${headerName}' is missing.`);
  }

  return value;
}

function readOptionalHeader(headers: Headers, headerName: string): string | undefined {
  const value = headers.get(headerName);
  if (value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function parseAuthInjectionType(value: string): EgressRouteMetadata["authInjectionType"] {
  if (value === "bearer" || value === "basic" || value === "header" || value === "query") {
    return value;
  }

  throw new Error(`Unsupported auth injection type '${value}'.`);
}

// Route metadata is carried on internal headers by sandboxd so tokenizer-proxy
// can stay stateless and enforce the exact policy compileBinding resolved.
function resolveRouteMetadata(ctx: Context<AppContextBindings>): EgressRouteMetadata {
  const headers = ctx.req.raw.headers;
  const credentialPurpose = readOptionalHeader(headers, EgressRequestHeaders.CREDENTIAL_PURPOSE);
  const credentialResolverKey = readOptionalHeader(
    headers,
    EgressRequestHeaders.CREDENTIAL_RESOLVER_KEY,
  );
  const authInjectionUsername = readOptionalHeader(
    headers,
    EgressRequestHeaders.AUTH_INJECTION_USERNAME,
  );

  return {
    upstreamBaseUrl: readRequiredHeader(headers, EgressRequestHeaders.UPSTREAM_BASE_URL),
    authInjectionType: parseAuthInjectionType(
      readRequiredHeader(headers, EgressRequestHeaders.AUTH_INJECTION_TYPE),
    ),
    authInjectionTarget: readRequiredHeader(headers, EgressRequestHeaders.AUTH_INJECTION_TARGET),
    ...(authInjectionUsername === undefined ? {} : { authInjectionUsername }),
    connectionId: readRequiredHeader(headers, EgressRequestHeaders.CONNECTION_ID),
    secretType: readRequiredHeader(headers, EgressRequestHeaders.CREDENTIAL_SECRET_TYPE),
    ...(credentialPurpose === undefined ? {} : { purpose: credentialPurpose }),
    ...(credentialResolverKey === undefined ? {} : { resolverKey: credentialResolverKey }),
  };
}

function joinPath(basePath: string, suffixPath: string): string {
  const normalizedBasePath = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const normalizedSuffixPath = suffixPath.startsWith("/") ? suffixPath.slice(1) : suffixPath;

  if (normalizedBasePath.length === 0 || normalizedBasePath === "/") {
    return normalizedSuffixPath.length === 0 ? "/" : `/${normalizedSuffixPath}`;
  }

  return normalizedSuffixPath.length === 0
    ? normalizedBasePath
    : `${normalizedBasePath}/${normalizedSuffixPath}`;
}

function resolveTargetPath(ctx: Context<AppContextBindings>): string {
  const routeId = ctx.req.param("routeId");
  const routePrefix = `/tokenizer-proxy/egress/routes/${routeId}`;
  if (ctx.req.path === routePrefix) {
    return "/";
  }

  if (!ctx.req.path.startsWith(`${routePrefix}/`)) {
    throw new Error(
      `Egress request path '${ctx.req.path}' is outside route scope '${routePrefix}'.`,
    );
  }

  return ctx.req.path.slice(routePrefix.length);
}

function normalizePath(path: string): string {
  if (path === "") {
    return "/";
  }

  if (!path.startsWith("/")) {
    return `/${path}`;
  }

  return path;
}

function resolveForwardPath(basePath: string, targetPath: string): string {
  const normalizedBasePath = normalizePath(basePath);
  const normalizedTargetPath = normalizePath(targetPath);

  if (
    normalizedBasePath !== "/" &&
    (normalizedTargetPath === normalizedBasePath ||
      normalizedTargetPath.startsWith(`${normalizedBasePath}/`))
  ) {
    return normalizedTargetPath;
  }

  return joinPath(normalizedBasePath, normalizedTargetPath);
}

// The incoming request path is relative to the sandbox route URL, while the
// upstream base URL still points at the canonical origin. This reattaches the
// route-relative suffix to the canonical upstream path before forwarding.
function createUpstreamUrl(ctx: Context<AppContextBindings>, upstreamBaseUrl: string): URL {
  const upstreamUrl = new URL(upstreamBaseUrl);
  const incomingUrl = new URL(ctx.req.url);

  upstreamUrl.pathname = resolveForwardPath(upstreamUrl.pathname, resolveTargetPath(ctx));

  for (const [queryKey, queryValue] of incomingUrl.searchParams.entries()) {
    upstreamUrl.searchParams.append(queryKey, queryValue);
  }

  upstreamUrl.hash = "";

  return upstreamUrl;
}

// Some upstreams expect Basic auth as username:secret rather than a bare secret.
// GitHub App HTTP Git access is the motivating case: x-access-token:<token>.
function toBasicAuthorizationValue(input: { secretValue: string; username?: string }): string {
  const credentials =
    input.username === undefined ? input.secretValue : `${input.username}:${input.secretValue}`;

  return `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
}

function toBearerAuthorizationValue(secretValue: string): string {
  return `Bearer ${secretValue}`;
}

// applyAuthInjection mutates the outgoing request in place because header- and
// query-based auth schemes share the same forwarding pipeline.
function applyAuthInjection(input: {
  upstreamUrl: URL;
  outgoingHeaders: Headers;
  authInjectionType: EgressRouteMetadata["authInjectionType"];
  authInjectionTarget: string;
  authInjectionUsername?: string;
  secretValue: string;
}): void {
  switch (input.authInjectionType) {
    case "bearer":
      input.outgoingHeaders.set(
        input.authInjectionTarget,
        toBearerAuthorizationValue(input.secretValue),
      );
      return;
    case "basic":
      input.outgoingHeaders.set(
        input.authInjectionTarget,
        toBasicAuthorizationValue({
          secretValue: input.secretValue,
          ...(input.authInjectionUsername === undefined
            ? {}
            : { username: input.authInjectionUsername }),
        }),
      );
      return;
    case "header":
      input.outgoingHeaders.set(input.authInjectionTarget, input.secretValue);
      return;
    case "query":
      input.upstreamUrl.searchParams.set(input.authInjectionTarget, input.secretValue);
      return;
  }
}

function removeHopByHopHeaders(headers: Headers): void {
  const hopByHopHeaders = [
    "connection",
    "proxy-connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
  ] as const;

  for (const headerName of hopByHopHeaders) {
    headers.delete(headerName);
  }
}

function removeInternalHeaders(headers: Headers): void {
  const internalHeaderNames = Object.values(EgressRequestHeaders);

  for (const headerName of internalHeaderNames) {
    headers.delete(headerName);
  }
}

async function readOutgoingRequestBody(
  ctx: Context<AppContextBindings>,
): Promise<ArrayBuffer | undefined> {
  if (ctx.req.method === "GET" || ctx.req.method === "HEAD") {
    return undefined;
  }

  return ctx.req.arrayBuffer();
}

function buildOutgoingRequestHeaders(ctx: Context<AppContextBindings>): Headers {
  const outgoingHeaders = new Headers(ctx.req.raw.headers);
  removeHopByHopHeaders(outgoingHeaders);
  removeInternalHeaders(outgoingHeaders);

  return outgoingHeaders;
}

function copyResponseHeaders(source: Headers): Headers {
  const copiedHeaders = new Headers(source);
  removeHopByHopHeaders(copiedHeaders);
  return copiedHeaders;
}

export function createEgressProxyHandler(input: CreateEgressProxyHandlerInput) {
  return async (ctx: Context<AppContextBindings>) => {
    let routeMetadata: EgressRouteMetadata;

    try {
      routeMetadata = resolveRouteMetadata(ctx);
    } catch (error) {
      return ctx.json(
        createErrorResponse({
          code: "INVALID_EGRESS_ROUTE_METADATA",
          message: error instanceof Error ? error.message : "Egress route metadata is invalid.",
        }),
        400,
      );
    }

    const cacheKey = {
      connectionId: routeMetadata.connectionId,
      secretType: routeMetadata.secretType,
      ...(routeMetadata.purpose === undefined ? {} : { purpose: routeMetadata.purpose }),
      ...(routeMetadata.resolverKey === undefined
        ? {}
        : { resolverKey: routeMetadata.resolverKey }),
    };

    let resolvedCredentialValue = input.credentialCache.get(cacheKey);

    if (resolvedCredentialValue === undefined) {
      try {
        const resolvedCredential =
          await input.controlPlaneInternalClient.resolveIntegrationCredential({
            connectionId: routeMetadata.connectionId,
            secretType: routeMetadata.secretType,
            ...(routeMetadata.purpose === undefined ? {} : { purpose: routeMetadata.purpose }),
            ...(routeMetadata.resolverKey === undefined
              ? {}
              : { resolverKey: routeMetadata.resolverKey }),
          });

        input.credentialCache.set(cacheKey, resolvedCredential);
        resolvedCredentialValue = resolvedCredential.value;
      } catch (error) {
        logger.error(
          {
            err: error,
            routeId: ctx.req.param("routeId"),
          },
          "Failed to resolve integration credential from control-plane-api",
        );
        return ctx.json(
          createErrorResponse({
            code: "CREDENTIAL_RESOLUTION_FAILED",
            message: "Failed to resolve integration credential.",
          }),
          502,
        );
      }
    }

    const upstreamUrl = createUpstreamUrl(ctx, routeMetadata.upstreamBaseUrl);
    const outgoingHeaders = buildOutgoingRequestHeaders(ctx);

    applyAuthInjection({
      upstreamUrl,
      outgoingHeaders,
      authInjectionType: routeMetadata.authInjectionType,
      authInjectionTarget: routeMetadata.authInjectionTarget,
      ...(routeMetadata.authInjectionUsername === undefined
        ? {}
        : { authInjectionUsername: routeMetadata.authInjectionUsername }),
      secretValue: resolvedCredentialValue,
    });

    const outgoingBody = await readOutgoingRequestBody(ctx);

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        method: ctx.req.method,
        headers: outgoingHeaders,
        ...(outgoingBody === undefined ? {} : { body: outgoingBody }),
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          routeId: ctx.req.param("routeId"),
          upstreamBaseUrl: routeMetadata.upstreamBaseUrl,
        },
        "Failed to forward egress request to upstream",
      );
      return ctx.json(
        createErrorResponse({
          code: "UPSTREAM_REQUEST_FAILED",
          message: "Failed to forward request to upstream.",
        }),
        502,
      );
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: copyResponseHeaders(upstreamResponse.headers),
    });
  };
}

export { EGRESS_ROUTE_BASE_PATH };
