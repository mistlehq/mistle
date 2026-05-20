import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import { mintMcpToken, type McpTokenConfig } from "@mistle/gateway-tunnel-auth";
import {
  resolveIntegrationEgressCredentialResolver,
  resolveIntegrationEgressRequestMiddleware,
  resolveProviderEgressTelemetryHandler,
} from "@mistle/integrations-definitions/server";
import type { CompiledRuntimePlan } from "@mistle/sandbox-runtime-contract";
import type { Attributes } from "@opentelemetry/api";
import { Hash } from "@smithy/hash-node";
import { HttpRequest as SmithyHttpRequest } from "@smithy/protocol-http";
import { SignatureV4 } from "@smithy/signature-v4";

import { logger } from "../logger.js";
import {
  CredentialCache,
  type CachedCredential,
  type CredentialCacheKeyInput,
} from "./credential-cache.js";
import type { GatewayEgressHttpRequest } from "./gateway-egress-request.js";

type RuntimePlanEgressRoute = CompiledRuntimePlan["egressRoutes"][number];
type RuntimePlanEgressCredentialResolver = RuntimePlanEgressRoute["credentialResolver"];
type AwsSessionCredential = Extract<CachedCredential, { kind: "aws_session" }>;
const MistleMcpTokenTtlSeconds = 300;

type MutableManagedEgressRequest = {
  body: Uint8Array | undefined;
  headers: Headers;
  method: string;
  url: URL;
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
      resolutionMode: "required" | "preferred";
      actingUserId?: string;
      credentialKind?: string;
    }
  | {
      credentialResolverKind: "mistle_mcp_token";
      organizationId: string;
      sandboxInstanceId: string;
      apiKeyId: string;
    };
type CredentialResolverRef =
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
    }
  | {
      kind: "mistle_mcp_token";
      apiKeyId: string;
    };

export class GatewayManagedEgressUnsupportedRouteError extends Error {
  public constructor(
    message: string,
    public readonly failureCode:
      | "credential_resolution_failed"
      | "credential_injection_failed"
      | "request_middleware_failed",
  ) {
    super(message);
    this.name = "GatewayManagedEgressUnsupportedRouteError";
  }
}

