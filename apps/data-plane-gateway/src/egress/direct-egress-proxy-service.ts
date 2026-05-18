import {
  request as requestHttp,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
} from "node:http";
import { request as requestHttps } from "node:https";

import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type { DataPlaneDatabase, DataPlaneTables } from "@mistle/db/data-plane";
import {
  EgressTokenError,
  verifyEgressToken,
  type EgressTokenConfig,
  type VerifiedEgressToken,
} from "@mistle/gateway-tunnel-auth";

import { logger } from "../logger.js";
import type { ActiveSandboxRuntimePlanRepository } from "./active-runtime-plan-cache.js";
import {
  InvalidActiveSandboxRuntimePlanError,
  loadActiveSandboxRuntimePlan,
} from "./active-runtime-plan-loader.js";
import type { CredentialCache } from "./credential-cache.js";
import type { GatewayEgressHttpRequest, RepeatedHeaderValues } from "./gateway-egress-request.js";
import {
  buildManagedEgressRequest,
  GatewayManagedEgressUnsupportedRouteError,
} from "./managed-egress-request.js";
import {
  classifyRuntimePlanEgressRoute,
  type GatewayEgressRouteClassification,
} from "./runtime-plan-route-classifier.js";

export const DirectEgressHttpRoutePath = "/_mistle/egress/http";
export const DirectEgressWebSocketRoutePath = "/_mistle/egress/ws";

type ActiveRuntimePlan = NonNullable<Awaited<ReturnType<typeof loadActiveSandboxRuntimePlan>>>;
type DirectEgressTransport = "http" | "websocket";
type DirectEgressFailureCode =
  | "authentication_failed"
  | "invalid_target"
  | "runtime_plan_invalid"
  | "runtime_plan_unavailable"
  | "organization_mismatch"
  | "managed_route_ambiguous"
  | "managed_route_unauthorized"
  | "credential_resolution_failed"
  | "credential_injection_failed"
  | "request_middleware_failed"
  | "upstream_connect_failed";

type DirectEgressRequest = GatewayEgressHttpRequest;

type DirectEgressRouteAuthorization =
  | {
      kind: "passthrough";
      activeRuntimePlan: ActiveRuntimePlan;
      classification: Extract<GatewayEgressRouteClassification, { kind: "unmatched" }>;
      request: DirectEgressRequest;
      targetUrl: URL;
      token: VerifiedEgressToken;
    }
  | {
      kind: "managed";
      activeRuntimePlan: ActiveRuntimePlan;
      classification: Extract<GatewayEgressRouteClassification, { kind: "matched" }>;
      request: DirectEgressRequest;
      targetUrl: URL;
      token: VerifiedEgressToken;
    };

export type DirectEgressAdmission = DirectEgressRouteAuthorization;

type DirectEgressLogFields = {
  authority?: string;
  durationMs?: number;
  egressRuleId?: string;
  event: string;
  failureCode?: DirectEgressFailureCode;
  host?: string;
  method?: string;
  outcome?: string;
  path?: string;
  requestBodyBytes?: number;
  responseBodyBytes?: number;
  responseChunkCount?: number;
  routeMode?: DirectEgressAdmission["kind"];
  sandboxInstanceId?: string;
  scheme?: DirectEgressRequest["scheme"];
  status?: number;
  target?: string | null;
  transport?: DirectEgressTransport;
};

export class DirectEgressProxyError extends Error {
  public constructor(
    message: string,
    public readonly code: DirectEgressFailureCode,
    public readonly status: number,
  ) {
    super(message);
    this.name = "DirectEgressProxyError";
  }
}

export class DirectEgressProxyService {
  public constructor(
    private readonly activeRuntimePlanCache: ActiveSandboxRuntimePlanRepository,
    private readonly controlPlanePublicBaseUrl: string,
    private readonly controlPlaneInternalClient: ControlPlaneInternalClient,
    private readonly credentialCache: CredentialCache,
    private readonly egressTokenConfig: EgressTokenConfig,
  ) {}

