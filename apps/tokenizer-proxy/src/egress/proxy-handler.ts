import { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
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
  createEgressTelemetryBaseAttributes,
  createUpstreamTelemetryAttributes,
} from "./telemetry.js";

type CreateEgressProxyHandlerInput = {
  controlPlaneInternalClient: ControlPlaneInternalClient;
  credentialCache: CredentialCache;
  egressGrantConfig: EgressGrantConfig;
};

type ErrorResponse = {
  code: string;
  message: string;
};

type AwsSessionCredential = Extract<CachedCredential, { kind: "aws_session" }>;

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
  outgoingBody: ArrayBuffer | undefined;
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
      ...(input.outgoingBody === undefined ? {} : { body: new Uint8Array(input.outgoingBody) }),
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
): Promise<ArrayBuffer | undefined> {
  if (ctx.req.method === "GET" || ctx.req.method === "HEAD") {
    return undefined;
  }

  return ctx.req.arrayBuffer();
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
            connectionId: egressGrant.connectionId,
          }),
        );
        span.setAttribute("mistle.auth.injection.type", egressGrant.authInjectionType);
        if (egressGrant.resolverKey !== undefined) {
          span.setAttribute("mistle.credential.resolver_key", egressGrant.resolverKey);
        }

        const cacheKey = {
          bindingId: egressGrant.bindingId,
          connectionId: egressGrant.connectionId,
          secretType: egressGrant.secretType,
          ...(egressGrant.slotKey === undefined ? {} : { slotKey: egressGrant.slotKey }),
          ...(egressGrant.resolverKey === undefined
            ? {}
            : { resolverKey: egressGrant.resolverKey }),
        };

        let resolvedCredential = input.credentialCache.get(cacheKey);
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
                    connectionId: egressGrant.connectionId,
                  }),
                );
                try {
                  const resolvedCredential =
                    await input.controlPlaneInternalClient.resolveIntegrationCredential({
                      connectionId: egressGrant.connectionId,
                      bindingId: egressGrant.bindingId,
                      secretType: egressGrant.secretType,
                      ...(egressGrant.slotKey === undefined
                        ? {}
                        : { slotKey: egressGrant.slotKey }),
                      ...(egressGrant.resolverKey === undefined
                        ? {}
                        : { resolverKey: egressGrant.resolverKey }),
                    });

                  input.credentialCache.set(cacheKey, resolvedCredential);
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

        const upstreamUrl = createUpstreamUrl({
          requestUrl: ctx.req.url,
          targetPath,
          upstreamBaseUrl: egressGrant.upstreamBaseUrl,
        });
        span.setAttributes(createUpstreamTelemetryAttributes({ upstreamUrl }));
        const outgoingHeaders = buildOutgoingRequestHeaders(ctx);

        if (egressGrant.additionalHeaders !== undefined) {
          applyAdditionalHeaders({
            outgoingHeaders,
            additionalHeaders: egressGrant.additionalHeaders,
          });
        }
        const outgoingBody = await readOutgoingRequestBody(ctx);

        if (egressGrant.authInjectionType === "aws_sigv4") {
          await applyAwsSigV4AuthInjection({
            method: ctx.req.method,
            upstreamUrl,
            outgoingHeaders,
            outgoingBody,
            service: egressGrant.authInjectionService,
            region: egressGrant.authInjectionRegion,
            credential: resolveAwsSessionCredentialOrThrow({
              credential: resolvedCredential,
              context: "HTTP SigV4 auth injection",
            }),
          });
        } else {
          const staticAuthInjection = resolveStaticAuthInjectionOrThrow(egressGrant);

          applyAuthInjection({
            upstreamUrl,
            outgoingHeaders,
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
              upstreamSpan.setAttributes(createUpstreamTelemetryAttributes({ upstreamUrl }));
              upstreamSpan.setAttribute("http.request.method", ctx.req.method);
              try {
                return await fetch(upstreamUrl, {
                  method: ctx.req.method,
                  headers: outgoingHeaders,
                  ...(outgoingBody === undefined ? {} : { body: outgoingBody }),
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
              upstreamBaseUrl: egressGrant.upstreamBaseUrl,
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

        if (upstreamResponse.status >= 400) {
          const upstreamResponseClone = upstreamResponse.clone();
          const upstreamResponseBody = truncateForDebug(await upstreamResponseClone.text(), 500);
          const outgoingBodyText =
            outgoingBody === undefined
              ? undefined
              : truncateForDebug(Buffer.from(outgoingBody).toString("utf8"), 500);
          logger.warn(
            {
              statusCode: upstreamResponse.status,
              upstreamUrl: upstreamUrl.toString(),
              outgoingHeaders: extractDebugHeaders(outgoingHeaders),
              outgoingBody: outgoingBodyText,
              upstreamResponseBody,
              egressRuleId: egressGrant.egressRuleId,
              bindingId: egressGrant.bindingId,
              connectionId: egressGrant.connectionId,
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