export async function buildManagedEgressRequest(input: {
  body: Uint8Array | undefined;
  controlPlanePublicBaseUrl: string;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  credentialCache: CredentialCache;
  mcpTokenConfig: McpTokenConfig;
  organizationId: string;
  request: GatewayEgressHttpRequest;
  route: RuntimePlanEgressRoute;
  sandboxInstanceId: string;
  testEnvironmentId?: string;
}): Promise<{ request: MutableManagedEgressRequest; telemetryAttributes: Attributes }> {
  let outgoingRequest: MutableManagedEgressRequest = {
    body: input.body,
    headers: buildOutgoingRequestHeaders({
      headers: input.request.headers,
      preserveUpgradeHeaders: isUpgradeRequest(input.request.headers),
    }),
    method: input.request.method,
    url: createUpstreamUrl({
      request: input.request,
      upstreamBaseUrl: input.route.upstream.baseUrl,
    }),
  };

  if (input.route.requestMiddleware !== undefined) {
    outgoingRequest = await applyRequestMiddleware({
      controlPlanePublicBaseUrl: input.controlPlanePublicBaseUrl,
      request: outgoingRequest,
      route: input.route,
      sandboxInstanceId: input.sandboxInstanceId,
    });
  }

  const { primaryResolver, fallbackResolver } = await selectCredentialResolverForRequest({
    organizationId: input.organizationId,
    request: outgoingRequest,
    route: input.route,
    ...(input.request.actingUserId === undefined
      ? {}
      : { actingUserId: input.request.actingUserId }),
    sandboxInstanceId: input.sandboxInstanceId,
  });
  const credential = await resolveCredentialWithFallback({
    bindingId: input.route.bindingId,
    controlPlaneInternalClient: input.controlPlaneInternalClient,
    credentialCache: input.credentialCache,
    mcpTokenConfig: input.mcpTokenConfig,
    primaryResolver,
    route: input.route,
    ...(fallbackResolver === undefined ? {} : { fallbackResolver }),
    ...(input.testEnvironmentId === undefined
      ? {}
      : { testEnvironmentId: input.testEnvironmentId }),
  });

  if (input.route.additionalHeaders !== undefined) {
    applyAdditionalHeaders({
      additionalHeaders: input.route.additionalHeaders,
      outgoingHeaders: outgoingRequest.headers,
    });
  }

  if (input.route.additionalCredentialHeaders !== undefined) {
    for (const header of input.route.additionalCredentialHeaders) {
      const headerCredential = await resolveCredentialWithCache({
        bindingId: input.route.bindingId,
        controlPlaneInternalClient: input.controlPlaneInternalClient,
        credentialCache: input.credentialCache,
        resolver: toCredentialResolverInputFromRef({
          organizationId: input.organizationId,
          sandboxInstanceId: input.sandboxInstanceId,
          ...(input.request.actingUserId === undefined
            ? {}
            : { actingUserId: input.request.actingUserId }),
          credentialResolver: header.credentialResolver,
        }),
        mcpTokenConfig: input.mcpTokenConfig,
        ...(input.testEnvironmentId === undefined
          ? {}
          : { testEnvironmentId: input.testEnvironmentId }),
      });
      outgoingRequest.headers.set(
        header.header,
        resolveValueCredential({
          context: `Additional credential-backed header '${header.header}'`,
          credential: headerCredential,
        }),
      );
    }
  }

  const telemetryAttributes: Attributes = {};
  if (input.route.authInjection.type === "aws_sigv4") {
    Object.assign(
      telemetryAttributes,
      createAwsSigV4RequestTelemetryAttributes({
        authInjection: input.route.authInjection,
        body: outgoingRequest.body,
      }),
    );
    await applyAwsSigV4AuthInjection({
      credential: resolveAwsSessionCredential({
        context: "HTTP SigV4 auth injection",
        credential,
      }),
      method: outgoingRequest.method,
      outgoingBody: outgoingRequest.body,
      outgoingHeaders: outgoingRequest.headers,
      region: input.route.authInjection.region,
      service: input.route.authInjection.service,
      upstreamUrl: outgoingRequest.url,
    });
  } else {
    applyAuthInjection({
      authInjection: input.route.authInjection,
      outgoingHeaders: outgoingRequest.headers,
      secretValue: resolveValueCredential({
        context: "HTTP egress auth injection",
        credential,
      }),
      upstreamUrl: outgoingRequest.url,
    });
  }

  return {
    request: outgoingRequest,
    telemetryAttributes,
  };
}

export function createManagedEgressResponseTelemetryAttributes(input: {
  headers: Headers;
  route: RuntimePlanEgressRoute;
}): Attributes {
  if (input.route.authInjection.type !== "aws_sigv4") {
    return {};
  }

  const telemetryHandler = resolveProviderEgressTelemetryHandler(input.route.authInjection.type);
  if (telemetryHandler === undefined) {
    throw new GatewayManagedEgressUnsupportedRouteError(
      `No provider egress telemetry handler is registered for '${input.route.authInjection.type}'.`,
      "credential_injection_failed",
    );
  }

  return telemetryHandler.createResponseTelemetryAttributes({
    headers: input.headers,
  });
}

async function applyRequestMiddleware(input: {
  controlPlanePublicBaseUrl: string;
  request: MutableManagedEgressRequest;
  route: RuntimePlanEgressRoute;
  sandboxInstanceId: string;
}): Promise<MutableManagedEgressRequest> {
  let currentRequest = input.request;

  for (const middlewareId of input.route.requestMiddleware ?? []) {
    const middleware = resolveIntegrationEgressRequestMiddleware({
      familyId: input.route.familyId,
      middlewareId,
      variantId: input.route.variantId,
    });
    if (middleware === undefined) {
      throw new GatewayManagedEgressUnsupportedRouteError(
        `Failed to resolve egress request middleware '${middlewareId}' for managed egress route '${input.route.egressRuleId}'.`,
        "request_middleware_failed",
      );
    }

    currentRequest = validateMiddlewareRequestResult({
      previousRequest: currentRequest,
      candidateRequest: await middleware.handle({
        ctx: {
          sandboxInstanceId: input.sandboxInstanceId,
          sessionUrl: createSessionLinkUrl({
            controlPlanePublicBaseUrl: input.controlPlanePublicBaseUrl,
            sandboxInstanceId: input.sandboxInstanceId,
          }),
        },
        request: cloneManagedRequest(currentRequest),
      }),
      middlewareId,
    });
  }

  return currentRequest;
}