  public async authorize(input: {
    authorizationHeader: string | undefined;
    db: DataPlaneDatabase;
    headers: Headers;
    method: string;
    tables: DataPlaneTables;
    target: string | null;
    testEnvironmentId?: string;
    transport: DirectEgressTransport;
  }): Promise<DirectEgressAdmission> {
    const token = await this.verifyBearerToken(input.authorizationHeader);
    const targetUrl = parseDirectEgressTarget(input.target);
    const request = toDirectEgressRequest({
      headers: input.headers,
      method: input.method,
      targetUrl,
    });

    let activeRuntimePlan: Awaited<ReturnType<typeof loadActiveSandboxRuntimePlan>>;
    try {
      activeRuntimePlan = await loadActiveSandboxRuntimePlan({
        cache: this.activeRuntimePlanCache,
        db: input.db,
        sandboxInstanceId: token.sub,
        tables: input.tables,
      });
    } catch (error) {
      if (error instanceof InvalidActiveSandboxRuntimePlanError) {
        throw new DirectEgressProxyError(
          `Sandbox instance '${token.sub}' has an invalid active runtime plan for direct gateway egress.`,
          "runtime_plan_invalid",
          403,
        );
      }

      throw error;
    }

    if (activeRuntimePlan === null) {
      throw new DirectEgressProxyError(
        `Sandbox instance '${token.sub}' was not found with an active runtime plan while authorizing direct gateway egress.`,
        "runtime_plan_unavailable",
        403,
      );
    }
    if (activeRuntimePlan.organizationId !== token.organizationId) {
      throw new DirectEgressProxyError(
        "Egress token organization does not match the sandbox instance organization.",
        "organization_mismatch",
        403,
      );
    }

    const classification = classifyRuntimePlanEgressRoute({
      authority: request.authority,
      method: request.method,
      path: request.path,
      runtimePlan: activeRuntimePlan.runtimePlan,
    });
    if (classification.kind === "ambiguous") {
      throw new DirectEgressProxyError(
        `Multiple managed egress routes matched ${request.method} ${request.authority}${request.path}.`,
        "managed_route_ambiguous",
        403,
      );
    }
    if (classification.kind === "matched") {
      const authorizationFailure = authorizeMatchedManagedRoute({
        route: classification.route,
      });
      if (authorizationFailure !== undefined) {
        throw new DirectEgressProxyError(
          authorizationFailure.message,
          "managed_route_unauthorized",
          403,
        );
      }

      const admission: DirectEgressAdmission = {
        kind: "managed",
        activeRuntimePlan,
        classification,
        request,
        targetUrl,
        token,
      };
      logDirectEgressAuthorized({
        admission,
        transport: input.transport,
      });
      return admission;
    }

    const admission: DirectEgressAdmission = {
      kind: "passthrough",
      activeRuntimePlan,
      classification,
      request,
      targetUrl,
      token,
    };
    logDirectEgressAuthorized({
      admission,
      transport: input.transport,
    });
    return admission;
  }

  public async proxyHttp(input: {
    admission: DirectEgressAdmission;
    body: Uint8Array | undefined;
    testEnvironmentId?: string;
  }): Promise<Response> {
    const outgoingRequest =
      input.admission.kind === "managed"
        ? await this.buildManagedRequest({
            admission: input.admission,
            body: input.body,
            ...(input.testEnvironmentId === undefined
              ? {}
              : { testEnvironmentId: input.testEnvironmentId }),
          })
        : {
            body: input.body,
            headers: toHeaderRecord(input.admission.request.headers),
            method: input.admission.request.method,
            url: input.admission.targetUrl,
          };

    const startedAtMs = Date.now();
    const logFields = directEgressLogFieldsForAdmission({
      admission: input.admission,
      event: "gateway_direct_egress_http_started",
      transport: "http",
    });
    logger.info(
      {
        ...logFields,
        requestBodyBytes: input.body?.byteLength ?? 0,
      },
      "Direct gateway HTTP egress request started",
    );

    return await sendDirectHttpRequest({
      body: outgoingRequest.body,
      headers: outgoingRequest.headers,
      logFields,
      method: outgoingRequest.method,
      requestBodyBytes: input.body?.byteLength ?? 0,
      startedAtMs,
      url: outgoingRequest.url,
    });
  }

