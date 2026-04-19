import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import {
  resolveIntegrationEgressRequestMiddleware,
  resolveProviderEgressTelemetryHandler,
} from "@mistle/integrations-definitions/server";
import type { EgressGrantConfig } from "@mistle/sandbox-egress-auth";
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import { Hash } from "@smithy/hash-node";
import { HttpRequest as SmithyHttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";
import type { Context } from "hono";

import { logger } from "../logger.js";
import type { AppContextBindings } from "../types.js";
import { EGRESS_BASE_PATH, EgressRequestHeaders } from "./constants.js";
import { CredentialCache, type CachedCredential } from "./credential-cache.js";
import {
  authorizeEgressGrant,
  EgressGrantRequestError,
  type AuthorizedEgressGrant,
  type StaticAuthorizedEgressGrant,
} from "./grant.js";
import {
  createCredentialCacheTelemetryAttributes,
  createEgressTelemetryBaseAttributes,
  createUpstreamTelemetryAttributes,
} from "./telemetry.js";

type CreateEgressProxyHandlerInput = {
  controlPlaneInternalClient: ControlPlaneInternalClient;
  credentialCache: CredentialCache;
  egressGrantConfig: EgressGrantConfig;
  resolveRequestMiddleware?: RequestMiddlewareResolver;
};

type CredentialResolverInput =
  | {
      credentialResolverKind: "integration_connection";
      connectionId: string;
      secretType: string;
      slotKey?: string;
      resolverKey?: string;
    }
  | {
      credentialResolverKind: "linked_principal";
      organizationId: string;
      providerFamily: string;
      actingUserRequired: boolean;
      actingUserId?: string;
      credentialKind?: string;
    };

type ErrorResponse = {
  code: string;
  message: string;
};

type AwsSessionCredential = Extract<CachedCredential, { kind: "aws_session" }>;
type ProxyRequestContext = {
  sandboxInstanceId: string;
  sessionUrl: string;
};
type ProxyMutableRequest = {
  method: string;
  url: URL;
  headers: Headers;
  body: Uint8Array | undefined;
};
type RequestMiddlewareResolver = typeof resolveIntegrationEgressRequestMiddleware;

const EgressTracer = trace.getTracer("@mistle/tokenizer-proxy");

function createErrorResponse(input: ErrorResponse): ErrorResponse {
  return {
    code: input.code,
    message: input.message,
  };
}

function readOptionalHeader(headers: Headers, headerName: string): string | undefined {
  const value = headers.get(headerName);
  if (value === null) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
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

function resolveTargetPath(requestPath: string): string | undefined {
  if (requestPath === EGRESS_BASE_PATH) {
    return "/";
  }

  if (!requestPath.startsWith(`${EGRESS_BASE_PATH}/`)) {
    return undefined;
  }

  return requestPath.slice(EGRESS_BASE_PATH.length);
}

function resolveRequestTargetPath(ctx: Context<AppContextBindings>): string {
  const targetPath = resolveTargetPath(ctx.req.path);
  if (targetPath !== undefined) {
    return targetPath;
  }

  throw new Error(
    `Egress request path '${ctx.req.path}' is outside egress scope '${EGRESS_BASE_PATH}'.`,
  );
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

function createUpstreamUrl(input: {
  requestUrl: string;
  targetPath: string;
  upstreamBaseUrl: string;
}): URL {
  // The incoming request path is relative to the sandbox route URL, while the
  // upstream base URL still points at the canonical origin. This reattaches the
  // route-relative suffix to the canonical upstream path before forwarding.
  const upstreamUrl = new URL(input.upstreamBaseUrl);
  const incomingUrl = new URL(input.requestUrl);

  upstreamUrl.pathname = resolveForwardPath(upstreamUrl.pathname, input.targetPath);

  for (const [queryKey, queryValue] of incomingUrl.searchParams.entries()) {
    upstreamUrl.searchParams.append(queryKey, queryValue);
  }

  upstreamUrl.hash = "";

  return upstreamUrl;
}

function toBasicAuthorizationValue(input: { secretValue: string; username?: string }): string {
  // Some upstreams expect Basic auth as username:secret rather than a bare
  // secret. GitHub App HTTP Git access is the motivating case:
  // x-access-token:<token>.
  const credentials =
    input.username === undefined ? input.secretValue : `${input.username}:${input.secretValue}`;

  return `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
}

function toBearerAuthorizationValue(secretValue: string): string {
  return `Bearer ${secretValue}`;
}

function resolveStaticCredentialValueOrThrow(input: {
  credential: CachedCredential;
  context: string;
}): string {
  if (input.credential.kind !== "value") {
    throw new Error(`${input.context} requires a string credential value.`);
  }

  return input.credential.value;
}

function resolveAwsSessionCredentialOrThrow(input: {
  credential: CachedCredential;
  context: string;
}): AwsSessionCredential {
  if (input.credential.kind !== "aws_session") {
    throw new Error(`${input.context} requires AWS session credentials.`);
  }

  return input.credential;
}

function resolveStaticAuthInjectionOrThrow(egressGrant: AuthorizedEgressGrant): {
  authInjectionType: StaticAuthorizedEgressGrant["authInjectionType"];
  authInjectionTarget: string;
  authInjectionUsername?: string;
} {
  if (!("authInjectionTarget" in egressGrant)) {
    throw new Error("HTTP egress auth injection requires a concrete injection target.");
  }

  return {
    authInjectionType: egressGrant.authInjectionType,
    authInjectionTarget: egressGrant.authInjectionTarget,
    ...(egressGrant.authInjectionType !== "basic" || egressGrant.authInjectionUsername === undefined
      ? {}
      : { authInjectionUsername: egressGrant.authInjectionUsername }),
  };
}

function applyAuthInjection(input: {
  upstreamUrl: URL;
  outgoingHeaders: Headers;
  authInjectionType: StaticAuthorizedEgressGrant["authInjectionType"];
  authInjectionTarget: string;
  authInjectionUsername?: string;
  secretValue: string;
}): void {
  // applyAuthInjection mutates the outgoing request in place because header-
  // and query-based auth schemes share the same forwarding pipeline.
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

function applyAdditionalHeaders(input: {
  outgoingHeaders: Headers;
  additionalHeaders: Readonly<Record<string, string>>;
}): void {
  for (const [headerName, headerValue] of Object.entries(input.additionalHeaders)) {
    input.outgoingHeaders.set(headerName, headerValue);
  }
}

function createCredentialCacheKey(input: {
  bindingId: string;
  resolver: CredentialResolverInput;
}): Parameters<CredentialCache["get"]>[0] {
  if (input.resolver.credentialResolverKind === "integration_connection") {
    return {
      bindingId: input.bindingId,
      credentialResolverKind: "integration_connection",
      connectionId: input.resolver.connectionId,
      secretType: input.resolver.secretType,
      ...(input.resolver.slotKey === undefined ? {} : { slotKey: input.resolver.slotKey }),
      ...(input.resolver.resolverKey === undefined
        ? {}
        : { resolverKey: input.resolver.resolverKey }),
    };
  }

  return {
    bindingId: input.bindingId,
    credentialResolverKind: "linked_principal",
    organizationId: input.resolver.organizationId,
    providerFamily: input.resolver.providerFamily,
    actingUserRequired: input.resolver.actingUserRequired,
    ...(input.resolver.actingUserId === undefined
      ? {}
      : { actingUserId: input.resolver.actingUserId }),
    ...(input.resolver.credentialKind === undefined
      ? {}
      : { credentialKind: input.resolver.credentialKind }),
  };
}

function toCredentialResolverInputFromGrant(input: {
  grant: AuthorizedEgressGrant;
}): CredentialResolverInput {
  if (input.grant.credentialResolverKind === "integration_connection") {
    return {
      credentialResolverKind: "integration_connection",
      connectionId: input.grant.connectionId,
      secretType: input.grant.secretType,
      ...(input.grant.slotKey === undefined ? {} : { slotKey: input.grant.slotKey }),
      ...(input.grant.resolverKey === undefined ? {} : { resolverKey: input.grant.resolverKey }),
    };
  }

  return {
    credentialResolverKind: "linked_principal",
    organizationId: input.grant.organizationId,
    providerFamily: input.grant.providerFamily,
    actingUserRequired: input.grant.actingUserRequired,
    ...(input.grant.actingUserId === undefined ? {} : { actingUserId: input.grant.actingUserId }),
    ...(input.grant.credentialKind === undefined
      ? {}
      : { credentialKind: input.grant.credentialKind }),
  };
}

function toCredentialResolverInputFromHeader(input: {
  organizationId: string;
  credentialResolver: NonNullable<
    AuthorizedEgressGrant["additionalCredentialHeaders"]
  >[number]["credentialResolver"];
}): CredentialResolverInput {
  if (input.credentialResolver.kind === "integration_connection") {
    return {
      credentialResolverKind: "integration_connection",
      connectionId: input.credentialResolver.connectionId,
      secretType: input.credentialResolver.secretType,
      ...(input.credentialResolver.slotKey === undefined
        ? {}
        : { slotKey: input.credentialResolver.slotKey }),
      ...(input.credentialResolver.resolverKey === undefined
        ? {}
        : { resolverKey: input.credentialResolver.resolverKey }),
    };
  }

  return {
    credentialResolverKind: "linked_principal",
    organizationId: input.organizationId,
    providerFamily: input.credentialResolver.providerFamily,
    actingUserRequired: input.credentialResolver.actingUserRequired,
    ...(input.credentialResolver.actingUserId === undefined
      ? {}
      : { actingUserId: input.credentialResolver.actingUserId }),
    ...(input.credentialResolver.credentialKind === undefined
      ? {}
      : { credentialKind: input.credentialResolver.credentialKind }),
  };
}

function createGrantResolverLogFields(input: {
  grant: AuthorizedEgressGrant;
}): Record<string, string> {
  if (input.grant.credentialResolverKind === "integration_connection") {
    return {
      connectionId: input.grant.connectionId,
    };
  }

  return {
    providerFamily: input.grant.providerFamily,
    ...(input.grant.actingUserId === undefined ? {} : { actingUserId: input.grant.actingUserId }),
  };
}

async function resolveCredentialWithCache(input: {
  controlPlaneInternalClient: ControlPlaneInternalClient;
  credentialCache: CredentialCache;
  bindingId: string;
  resolver: CredentialResolverInput;
}): Promise<CachedCredential> {
  const cacheKey = createCredentialCacheKey({
    bindingId: input.bindingId,
    resolver: input.resolver,
  });
  const cacheLookup = input.credentialCache.getWithResult(cacheKey);
  const resolvedCredential = cacheLookup.credential;

  if (resolvedCredential !== undefined) {
    return resolvedCredential;
  }

  const resolvedCredentialFromControlPlane =
    input.resolver.credentialResolverKind === "integration_connection"
      ? await input.controlPlaneInternalClient.resolveIntegrationCredential({
          connectionId: input.resolver.connectionId,
          bindingId: input.bindingId,
          secretType: input.resolver.secretType,
          ...(input.resolver.slotKey === undefined ? {} : { slotKey: input.resolver.slotKey }),
          ...(input.resolver.resolverKey === undefined
            ? {}
            : { resolverKey: input.resolver.resolverKey }),
        })
      : await input.controlPlaneInternalClient.resolveIdentityLinkPrincipalCredential({
          organizationId: input.resolver.organizationId,
          actingUserId:
            input.resolver.actingUserId ??
            (() => {
              throw new Error("Linked-principal credential resolver is missing actingUserId.");
            })(),
          providerFamily: input.resolver.providerFamily,
          ...(input.resolver.credentialKind === undefined
            ? {}
            : { credentialKind: input.resolver.credentialKind }),
        });

  input.credentialCache.set(cacheKey, resolvedCredentialFromControlPlane);
  return resolvedCredentialFromControlPlane;
}

async function applyAdditionalCredentialHeaders(input: {
  controlPlaneInternalClient: ControlPlaneInternalClient;
  credentialCache: CredentialCache;
  bindingId: string;
  organizationId: string;
  outgoingHeaders: Headers;
  additionalCredentialHeaders: NonNullable<AuthorizedEgressGrant["additionalCredentialHeaders"]>;
}): Promise<void> {
  for (const header of input.additionalCredentialHeaders) {
    const credential = await resolveCredentialWithCache({
      controlPlaneInternalClient: input.controlPlaneInternalClient,
      credentialCache: input.credentialCache,
      bindingId: input.bindingId,
      resolver: toCredentialResolverInputFromHeader({
        organizationId: input.organizationId,
        credentialResolver: header.credentialResolver,
      }),
    });

    input.outgoingHeaders.set(
      header.header,
      resolveStaticCredentialValueOrThrow({
        credential,
        context: `Additional credential-backed header '${header.header}'`,
      }),
    );
  }
}

function toQueryParameterBag(searchParams: URLSearchParams): Record<string, string | string[]> {
  const queryParameters: Record<string, string | string[]> = {};

  for (const [queryKey, queryValue] of searchParams.entries()) {
    const existingValue = queryParameters[queryKey];
    if (existingValue === undefined) {
      queryParameters[queryKey] = queryValue;
      continue;
    }

    if (typeof existingValue === "string") {
      queryParameters[queryKey] = [existingValue, queryValue];
      continue;
    }

    existingValue.push(queryValue);
  }

  return queryParameters;
}

function resolveUpstreamPort(upstreamUrl: URL): number | undefined {
  if (upstreamUrl.port.length === 0) {
    return undefined;
  }

  const port = Number.parseInt(upstreamUrl.port, 10);
  if (Number.isNaN(port)) {
    throw new Error(`Upstream URL port '${upstreamUrl.port}' is invalid.`);
  }

  return port;
}

async function applyAwsSigV4AuthInjection(input: {
  method: string;
  upstreamUrl: URL;
  outgoingHeaders: Headers;
  outgoingBody: Uint8Array | undefined;
  service: string;
  region: string;
  credential: AwsSessionCredential;
}): Promise<void> {
  const signer = new SignatureV4({
    credentials: {
      accessKeyId: input.credential.accessKeyId,
      secretAccessKey: input.credential.secretAccessKey,
      sessionToken: input.credential.sessionToken,
    },
    region: input.region,
    service: input.service,
    sha256: Hash.bind(null, "sha256"),
    ...(input.service === "s3" ? { uriEscapePath: false } : {}),
  });
  const port = resolveUpstreamPort(input.upstreamUrl);
  const headersToSign = new Headers(input.outgoingHeaders);
  headersToSign.set("host", input.upstreamUrl.host);

  const signedRequest = await signer.sign(
    new SmithyHttpRequest({
      method: input.method,
      protocol: input.upstreamUrl.protocol,
      hostname: input.upstreamUrl.hostname,
      path: input.upstreamUrl.pathname,
      query: toQueryParameterBag(input.upstreamUrl.searchParams),
      headers: Object.fromEntries(headersToSign.entries()),
      ...(port === undefined ? {} : { port }),
      ...(input.outgoingBody === undefined ? {} : { body: input.outgoingBody }),
    }),
  );

  for (const headerName of [...input.outgoingHeaders.keys()]) {
    input.outgoingHeaders.delete(headerName);
  }

  for (const [headerName, headerValue] of Object.entries(signedRequest.headers)) {
    input.outgoingHeaders.set(headerName, headerValue);
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

function removeForwardingHeaders(headers: Headers): void {
  const explicitlyBlockedHeaders = [
    "content-length",
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-port",
    "x-forwarded-proto",
    "x-real-ip",
    "cdn-loop",
    "via",
  ] as const;

  for (const headerName of explicitlyBlockedHeaders) {
    headers.delete(headerName);
  }

  for (const headerName of [...headers.keys()]) {
    const normalizedHeaderName = headerName.toLowerCase();
    if (normalizedHeaderName.startsWith("cf-")) {
      headers.delete(headerName);
    }
  }
}

function removeInternalHeaders(headers: Headers): void {
  const internalHeaderNames = [...Object.values(EgressRequestHeaders)];

  for (const headerName of internalHeaderNames) {
    headers.delete(headerName);
  }
}

async function readOutgoingRequestBody(
  ctx: Context<AppContextBindings>,
): Promise<Uint8Array | undefined> {
  if (ctx.req.method === "GET" || ctx.req.method === "HEAD") {
    return undefined;
  }

  return new Uint8Array(await ctx.req.arrayBuffer());
}

function buildOutgoingRequestHeaders(ctx: Context<AppContextBindings>): Headers {
  const outgoingHeaders = new Headers(ctx.req.raw.headers);
  removeHopByHopHeaders(outgoingHeaders);
  removeForwardingHeaders(outgoingHeaders);
  removeInternalHeaders(outgoingHeaders);

  return outgoingHeaders;
}

function copyResponseHeaders(source: Headers): Headers {
  const copiedHeaders = new Headers(source);
  removeHopByHopHeaders(copiedHeaders);
  // Node's fetch transparently decompresses gzip/br/deflate response bodies
  // before exposing them here, so the original encoding and byte-length
  // headers no longer describe the forwarded body stream.
  copiedHeaders.delete("content-encoding");
  copiedHeaders.delete("content-length");
  return copiedHeaders;
}

function extractDebugHeaders(headers: Headers): Record<string, string> {
  const allowedHeaderNames = [
    "authorization",
    "chatgpt-account-id",
    "content-type",
    "originator",
    "session_id",
    "user-agent",
  ] as const;

  const extractedHeaders: Record<string, string> = {};

  for (const headerName of allowedHeaderNames) {
    const headerValue = headers.get(headerName);
    if (headerValue !== null) {
      extractedHeaders[headerName] = headerName === "authorization" ? "<redacted>" : headerValue;
    }
  }

  return extractedHeaders;
}

function truncateForDebug(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function createSessionLinkUrl(input: {
  controlPlanePublicBaseUrl: string;
  sandboxInstanceId: string;
}): string {
  const sessionLinkUrl = new URL(input.controlPlanePublicBaseUrl);
  sessionLinkUrl.pathname = joinPath(
    sessionLinkUrl.pathname,
    `p/sessions/${encodeURIComponent(input.sandboxInstanceId)}`,
  );
  sessionLinkUrl.search = "";
  sessionLinkUrl.hash = "";
  return sessionLinkUrl.toString();
}

function cloneProxyMutableRequest(request: ProxyMutableRequest): ProxyMutableRequest {
  return {
    method: request.method,
    url: new URL(request.url.toString()),
    headers: new Headers(request.headers),
    body: request.body === undefined ? undefined : new Uint8Array(request.body),
  };
}

function toFetchBody(body: Uint8Array): ArrayBuffer {
  const copiedBody = new Uint8Array(body.byteLength);
  copiedBody.set(body);
  return copiedBody.buffer;
}

function validateMiddlewareRequestResult(input: {
  previousRequest: ProxyMutableRequest;
  candidateRequest: ProxyMutableRequest;
  middlewareId: string;
}): ProxyMutableRequest {
  if (input.candidateRequest.method !== input.previousRequest.method) {
    throw new Error(`Request middleware '${input.middlewareId}' must not change the HTTP method.`);
  }

  if (!(input.candidateRequest.url instanceof URL)) {
    throw new Error(`Request middleware '${input.middlewareId}' must return a URL instance.`);
  }

  if (input.candidateRequest.url.toString() !== input.previousRequest.url.toString()) {
    throw new Error(`Request middleware '${input.middlewareId}' must not change the target URL.`);
  }

  if (!(input.candidateRequest.headers instanceof Headers)) {
    throw new Error(`Request middleware '${input.middlewareId}' must return Headers.`);
  }

  if (
    input.candidateRequest.body !== undefined &&
    !(input.candidateRequest.body instanceof Uint8Array)
  ) {
    throw new Error(
      `Request middleware '${input.middlewareId}' must return Uint8Array request bodies.`,
    );
  }

  return cloneProxyMutableRequest(input.candidateRequest);
}

async function applyRequestMiddleware(input: {
  egressGrant: AuthorizedEgressGrant;
  requestContext: ProxyRequestContext;
  request: ProxyMutableRequest;
  resolveRequestMiddleware: RequestMiddlewareResolver;
  requestPath: string;
}): Promise<ProxyMutableRequest> {
  let currentRequest = input.request;

  for (const middlewareId of input.egressGrant.requestMiddleware ?? []) {
    const middlewareSpan = EgressTracer.startSpan(
      "tokenizer_proxy.egress.apply_request_middleware",
      {
        attributes: {
          "http.request.method": currentRequest.method,
          "url.path": input.requestPath,
          "mistle.egress.rule_id": input.egressGrant.egressRuleId,
          "mistle.integration.binding_id": input.egressGrant.bindingId,
          "mistle.integration.family_id": input.egressGrant.familyId,
          "mistle.integration.variant_id": input.egressGrant.variantId,
          "mistle.egress.request_middleware.id": middlewareId,
        },
      },
    );

    try {
      const middleware = input.resolveRequestMiddleware({
        familyId: input.egressGrant.familyId,
        variantId: input.egressGrant.variantId,
        middlewareId,
      });

      if (middleware === undefined) {
        logger.error(
          {
            middlewareId,
            familyId: input.egressGrant.familyId,
            variantId: input.egressGrant.variantId,
            egressRuleId: input.egressGrant.egressRuleId,
            method: currentRequest.method,
            path: input.requestPath,
          },
          "Failed to resolve egress request middleware",
        );
        middlewareSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: "request middleware resolution failed",
        });
        continue;
      }

      const candidateRequest = cloneProxyMutableRequest(currentRequest);
      const middlewareResult = await middleware.handle({
        ctx: input.requestContext,
        request: candidateRequest,
      });

      currentRequest = validateMiddlewareRequestResult({
        previousRequest: currentRequest,
        candidateRequest: middlewareResult,
        middlewareId,
      });
    } catch (error) {
      logger.error(
        {
          err: error,
          middlewareId,
          familyId: input.egressGrant.familyId,
          variantId: input.egressGrant.variantId,
          egressRuleId: input.egressGrant.egressRuleId,
          method: currentRequest.method,
          path: input.requestPath,
        },
        "Failed to apply egress request middleware",
      );
      middlewareSpan.recordException(error instanceof Error ? error : new Error(String(error)));
      middlewareSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: "request middleware execution failed",
      });
    } finally {
      middlewareSpan.end();
    }
  }

  return currentRequest;
}

export function createEgressProxyHandler(input: CreateEgressProxyHandlerInput) {
  return async (ctx: Context<AppContextBindings>) => {
    const span = EgressTracer.startSpan("tokenizer_proxy.egress.proxy_request", {
      attributes: {
        "http.request.method": ctx.req.method,
        "url.path": ctx.req.path,
      },
    });

    return await context.with(trace.setSpan(context.active(), span), async () => {
      try {
        let targetPath: string;
        try {
          targetPath = resolveRequestTargetPath(ctx);
        } catch (error) {
          span.recordException(error instanceof Error ? error : new Error(String(error)));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "invalid egress target path",
          });
          return ctx.json(
            createErrorResponse({
              code: "INVALID_EGRESS_TARGET_PATH",
              message: error instanceof Error ? error.message : "Egress target path is invalid.",
            }),
            400,
          );
        }

        let egressGrant: AuthorizedEgressGrant;

        try {
          egressGrant = await authorizeEgressGrant({
            grantToken: readOptionalHeader(ctx.req.raw.headers, EgressRequestHeaders.GRANT),
            config: input.egressGrantConfig,
            method: ctx.req.method,
            targetPath,
          });
        } catch (error) {
          span.recordException(error instanceof Error ? error : new Error(String(error)));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "invalid egress grant",
          });

          if (error instanceof EgressGrantRequestError) {
            ctx.status(error.statusCode);
            return ctx.json(
              createErrorResponse({
                code: error.responseCode,
                message: error.message,
              }),
            );
          }

          return ctx.json(
            createErrorResponse({
              code: "INVALID_EGRESS_GRANT",
              message: error instanceof Error ? error.message : "Egress grant is invalid.",
            }),
            401,
          );
        }

        span.setAttributes(
          createEgressTelemetryBaseAttributes({
            egressRuleId: egressGrant.egressRuleId,
            method: ctx.req.method,
            requestPath: ctx.req.path,
            bindingId: egressGrant.bindingId,
            ...(egressGrant.credentialResolverKind === "integration_connection"
              ? { connectionId: egressGrant.connectionId }
              : { providerFamily: egressGrant.providerFamily }),
          }),
        );
        span.setAttribute("mistle.auth.injection.type", egressGrant.authInjectionType);
        if (
          egressGrant.credentialResolverKind === "integration_connection" &&
          egressGrant.resolverKey !== undefined
        ) {
          span.setAttribute("mistle.credential.resolver_key", egressGrant.resolverKey);
        }

        const primaryResolver = toCredentialResolverInputFromGrant({
          grant: egressGrant,
        });
        const cacheKey = createCredentialCacheKey({
          bindingId: egressGrant.bindingId,
          resolver: primaryResolver,
        });

        const cacheLookup = input.credentialCache.getWithResult(cacheKey);
        let resolvedCredential = cacheLookup.credential;
        span.setAttributes(
          createCredentialCacheTelemetryAttributes({
            result: cacheLookup.result,
          }),
        );
        span.setAttribute("mistle.credential.cache_hit", resolvedCredential !== undefined);

        if (resolvedCredential === undefined) {
          try {
            const resolvedCredentialFromControlPlane = await EgressTracer.startActiveSpan(
              "tokenizer_proxy.egress.resolve_credential",
              async (credentialSpan) => {
                credentialSpan.setAttributes(
                  createEgressTelemetryBaseAttributes({
                    egressRuleId: egressGrant.egressRuleId,
                    method: ctx.req.method,
                    requestPath: ctx.req.path,
                    bindingId: egressGrant.bindingId,
                    ...createGrantResolverLogFields({
                      grant: egressGrant,
                    }),
                  }),
                );
                try {
                  const resolvedCredential = await resolveCredentialWithCache({
                    controlPlaneInternalClient: input.controlPlaneInternalClient,
                    credentialCache: input.credentialCache,
                    bindingId: egressGrant.bindingId,
                    resolver: primaryResolver,
                  });

                  credentialSpan.setAttribute(
                    "mistle.integration.credential.result_kind",
                    resolvedCredential.kind,
                  );
                  return resolvedCredential;
                } catch (error) {
                  credentialSpan.recordException(
                    error instanceof Error ? error : new Error(String(error)),
                  );
                  credentialSpan.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: "credential resolution failed",
                  });
                  throw error;
                } finally {
                  credentialSpan.end();
                }
              },
            );
            resolvedCredential = resolvedCredentialFromControlPlane;
          } catch (error) {
            logger.error(
              {
                err: error,
                egressRuleId: egressGrant.egressRuleId,
                bindingId: egressGrant.bindingId,
                ...(egressGrant.credentialResolverKind === "integration_connection"
                  ? {
                      connectionId: egressGrant.connectionId,
                      secretType: egressGrant.secretType,
                      ...(egressGrant.resolverKey === undefined
                        ? {}
                        : { resolverKey: egressGrant.resolverKey }),
                    }
                  : {
                      providerFamily: egressGrant.providerFamily,
                      ...(egressGrant.credentialKind === undefined
                        ? {}
                        : { credentialKind: egressGrant.credentialKind }),
                    }),
              },
              "Failed to resolve integration credential from control-plane-api",
            );
            span.recordException(error instanceof Error ? error : new Error(String(error)));
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "credential resolution failed",
            });
            return ctx.json(
              createErrorResponse({
                code: "CREDENTIAL_RESOLUTION_FAILED",
                message: "Failed to resolve integration credential.",
              }),
              502,
            );
          }
        }

        if (resolvedCredential === undefined) {
          throw new Error("Expected integration credential to be resolved.");
        }
        span.setAttribute("mistle.integration.credential.result_kind", resolvedCredential.kind);

        const upstreamUrl = createUpstreamUrl({
          requestUrl: ctx.req.url,
          targetPath,
          upstreamBaseUrl: egressGrant.upstreamBaseUrl,
        });
        span.setAttributes(createUpstreamTelemetryAttributes({ upstreamUrl }));
        let outgoingRequest: ProxyMutableRequest = {
          method: ctx.req.method,
          url: upstreamUrl,
          headers: buildOutgoingRequestHeaders(ctx),
          body: await readOutgoingRequestBody(ctx),
        };

        if ((egressGrant.requestMiddleware?.length ?? 0) > 0) {
          outgoingRequest = await applyRequestMiddleware({
            egressGrant,
            requestContext: {
              sandboxInstanceId: egressGrant.sub,
              sessionUrl: createSessionLinkUrl({
                controlPlanePublicBaseUrl: ctx.get("config").controlPlaneApi.publicBaseUrl,
                sandboxInstanceId: egressGrant.sub,
              }),
            },
            request: outgoingRequest,
            resolveRequestMiddleware:
              input.resolveRequestMiddleware ?? resolveIntegrationEgressRequestMiddleware,
            requestPath: ctx.req.path,
          });
        }

        if (egressGrant.additionalHeaders !== undefined) {
          applyAdditionalHeaders({
            outgoingHeaders: outgoingRequest.headers,
            additionalHeaders: egressGrant.additionalHeaders,
          });
        }
        if (egressGrant.additionalCredentialHeaders !== undefined) {
          try {
            await applyAdditionalCredentialHeaders({
              controlPlaneInternalClient: input.controlPlaneInternalClient,
              credentialCache: input.credentialCache,
              bindingId: egressGrant.bindingId,
              organizationId: egressGrant.organizationId,
              outgoingHeaders: outgoingRequest.headers,
              additionalCredentialHeaders: egressGrant.additionalCredentialHeaders,
            });
          } catch (error) {
            logger.error(
              {
                err: error,
                egressRuleId: egressGrant.egressRuleId,
                bindingId: egressGrant.bindingId,
              },
              "Failed to resolve additional credential-backed egress headers",
            );
            span.recordException(error instanceof Error ? error : new Error(String(error)));
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "credential resolution failed",
            });
            return ctx.json(
              createErrorResponse({
                code: "CREDENTIAL_RESOLUTION_FAILED",
                message: "Failed to resolve integration credential.",
              }),
              502,
            );
          }
        }

        if (egressGrant.authInjectionType === "aws_sigv4") {
          const telemetryHandler = resolveProviderEgressTelemetryHandler(
            egressGrant.authInjectionType,
          );
          if (telemetryHandler === undefined) {
            throw new Error(
              `No provider egress telemetry handler is registered for '${egressGrant.authInjectionType}'.`,
            );
          }

          const awsSigV4Attributes = telemetryHandler.createRequestTelemetryAttributes({
            service: egressGrant.authInjectionService,
            region: egressGrant.authInjectionRegion,
            hasBody: outgoingRequest.body !== undefined,
            bodyByteLength: outgoingRequest.body?.byteLength ?? 0,
          });
          span.setAttributes(awsSigV4Attributes);

          try {
            await EgressTracer.startActiveSpan(
              "tokenizer_proxy.egress.sign_aws_request",
              async (signingSpan) => {
                signingSpan.setAttributes(createUpstreamTelemetryAttributes({ upstreamUrl }));
                signingSpan.setAttribute("http.request.method", ctx.req.method);
                signingSpan.setAttributes(awsSigV4Attributes);
                try {
                  await applyAwsSigV4AuthInjection({
                    method: outgoingRequest.method,
                    upstreamUrl: outgoingRequest.url,
                    outgoingHeaders: outgoingRequest.headers,
                    outgoingBody: outgoingRequest.body,
                    service: egressGrant.authInjectionService,
                    region: egressGrant.authInjectionRegion,
                    credential: resolveAwsSessionCredentialOrThrow({
                      credential: resolvedCredential,
                      context: "HTTP SigV4 auth injection",
                    }),
                  });
                } catch (error) {
                  signingSpan.recordException(
                    error instanceof Error ? error : new Error(String(error)),
                  );
                  signingSpan.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: "aws sigv4 signing failed",
                  });
                  throw error;
                } finally {
                  signingSpan.end();
                }
              },
            );
          } catch (error) {
            logger.error(
              {
                err: error,
                egressRuleId: egressGrant.egressRuleId,
                bindingId: egressGrant.bindingId,
                ...createGrantResolverLogFields({
                  grant: egressGrant,
                }),
                awsService: egressGrant.authInjectionService,
                awsRegion: egressGrant.authInjectionRegion,
                upstreamHost: upstreamUrl.host,
              },
              "Failed to apply AWS SigV4 auth injection",
            );
            span.recordException(error instanceof Error ? error : new Error(String(error)));
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: "aws sigv4 signing failed",
            });
            throw error;
          }
        } else {
          const staticAuthInjection = resolveStaticAuthInjectionOrThrow(egressGrant);

          applyAuthInjection({
            upstreamUrl: outgoingRequest.url,
            outgoingHeaders: outgoingRequest.headers,
            ...staticAuthInjection,
            secretValue: resolveStaticCredentialValueOrThrow({
              credential: resolvedCredential,
              context: "HTTP egress auth injection",
            }),
          });
        }

        let upstreamResponse: Response;
        try {
          upstreamResponse = await EgressTracer.startActiveSpan(
            "tokenizer_proxy.egress.fetch_upstream",
            async (upstreamSpan) => {
              upstreamSpan.setAttributes(
                createUpstreamTelemetryAttributes({ upstreamUrl: outgoingRequest.url }),
              );
              upstreamSpan.setAttribute("http.request.method", outgoingRequest.method);
              try {
                const fetchInit: RequestInit = {
                  method: outgoingRequest.method,
                  headers: outgoingRequest.headers,
                };
                if (outgoingRequest.body !== undefined) {
                  fetchInit.body = toFetchBody(outgoingRequest.body);
                }

                return await fetch(outgoingRequest.url, {
                  ...fetchInit,
                });
              } catch (error) {
                upstreamSpan.recordException(
                  error instanceof Error ? error : new Error(String(error)),
                );
                upstreamSpan.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: "upstream request failed",
                });
                throw error;
              } finally {
                upstreamSpan.end();
              }
            },
          );
        } catch (error) {
          logger.error(
            {
              err: error,
              egressRuleId: egressGrant.egressRuleId,
              upstreamBaseUrl: outgoingRequest.url.toString(),
            },
            "Failed to forward egress request to upstream",
          );
          span.recordException(error instanceof Error ? error : new Error(String(error)));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "upstream request failed",
          });
          return ctx.json(
            createErrorResponse({
              code: "UPSTREAM_REQUEST_FAILED",
              message: "Failed to forward request to upstream.",
            }),
            502,
          );
        }

        span.setAttribute("http.response.status_code", upstreamResponse.status);
        if (egressGrant.authInjectionType === "aws_sigv4") {
          const telemetryHandler = resolveProviderEgressTelemetryHandler(
            egressGrant.authInjectionType,
          );
          if (telemetryHandler === undefined) {
            throw new Error(
              `No provider egress telemetry handler is registered for '${egressGrant.authInjectionType}'.`,
            );
          }

          span.setAttributes(
            telemetryHandler.createResponseTelemetryAttributes({
              headers: upstreamResponse.headers,
            }),
          );
        }

        if (upstreamResponse.status >= 400) {
          const upstreamResponseClone = upstreamResponse.clone();
          const upstreamResponseBody = truncateForDebug(await upstreamResponseClone.text(), 500);
          const outgoingBodyText =
            outgoingRequest.body === undefined
              ? undefined
              : truncateForDebug(Buffer.from(outgoingRequest.body).toString("utf8"), 500);
          logger.warn(
            {
              statusCode: upstreamResponse.status,
              upstreamUrl: outgoingRequest.url.toString(),
              outgoingHeaders: extractDebugHeaders(outgoingRequest.headers),
              outgoingBody: outgoingBodyText,
              upstreamResponseBody,
              egressRuleId: egressGrant.egressRuleId,
              bindingId: egressGrant.bindingId,
              ...createGrantResolverLogFields({
                grant: egressGrant,
              }),
              ...(egressGrant.authInjectionType !== "aws_sigv4"
                ? {}
                : {
                    awsService: egressGrant.authInjectionService,
                    awsRegion: egressGrant.authInjectionRegion,
                    awsResponse: resolveProviderEgressTelemetryHandler(
                      egressGrant.authInjectionType,
                    )?.createResponseTelemetryAttributes({
                      headers: upstreamResponse.headers,
                    }),
                  }),
            },
            "Upstream egress request returned non-success status",
          );
        }

        return new Response(upstreamResponse.body, {
          status: upstreamResponse.status,
          headers: copyResponseHeaders(upstreamResponse.headers),
        });
      } finally {
        span.end();
      }
    });
  };
}