function validateMiddlewareRequestResult(input: {
  previousRequest: MutableManagedEgressRequest;
  candidateRequest: MutableManagedEgressRequest;
  middlewareId: string;
}): MutableManagedEgressRequest {
  if (input.candidateRequest.method !== input.previousRequest.method) {
    throw new Error(`Request middleware '${input.middlewareId}' must not change the HTTP method.`);
  }
  if (!(input.candidateRequest.url instanceof URL)) {
    throw new Error(`Request middleware '${input.middlewareId}' must return URL request URLs.`);
  }
  if (input.candidateRequest.url.toString() !== input.previousRequest.url.toString()) {
    throw new Error(`Request middleware '${input.middlewareId}' must not change the target URL.`);
  }
  if (!(input.candidateRequest.headers instanceof Headers)) {
    throw new Error(`Request middleware '${input.middlewareId}' must return Headers instances.`);
  }
  if (
    input.candidateRequest.body !== undefined &&
    !(input.candidateRequest.body instanceof Uint8Array)
  ) {
    throw new Error(
      `Request middleware '${input.middlewareId}' must return Uint8Array request bodies.`,
    );
  }

  return cloneManagedRequest(input.candidateRequest);
}

function cloneManagedRequest(request: MutableManagedEgressRequest): MutableManagedEgressRequest {
  return {
    body: request.body === undefined ? undefined : new Uint8Array(request.body),
    headers: new Headers(request.headers),
    method: request.method,
    url: new URL(request.url),
  };
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

function createUpstreamUrl(input: {
  request: GatewayEgressHttpRequest;
  upstreamBaseUrl: string;
}): URL {
  const upstreamUrl = new URL(input.upstreamBaseUrl);
  upstreamUrl.pathname = resolveForwardPath(upstreamUrl.pathname, input.request.path);
  upstreamUrl.search = input.request.query === undefined ? "" : `?${input.request.query}`;
  upstreamUrl.hash = "";
  return upstreamUrl;
}

function normalizePath(path: string): string {
  if (path === "") {
    return "/";
  }

  return path.startsWith("/") ? path : `/${path}`;
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

function buildOutgoingRequestHeaders(input: {
  headers: Record<string, string[]>;
  preserveUpgradeHeaders: boolean;
}): Headers {
  const outgoingHeaders = new Headers();
  for (const [headerName, headerValues] of Object.entries(input.headers)) {
    for (const headerValue of headerValues) {
      outgoingHeaders.append(headerName, headerValue);
    }
  }

  for (const headerName of [
    "content-length",
    "forwarded",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "via",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-port",
    "x-forwarded-proto",
    "x-real-ip",
  ]) {
    outgoingHeaders.delete(headerName);
  }
  if (input.preserveUpgradeHeaders) {
    outgoingHeaders.set("connection", "Upgrade");
  } else {
    outgoingHeaders.delete("connection");
    outgoingHeaders.delete("upgrade");
  }

  for (const headerName of [...outgoingHeaders.keys()]) {
    if (headerName.toLowerCase().startsWith("cf-")) {
      outgoingHeaders.delete(headerName);
    }
  }

  return outgoingHeaders;
}

function isUpgradeRequest(headers: Record<string, string[]>): boolean {
  return headers.upgrade?.some((value) => value.toLowerCase() === "websocket") ?? false;
}

function applyAdditionalHeaders(input: {
  additionalHeaders: Readonly<Record<string, string>>;
  outgoingHeaders: Headers;
}): void {
  for (const [headerName, headerValue] of Object.entries(input.additionalHeaders)) {
    input.outgoingHeaders.set(headerName, headerValue);
  }
}

function toCredentialResolverRef(input: {
  resolver: RuntimePlanEgressCredentialResolver;
}): CredentialResolverRef {
  if (input.resolver.kind === "integration_connection") {
    return {
      kind: "integration_connection",
      connectionId: input.resolver.connectionId,
      secretType: input.resolver.secretType,
      ...(input.resolver.slotKey === undefined ? {} : { slotKey: input.resolver.slotKey }),
      ...(input.resolver.resolverKey === undefined
        ? {}
        : { resolverKey: input.resolver.resolverKey }),
    };
  }

  if (input.resolver.kind === "mistle_mcp_token") {
    return {
      kind: "mistle_mcp_token",
      apiKeyId: input.resolver.apiKeyId,
    };
  }

  return {
    kind: "linked_principal",
    providerFamily: input.resolver.providerFamily,
    actingUserRequired: input.resolver.actingUserRequired,
    resolutionMode: input.resolver.resolutionMode,
    ...(input.resolver.credentialKind === undefined
      ? {}
      : { credentialKind: input.resolver.credentialKind }),
  };
}

function toCredentialResolverInputFromRef(input: {
  organizationId: string;
  sandboxInstanceId: string;
  actingUserId?: string;
  credentialResolver: CredentialResolverRef;
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

  if (input.credentialResolver.kind === "mistle_mcp_token") {
    return {
      credentialResolverKind: "mistle_mcp_token",
      organizationId: input.organizationId,
      sandboxInstanceId: input.sandboxInstanceId,
      apiKeyId: input.credentialResolver.apiKeyId,
    };
  }

  if (input.credentialResolver.actingUserRequired && input.actingUserId === undefined) {
    throw new GatewayManagedEgressUnsupportedRouteError(
      "Linked-principal credential resolver is missing actingUserId.",
      "credential_resolution_failed",
    );
  }

  return {
    credentialResolverKind: "linked_principal",
    organizationId: input.organizationId,
    providerFamily: input.credentialResolver.providerFamily,
    actingUserRequired: input.credentialResolver.actingUserRequired,
    resolutionMode: input.credentialResolver.resolutionMode,
    ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
    ...(input.credentialResolver.credentialKind === undefined
      ? {}
      : { credentialKind: input.credentialResolver.credentialKind }),
  };
}

function normalizeSelectedCredentialResolver(
  credentialResolver: RuntimePlanEgressCredentialResolver,
): CredentialResolverRef {
  if (credentialResolver.kind === "integration_connection") {
    return {
      kind: "integration_connection",
      connectionId: credentialResolver.connectionId,
      secretType: credentialResolver.secretType,
      ...(credentialResolver.slotKey === undefined ? {} : { slotKey: credentialResolver.slotKey }),
      ...(credentialResolver.resolverKey === undefined
        ? {}
        : { resolverKey: credentialResolver.resolverKey }),
    };
  }

  if (credentialResolver.kind === "mistle_mcp_token") {
    return {
      kind: "mistle_mcp_token",
      apiKeyId: credentialResolver.apiKeyId,
    };
  }

  return {
    kind: "linked_principal",
    providerFamily: credentialResolver.providerFamily,
    actingUserRequired: credentialResolver.actingUserRequired,
    resolutionMode: credentialResolver.resolutionMode,
    ...(credentialResolver.credentialKind === undefined
      ? {}
      : { credentialKind: credentialResolver.credentialKind }),
  };
}

async function selectCredentialResolverForRequest(input: {
  actingUserId?: string;
  organizationId: string;
  request: MutableManagedEgressRequest;
  route: RuntimePlanEgressRoute;
  sandboxInstanceId: string;
}): Promise<{
  primaryResolver: CredentialResolverInput;
  fallbackResolver?: CredentialResolverInput;
}> {
  const defaultCredentialResolver = toCredentialResolverRef({
    resolver: input.route.credentialResolver,
  });
  const selectedCredentialResolver = await resolveIntegrationEgressCredentialResolver({
    familyId: input.route.familyId,
    variantId: input.route.variantId,
    selection: {
      organizationId: input.organizationId,
      ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
      request: cloneManagedRequest(input.request),
      defaultCredentialResolver,
    },
  });
  const selectedResolver = normalizeSelectedCredentialResolver(selectedCredentialResolver);

  const defaultIntegrationConnectionFallback =
    defaultCredentialResolver.kind !== "integration_connection"
      ? undefined
      : toCredentialResolverInputFromRef({
          organizationId: input.organizationId,
          sandboxInstanceId: input.sandboxInstanceId,
          ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
          credentialResolver: defaultCredentialResolver,
        });

  if (
    selectedResolver.kind === "linked_principal" &&
    selectedResolver.resolutionMode === "preferred" &&
    defaultIntegrationConnectionFallback !== undefined
  ) {
    try {
      return {
        primaryResolver: toCredentialResolverInputFromRef({
          organizationId: input.organizationId,
          sandboxInstanceId: input.sandboxInstanceId,
          ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
          credentialResolver: selectedResolver,
        }),
        fallbackResolver: defaultIntegrationConnectionFallback,
      };
    } catch (error) {
      if (
        error instanceof GatewayManagedEgressUnsupportedRouteError &&
        error.failureCode === "credential_resolution_failed"
      ) {
        return {
          primaryResolver: defaultIntegrationConnectionFallback,
        };
      }

      throw error;
    }
  }

  return {
    primaryResolver: toCredentialResolverInputFromRef({
      organizationId: input.organizationId,
      sandboxInstanceId: input.sandboxInstanceId,
      ...(input.actingUserId === undefined ? {} : { actingUserId: input.actingUserId }),
      credentialResolver: selectedResolver,
    }),
  };
}

function createCredentialCacheKey(input: {
  testEnvironmentId?: string;
  bindingId: string;
  resolver: CredentialResolverInput;
}): CredentialCacheKeyInput {
  if (input.resolver.credentialResolverKind === "integration_connection") {
    return {
      ...(input.testEnvironmentId === undefined
        ? {}
        : { testEnvironmentId: input.testEnvironmentId }),
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

  if (input.resolver.credentialResolverKind === "mistle_mcp_token") {
    return {
      ...(input.testEnvironmentId === undefined
        ? {}
        : { testEnvironmentId: input.testEnvironmentId }),
      bindingId: input.bindingId,
      credentialResolverKind: "mistle_mcp_token",
      organizationId: input.resolver.organizationId,
      sandboxInstanceId: input.resolver.sandboxInstanceId,
      apiKeyId: input.resolver.apiKeyId,
    };
  }

  return {
    ...(input.testEnvironmentId === undefined
      ? {}
      : { testEnvironmentId: input.testEnvironmentId }),
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

async function resolveCredentialWithCache(input: {
  bindingId: string;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  credentialCache: CredentialCache;
  mcpTokenConfig: McpTokenConfig;
  resolver: CredentialResolverInput;
  testEnvironmentId?: string;
}): Promise<CachedCredential> {
  const cacheKey = createCredentialCacheKey({
    bindingId: input.bindingId,
    resolver: input.resolver,
    ...(input.testEnvironmentId === undefined
      ? {}
      : { testEnvironmentId: input.testEnvironmentId }),
  });
  const cacheLookup = await input.credentialCache.getWithResult(cacheKey);
  if (cacheLookup.credential !== undefined) {
    return cacheLookup.credential;
  }

  let resolvedCredential: CachedCredential;
  if (input.resolver.credentialResolverKind === "integration_connection") {
    resolvedCredential = await input.controlPlaneInternalClient.resolveIntegrationCredential(
      {
        bindingId: input.bindingId,
        connectionId: input.resolver.connectionId,
        secretType: input.resolver.secretType,
        ...(input.resolver.slotKey === undefined ? {} : { slotKey: input.resolver.slotKey }),
        ...(input.resolver.resolverKey === undefined
          ? {}
          : { resolverKey: input.resolver.resolverKey }),
      },
      {
        ...(input.testEnvironmentId === undefined
          ? {}
          : { testEnvironmentId: input.testEnvironmentId }),
      },
    );
  } else if (input.resolver.credentialResolverKind === "mistle_mcp_token") {
    const mintedToken = await mintMcpToken({
      claims: {
        sub: input.resolver.sandboxInstanceId,
        organizationId: input.resolver.organizationId,
        apiKeyId: input.resolver.apiKeyId,
      },
      config: input.mcpTokenConfig,
      ttlSeconds: MistleMcpTokenTtlSeconds,
    });

    resolvedCredential = {
      kind: "value",
      value: mintedToken.token,
      expiresAt: mintedToken.expiresAt.toISOString(),
    };
  } else {
    resolvedCredential =
      await input.controlPlaneInternalClient.resolveIdentityLinkPrincipalCredential(
        {
          organizationId: input.resolver.organizationId,
          actingUserId:
            input.resolver.actingUserId ??
            (() => {
              throw new GatewayManagedEgressUnsupportedRouteError(
                "Linked-principal credential resolver is missing actingUserId.",
                "credential_resolution_failed",
              );
            })(),
          providerFamily: input.resolver.providerFamily,
          ...(input.resolver.credentialKind === undefined
            ? {}
            : { credentialKind: input.resolver.credentialKind }),
        },
        {
          ...(input.testEnvironmentId === undefined
            ? {}
            : { testEnvironmentId: input.testEnvironmentId }),
        },
      );
  }

  await input.credentialCache.set(cacheKey, resolvedCredential);
  return resolvedCredential;
}

async function resolveCredentialWithFallback(input: {
  bindingId: string;
  controlPlaneInternalClient: ControlPlaneInternalClient;
  credentialCache: CredentialCache;
  fallbackResolver?: CredentialResolverInput;
  mcpTokenConfig: McpTokenConfig;
  primaryResolver: CredentialResolverInput;
  route: RuntimePlanEgressRoute;
  testEnvironmentId?: string;
}): Promise<CachedCredential> {
  try {
    return await resolveCredentialWithCache({
      bindingId: input.bindingId,
      controlPlaneInternalClient: input.controlPlaneInternalClient,
      credentialCache: input.credentialCache,
      mcpTokenConfig: input.mcpTokenConfig,
      resolver: input.primaryResolver,
      ...(input.testEnvironmentId === undefined
        ? {}
        : { testEnvironmentId: input.testEnvironmentId }),
    });
  } catch (error) {
    if (input.fallbackResolver === undefined) {
      throw error;
    }

    logger.warn(
      {
        err: error,
        egressRuleId: input.route.egressRuleId,
        bindingId: input.route.bindingId,
      },
      "Failed to resolve preferred linked-principal credential; falling back to default outbound credential",
    );
    return await resolveCredentialWithCache({
      bindingId: input.bindingId,
      controlPlaneInternalClient: input.controlPlaneInternalClient,
      credentialCache: input.credentialCache,
      mcpTokenConfig: input.mcpTokenConfig,
      resolver: input.fallbackResolver,
      ...(input.testEnvironmentId === undefined
        ? {}
        : { testEnvironmentId: input.testEnvironmentId }),
    });
  }
}

function resolveValueCredential(input: { context: string; credential: CachedCredential }): string {
  if (input.credential.kind !== "value") {
    throw new GatewayManagedEgressUnsupportedRouteError(
      `${input.context} requires a string credential value.`,
      "credential_injection_failed",
    );
  }

  return input.credential.value;
}

function resolveAwsSessionCredential(input: {
  context: string;
  credential: CachedCredential;
}): AwsSessionCredential {
  if (input.credential.kind !== "aws_session") {
    throw new GatewayManagedEgressUnsupportedRouteError(
      `${input.context} requires AWS session credentials.`,
      "credential_injection_failed",
    );
  }

  return input.credential;
}

function applyAuthInjection(input: {
  authInjection: Exclude<RuntimePlanEgressRoute["authInjection"], { type: "aws_sigv4" }>;
  outgoingHeaders: Headers;
  secretValue: string;
  upstreamUrl: URL;
}): void {
  switch (input.authInjection.type) {
    case "bearer":
      input.outgoingHeaders.set(input.authInjection.target, `Bearer ${input.secretValue}`);
      return;
    case "basic":
      input.outgoingHeaders.set(
        input.authInjection.target,
        toBasicAuthorizationValue({
          secretValue: input.secretValue,
          ...(input.authInjection.username === undefined
            ? {}
            : { username: input.authInjection.username }),
        }),
      );
      return;
    case "header":
      input.outgoingHeaders.set(input.authInjection.target, input.secretValue);
      return;
    case "query":
      input.upstreamUrl.searchParams.set(input.authInjection.target, input.secretValue);
      return;
  }
}

function toBasicAuthorizationValue(input: { secretValue: string; username?: string }): string {
  const credentials =
    input.username === undefined ? input.secretValue : `${input.username}:${input.secretValue}`;

  return `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
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
    input.outgoingHeaders.set(headerName, String(headerValue));
  }
}

function createAwsSigV4RequestTelemetryAttributes(input: {
  body: Uint8Array | undefined;
  authInjection: Extract<RuntimePlanEgressRoute["authInjection"], { type: "aws_sigv4" }>;
}): Attributes {
  const telemetryHandler = resolveProviderEgressTelemetryHandler(input.authInjection.type);
  if (telemetryHandler === undefined) {
    throw new GatewayManagedEgressUnsupportedRouteError(
      `No provider egress telemetry handler is registered for '${input.authInjection.type}'.`,
      "credential_injection_failed",
    );
  }

  return telemetryHandler.createRequestTelemetryAttributes({
    service: input.authInjection.service,
    region: input.authInjection.region,
    hasBody: input.body !== undefined,
    bodyByteLength: input.body?.byteLength ?? 0,
  });
}