  public async resolveWebSocketUpstream(input: { admission: DirectEgressAdmission }): Promise<URL> {
    if (input.admission.kind === "managed") {
      throw new DirectEgressProxyError(
        "Direct websocket egress does not support managed egress routes yet.",
        "managed_route_unauthorized",
        403,
      );
    }

    const upstreamUrl = new URL(input.admission.targetUrl.toString());
    upstreamUrl.protocol = upstreamUrl.protocol === "https:" ? "wss:" : "ws:";
    return upstreamUrl;
  }

  private async verifyBearerToken(
    authorizationHeader: string | undefined,
  ): Promise<VerifiedEgressToken> {
    const token = readBearerToken(authorizationHeader);
    if (token === undefined) {
      throw new DirectEgressProxyError(
        "Direct egress requires a bearer egress token.",
        "authentication_failed",
        401,
      );
    }

    try {
      return await verifyEgressToken({
        config: this.egressTokenConfig,
        token,
      });
    } catch (error) {
      if (error instanceof EgressTokenError) {
        throw new DirectEgressProxyError(
          `Direct egress token verification failed: ${error.code}.`,
          "authentication_failed",
          401,
        );
      }

      throw error;
    }
  }

  private async buildManagedRequest(input: {
    admission: Extract<DirectEgressAdmission, { kind: "managed" }>;
    body: Uint8Array | undefined;
    testEnvironmentId?: string;
  }): Promise<{
    body: Uint8Array | undefined;
    headers: Headers;
    method: string;
    url: URL;
  }> {
    try {
      const result = await buildManagedEgressRequest({
        body: input.body,
        controlPlanePublicBaseUrl: this.controlPlanePublicBaseUrl,
        controlPlaneInternalClient: this.controlPlaneInternalClient,
        credentialCache: this.credentialCache,
        organizationId: input.admission.activeRuntimePlan.organizationId,
        request: input.admission.request,
        route: input.admission.classification.route,
        sandboxInstanceId: input.admission.token.sub,
        ...(input.testEnvironmentId === undefined
          ? {}
          : { testEnvironmentId: input.testEnvironmentId }),
      });
      return result.request;
    } catch (error) {
      if (error instanceof GatewayManagedEgressUnsupportedRouteError) {
        throw new DirectEgressProxyError(error.message, error.failureCode, 502);
      }

      throw new DirectEgressProxyError(
        error instanceof Error ? error.message : String(error),
        "credential_resolution_failed",
        502,
      );
    }
  }
}

function authorizeMatchedManagedRoute(input: {
  route: Extract<GatewayEgressRouteClassification, { kind: "matched" }>["route"];
}): { message: string } | undefined {
  if (
    input.route.credentialResolver.kind === "linked_principal" &&
    input.route.credentialResolver.actingUserRequired
  ) {
    return {
      message: `Managed egress route '${input.route.egressRuleId}' requires acting-user context, but direct gateway egress did not receive one.`,
    };
  }

  const actingUserRequiredAdditionalHeader = input.route.additionalCredentialHeaders?.find(
    (header) =>
      header.credentialResolver.kind === "linked_principal" &&
      header.credentialResolver.actingUserRequired,
  );
  if (actingUserRequiredAdditionalHeader !== undefined) {
    return {
      message: `Managed egress route '${input.route.egressRuleId}' additional credential header '${actingUserRequiredAdditionalHeader.header}' requires acting-user context, but direct gateway egress did not receive one.`,
    };
  }

  return undefined;
}

function parseDirectEgressTarget(target: string | null): URL {
  if (target === null || target.trim().length === 0) {
    throw new DirectEgressProxyError(
      "Direct egress target query parameter is required.",
      "invalid_target",
      400,
    );
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch (error) {
    throw new DirectEgressProxyError(
      error instanceof Error ? error.message : "Direct egress target must be a valid URL.",
      "invalid_target",
      400,
    );
  }

  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    throw new DirectEgressProxyError(
      "Direct egress target must use http or https.",
      "invalid_target",
      400,
    );
  }

  return targetUrl;
}

function toDirectEgressRequest(input: {
  headers: Headers;
  method: string;
  targetUrl: URL;
}): DirectEgressRequest {
  return {
    authority: input.targetUrl.host,
    headers: toRepeatedRequestHeaders(input.headers),
    method: input.method,
    path: input.targetUrl.pathname,
    ...(input.targetUrl.search.length === 0 ? {} : { query: input.targetUrl.search.slice(1) }),
    scheme: input.targetUrl.protocol === "https:" ? "https" : "http",
  };
}

function readBearerToken(authorizationHeader: string | undefined): string | undefined {
  if (authorizationHeader === undefined) {
    return undefined;
  }

  const [scheme, token, extra] = authorizationHeader.trim().split(/\s+/u);
  if (scheme?.toLowerCase() !== "bearer" || token === undefined || extra !== undefined) {
    return undefined;
  }

  return token;
}

const HopByHopHeaderNames = new Set([
  "authorization",
  "connection",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function toRepeatedRequestHeaders(headers: Headers): RepeatedHeaderValues {
  const repeatedHeaders: RepeatedHeaderValues = {};
  for (const [name, value] of headers.entries()) {
    const normalizedName = name.toLowerCase();
    if (HopByHopHeaderNames.has(normalizedName)) {
      continue;
    }

    repeatedHeaders[normalizedName] = [value];
  }

  return repeatedHeaders;
}

function toHeaderRecord(headers: RepeatedHeaderValues): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [name, values] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (HopByHopHeaderNames.has(normalizedName)) {
      continue;
    }

    record[normalizedName] = values.join(", ");
  }

  return record;
}

function toResponseHeaders(headers: IncomingHttpHeaders): Headers {
  const responseHeaders = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (HopByHopHeaderNames.has(normalizedName) || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        responseHeaders.append(normalizedName, item);
      }
      continue;
    }

    responseHeaders.set(normalizedName, value);
  }

  return responseHeaders;
}

function sendDirectHttpRequest(input: {
  body: Uint8Array | undefined;
  headers: Headers | Record<string, string>;
  logFields: DirectEgressLogFields;
  method: string;
  requestBodyBytes: number;
  startedAtMs: number;
  url: URL;
}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const requestFactory = input.url.protocol === "https:" ? requestHttps : requestHttp;
    const requestHeaders =
      input.headers instanceof Headers
        ? Object.fromEntries(input.headers.entries())
        : input.headers;
    const upstreamRequest = requestFactory({
      headers: requestHeaders,
      hostname: input.url.hostname,
      method: input.method,
      path: `${input.url.pathname}${input.url.search}`,
      port: input.url.port.length === 0 ? undefined : Number(input.url.port),
      protocol: input.url.protocol,
    });

    upstreamRequest.on("response", (response) => {
      const status = response.statusCode ?? 502;
      const responseLogFields = {
        ...input.logFields,
        event: "gateway_direct_egress_http_response_started",
        durationMs: Date.now() - input.startedAtMs,
        requestBodyBytes: input.requestBodyBytes,
        status,
      };
      logger.info(responseLogFields, "Direct gateway HTTP egress response started");

      resolve(
        new Response(
          toResponseBodyStream({
            logFields: responseLogFields,
            request: upstreamRequest,
            response,
            startedAtMs: input.startedAtMs,
          }),
          {
            status,
            headers: toResponseHeaders(response.headers),
          },
        ),
      );
    });
    upstreamRequest.on("error", (error) => {
      logger.info(
        {
          ...input.logFields,
          event: "gateway_direct_egress_http_failed",
          durationMs: Date.now() - input.startedAtMs,
          failureCode: "upstream_connect_failed",
          requestBodyBytes: input.requestBodyBytes,
        },
        error.message,
      );
      reject(new DirectEgressProxyError(error.message, "upstream_connect_failed", 502));
    });

    if (input.body === undefined) {
      upstreamRequest.end();
      return;
    }

    upstreamRequest.end(input.body);
  });
}

function toResponseBodyStream(input: {
  logFields: DirectEgressLogFields;
  request: ClientRequest;
  response: IncomingMessage;
  startedAtMs: number;
}): ReadableStream<Uint8Array> {
  let ended = false;
  let responseBodyBytes = 0;
  let responseChunkCount = 0;

  const finish = (event: string, outcome: string, error?: Error): void => {
    if (ended) {
      return;
    }
    ended = true;
    logger.info(
      {
        ...input.logFields,
        durationMs: Date.now() - input.startedAtMs,
        event,
        outcome,
        responseBodyBytes,
        responseChunkCount,
      },
      error?.message ?? "Direct gateway HTTP egress response body finished",
    );
  };

  return new ReadableStream<Uint8Array>({
    start: (controller) => {
      input.response.on("data", (chunk: Buffer) => {
        responseBodyBytes += chunk.byteLength;
        responseChunkCount += 1;
        controller.enqueue(chunk);
      });
      input.response.on("end", () => {
        finish("gateway_direct_egress_http_completed", "completed");
        controller.close();
      });
      input.response.on("error", (error) => {
        finish("gateway_direct_egress_http_failed", "upstream_response_error", error);
        controller.error(error);
      });
    },
    cancel: () => {
      finish("gateway_direct_egress_http_cancelled", "downstream_cancelled");
      input.request.destroy();
    },
  });
}

function logDirectEgressAuthorized(input: {
  admission: DirectEgressAdmission;
  transport: DirectEgressTransport;
}): void {
  logger.info(
    directEgressLogFieldsForAdmission({
      admission: input.admission,
      event: "gateway_direct_egress_authorized",
      transport: input.transport,
    }),
    "Direct gateway egress request authorized",
  );
}

export function logDirectEgressFailure(input: {
  admission: DirectEgressAdmission | undefined;
  error: DirectEgressProxyError;
  target?: string | null;
  transport: DirectEgressTransport;
}): void {
  logger.info(
    {
      ...(input.admission === undefined
        ? {}
        : directEgressLogFieldsForAdmission({
            admission: input.admission,
            event: "gateway_direct_egress_failed",
            transport: input.transport,
          })),
      event: "gateway_direct_egress_failed",
      failureCode: input.error.code,
      status: input.error.status,
      target: input.target,
      transport: input.transport,
    },
    input.error.message,
  );
}

export function logDirectEgressWebSocketEvent(input: {
  admission: DirectEgressAdmission;
  closeCode?: number;
  closeReason?: string;
  error?: Error | undefined;
  event: string;
  outcome?: string;
  pendingClientMessageCount?: number;
  startedAtMs?: number;
  upstreamUrl?: URL;
}): void {
  logger.info(
    {
      ...directEgressLogFieldsForAdmission({
        admission: input.admission,
        event: input.event,
        transport: "websocket",
      }),
      closeCode: input.closeCode,
      closeReason: input.closeReason,
      durationMs: input.startedAtMs === undefined ? undefined : Date.now() - input.startedAtMs,
      error: input.error?.message,
      outcome: input.outcome,
      pendingClientMessageCount: input.pendingClientMessageCount,
      upstreamAuthority: input.upstreamUrl?.host,
      upstreamPath: input.upstreamUrl?.pathname,
      upstreamScheme: input.upstreamUrl?.protocol.slice(0, -1),
    },
    input.error?.message ?? "Direct gateway websocket egress event",
  );
}

function directEgressLogFieldsForAdmission(input: {
  admission: DirectEgressAdmission;
  event: string;
  transport: DirectEgressTransport;
}): DirectEgressLogFields {
  return {
    authority: input.admission.request.authority,
    ...(input.admission.kind === "managed"
      ? { egressRuleId: input.admission.classification.route.egressRuleId }
      : {}),
    event: input.event,
    host: input.admission.targetUrl.hostname,
    method: input.admission.request.method,
    path: input.admission.request.path,
    routeMode: input.admission.kind,
    sandboxInstanceId: input.admission.token.sub,
    scheme: input.admission.request.scheme,
    transport: input.transport,
  };
}
