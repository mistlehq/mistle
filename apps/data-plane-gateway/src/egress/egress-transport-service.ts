import {
  request as requestHttp,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
} from "node:http";
import { request as requestHttps } from "node:https";
import type { Socket } from "node:net";

import type { ControlPlaneInternalClient } from "@mistle/control-plane-internal-client";
import type { DataPlaneDatabase, DataPlaneTables } from "@mistle/db/data-plane";
import type { CompiledRuntimePlan } from "@mistle/sandbox-runtime-contract";
import {
  type EgressHttpOpen,
  type EgressStreamError,
  type EgressStreamCancel,
  type EgressTcpClose,
  type EgressTcpData,
  type EgressTransportMessage,
  type EgressHttpResponseStart,
  type EgressHttpResponseBodyChunk,
  type EgressHttpResponseBodyEnd,
} from "@mistle/sandbox-session-protocol";
import { metrics, trace, SpanStatusCode, type Attributes, type Span } from "@opentelemetry/api";

import { logger } from "../logger.js";
import type { ActiveSandboxRuntimePlanRepository } from "./active-runtime-plan-cache.js";
import {
  InvalidActiveSandboxRuntimePlanError,
  loadActiveSandboxRuntimePlan,
} from "./active-runtime-plan-loader.js";
import type { CredentialCache } from "./credential-cache.js";
import {
  buildManagedEgressRequest,
  createManagedEgressResponseTelemetryAttributes,
  GatewayManagedEgressUnsupportedRouteError,
} from "./managed-egress-request.js";
import {
  classifyRuntimePlanEgressRoute,
  type GatewayEgressRouteClassification,
} from "./runtime-plan-route-classifier.js";

const HopByHopHeaderNames = new Set([
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
]);
const Base64PayloadPattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;

const EgressTracer = trace.getTracer("@mistle/data-plane-gateway/egress");
const EgressMeter = metrics.getMeter("@mistle/data-plane-gateway/egress");
const EgressStreamEvents = EgressMeter.createCounter("mistle.gateway.egress.stream.events", {
  description: "Gateway egress stream lifecycle events observed by the data-plane gateway.",
});
const EgressStreamBytes = EgressMeter.createCounter("mistle.gateway.egress.stream.bytes", {
  description: "Gateway egress stream bytes relayed by the data-plane gateway.",
  unit: "By",
});
const EgressStreamDurationMs = EgressMeter.createHistogram(
  "mistle.gateway.egress.stream.duration",
  {
    description: "Gateway egress stream duration observed by the data-plane gateway.",
    unit: "ms",
  },
);

type RepeatedHeaderValues = Record<string, string[]>;
type EgressStreamOutcome =
  | "opened"
  | "response_started"
  | "upgraded"
  | "completed"
  | "cancelled"
  | "managed_route_ambiguous"
  | "credential_injection_failed"
  | "credential_resolution_failed"
  | "request_middleware_failed"
  | "runtime_plan_state_failed"
  | "upstream_connect_failed"
  | "upstream_handshake_failed"
  | "upstream_io_error"
  | "malformed_frame"
  | "forbidden_tunnel_state";

type SendBootstrapMessage = (message: EgressTransportMessage) => void;

type GatewayEgressStreamIdentity = {
  sandboxInstanceId: string;
  sourceBootstrapSessionId: string;
  streamId: number;
};

type ActiveGatewayEgressStream = {
  attributes: Attributes;
  bodyChunks?: Buffer[];
  finished: boolean;
  managedRoute?: CompiledRuntimePlan["egressRoutes"][number];
  openedAtMs: number;
  request?: ClientRequest;
  requestOpen: EgressHttpOpen["request"];
  requestEnded: boolean;
  requestId: string;
  responseStarted: boolean;
  responseStatusCode?: number;
  organizationId: string;
  sandboxInstanceId: string;
  sendBootstrapMessage: SendBootstrapMessage;
  sourceBootstrapSessionId: string;
  socket?: Socket;
  span: Span;
  streamId: number;
  testEnvironmentId?: string;
  totalRequestBytes: number;
  totalResponseBytes: number;
  upgraded: boolean;
};

type ManagedRouteAuthorizationFailure = {
  code: "acting_user_required";
  message: string;
};

export class GatewayEgressForbiddenTunnelStateError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "GatewayEgressForbiddenTunnelStateError";
  }
}

function toHeaderRecord(headers: RepeatedHeaderValues): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [name, values] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (HopByHopHeaderNames.has(normalizedName)) {
      continue;
    }
    if (values.length === 0) {
      continue;
    }

    const firstValue = values[0];
    if (firstValue === undefined) {
      continue;
    }

    result[normalizedName] = values.length === 1 ? firstValue : values;
  }

  return result;
}

function toRepeatedHeaderValues(headers: IncomingMessage["headers"]): RepeatedHeaderValues {
  const result: RepeatedHeaderValues = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      result[name] = value;
      continue;
    }

    result[name] = [value];
  }

  return result;
}

function toHeaders(headers: IncomingHttpHeaders): Headers {
  const result = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(name, item);
      }
      continue;
    }

    result.set(name, value);
  }

  return result;
}

function buildRequestPath(request: EgressHttpOpen["request"]): string {
  return request.query === undefined ? request.path : `${request.path}?${request.query}`;
}

function toStreamKey(input: GatewayEgressStreamIdentity): string {
  return [input.sandboxInstanceId, input.sourceBootstrapSessionId, String(input.streamId)].join(
    ":",
  );
}

function toUrl(input: EgressHttpOpen["request"]): URL {
  return new URL(`${input.scheme}://${input.authority}${buildRequestPath(input)}`);
}

// Node's base64 decoder accepts malformed input leniently, so validate the
// alphabet and padding before decoding. We intentionally avoid a decode/re-encode
// canonicality check here because egress byte chunks are on the streaming path.
function decodeValidatedBase64(payload: string): Buffer | undefined {
  if (!Base64PayloadPattern.test(payload)) {
    return undefined;
  }

  return Buffer.from(payload, "base64");
}

function buildStreamAttributes(input: {
  classification: GatewayEgressRouteClassification;
  open: EgressHttpOpen;
  organizationId: string;
  runtimePlanRevision: number;
  sandboxInstanceId: string;
  sandboxInstanceStatus: string;
  sourceBootstrapSessionId: string;
  url: URL;
}): Attributes {
  const matchedRoute =
    input.classification.kind === "matched" ? input.classification.route : undefined;
  return {
    "mistle.gateway.egress.authorization_result": "not_required",
    "mistle.gateway.egress.classification_result": input.classification.kind,
    ...(matchedRoute === undefined
      ? {}
      : {
          "mistle.gateway.egress.managed_route_id": matchedRoute.egressRuleId,
        }),
    "mistle.gateway.egress.request_id": input.open.requestId,
    ...(input.open.request.runtimePlanRevision === undefined
      ? {}
      : {
          "mistle.gateway.egress.sandbox_runtime_plan_revision":
            input.open.request.runtimePlanRevision,
        }),
    "mistle.gateway.egress.runtime_plan_revision": input.runtimePlanRevision,
    "mistle.gateway.egress.stream_id": input.open.streamId,
    "mistle.gateway.egress.transport": "http",
    "mistle.sandbox.instance_id": input.sandboxInstanceId,
    "mistle.sandbox.instance_status": input.sandboxInstanceStatus,
    "mistle.sandbox.tunnel.bootstrap_session_id": input.sourceBootstrapSessionId,
    "mistle.tenant.organization_id": input.organizationId,
    "http.request.method": input.open.request.method,
    "server.address": input.url.hostname,
    "server.port": input.url.port,
    "url.path": input.url.pathname,
  };
}

function recordStreamEvent(input: {
  attributes: Attributes;
  durationMs?: number;
  error?: Error;
  outcome: EgressStreamOutcome;
}): void {
  const eventAttributes = {
    ...input.attributes,
    "mistle.gateway.egress.outcome": input.outcome,
    ...(input.error === undefined
      ? {}
      : {
          "mistle.gateway.egress.error_name": input.error.name,
          "mistle.gateway.egress.error_message": input.error.message,
        }),
  };

  EgressStreamEvents.add(1, eventAttributes);
  if (input.durationMs !== undefined) {
    EgressStreamDurationMs.record(input.durationMs, eventAttributes);
  }
}

function finishStream(input: {
  clockNowMs: number;
  error?: Error;
  outcome: EgressStreamOutcome;
  stream: ActiveGatewayEgressStream;
}): boolean {
  if (input.stream.finished) {
    return false;
  }
  input.stream.finished = true;

  const durationMs = input.clockNowMs - input.stream.openedAtMs;
  const attributes = {
    ...input.stream.attributes,
    "mistle.gateway.egress.request_body_bytes": input.stream.totalRequestBytes,
    "mistle.gateway.egress.response_body_bytes": input.stream.totalResponseBytes,
    "mistle.gateway.egress.stream_duration_ms": durationMs,
    "mistle.gateway.egress.outcome": input.outcome,
    "mistle.gateway.egress.cancelled": input.outcome === "cancelled",
    ...(input.stream.responseStatusCode === undefined
      ? {}
      : { "http.response.status_code": input.stream.responseStatusCode }),
    ...(input.error === undefined ? {} : { "mistle.gateway.egress.failure_code": input.outcome }),
  };
  input.stream.span.setAttributes(attributes);
  if (input.error !== undefined) {
    input.stream.span.recordException(input.error);
    input.stream.span.setStatus({
      code: SpanStatusCode.ERROR,
      message: input.error.message,
    });
  } else {
    input.stream.span.setStatus({ code: SpanStatusCode.OK });
  }
  input.stream.span.end();
  recordStreamEvent({
    attributes: input.stream.attributes,
    durationMs,
    outcome: input.outcome,
    ...(input.error === undefined ? {} : { error: input.error }),
  });
  return true;
}

export class GatewayEgressTransportService {
  readonly #activeStreamsByKey = new Map<string, ActiveGatewayEgressStream>();
  readonly #openingStreamsByKey = new Map<string, Promise<void>>();

  public constructor(
    private readonly activeRuntimePlanCache: ActiveSandboxRuntimePlanRepository,
    private readonly controlPlanePublicBaseUrl: string,
    private readonly controlPlaneInternalClient: ControlPlaneInternalClient,
    private readonly credentialCache: CredentialCache,
  ) {}

  public async handleBootstrapTransportMessage(input: {
    db: DataPlaneDatabase;
    message: EgressTransportMessage;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
    tables: DataPlaneTables;
    testEnvironmentId?: string;
  }): Promise<boolean> {
    switch (input.message.type) {
      case "egress.http.open":
        return await this.startOpeningHttpStream({
          db: input.db,
          message: input.message,
          sandboxInstanceId: input.sandboxInstanceId,
          sendBootstrapMessage: input.sendBootstrapMessage,
          sourceBootstrapSessionId: input.sourceBootstrapSessionId,
          tables: input.tables,
          ...(input.testEnvironmentId === undefined
            ? {}
            : { testEnvironmentId: input.testEnvironmentId }),
        });
      case "egress.http.request.body.chunk":
        return await this.writeRequestBodyChunk({
          message: input.message,
          sandboxInstanceId: input.sandboxInstanceId,
          sendBootstrapMessage: input.sendBootstrapMessage,
          sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        });
      case "egress.http.request.body.end":
        return await this.endRequestBody({
          sandboxInstanceId: input.sandboxInstanceId,
          sendBootstrapMessage: input.sendBootstrapMessage,
          sourceBootstrapSessionId: input.sourceBootstrapSessionId,
          streamId: input.message.streamId,
        });
      case "egress.tcp.data":
        return await this.writeUpgradedBytes({
          message: input.message,
          sandboxInstanceId: input.sandboxInstanceId,
          sendBootstrapMessage: input.sendBootstrapMessage,
          sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        });
      case "egress.tcp.close":
        return await this.closeUpgradedDirection({
          message: input.message,
          sandboxInstanceId: input.sandboxInstanceId,
          sendBootstrapMessage: input.sendBootstrapMessage,
          sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        });
      case "egress.stream.cancel":
        return this.cancelStream({
          message: input.message,
          sandboxInstanceId: input.sandboxInstanceId,
          sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        });
      case "egress.http.response.start":
      case "egress.http.response.body.chunk":
      case "egress.http.response.body.end":
      case "egress.stream.error":
        this.rejectForbiddenBootstrapMessage({
          message: input.message,
          sandboxInstanceId: input.sandboxInstanceId,
          sendBootstrapMessage: input.sendBootstrapMessage,
          sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        });
        return true;
    }
  }

  public rejectMalformedBootstrapMessage(input: {
    message: string;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
    streamId: number;
  }): void {
    this.sendStreamError({
      code: "malformed_frame",
      message: input.message,
      sandboxInstanceId: input.sandboxInstanceId,
      sendBootstrapMessage: input.sendBootstrapMessage,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.streamId,
    });
  }

  public cancelStreamsForBootstrapSession(input: {
    sandboxInstanceId: string;
    sourceBootstrapSessionId: string;
  }): void {
    for (const stream of this.#activeStreamsByKey.values()) {
      if (
        stream.attributes["mistle.sandbox.instance_id"] === input.sandboxInstanceId &&
        stream.attributes["mistle.sandbox.tunnel.bootstrap_session_id"] ===
          input.sourceBootstrapSessionId
      ) {
        this.cancelActiveStream({
          outcome: "cancelled",
          stream,
        });
      }
    }
  }

  private async openHttpStream(input: {
    db: DataPlaneDatabase;
    message: EgressHttpOpen;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
    tables: DataPlaneTables;
    testEnvironmentId?: string;
  }): Promise<void> {
    const key = toStreamKey({
      sandboxInstanceId: input.sandboxInstanceId,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.message.streamId,
    });
    if (this.#activeStreamsByKey.has(key)) {
      this.rejectForbiddenStreamState({
        message: `Egress stream '${String(input.message.streamId)}' is already active.`,
        sandboxInstanceId: input.sandboxInstanceId,
        sendBootstrapMessage: input.sendBootstrapMessage,
        sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        streamId: input.message.streamId,
      });
      return;
    }

    const url = toUrl(input.message.request);
    let activeRuntimePlan: Awaited<ReturnType<typeof loadActiveSandboxRuntimePlan>>;
    try {
      activeRuntimePlan = await loadActiveSandboxRuntimePlan({
        cache: this.activeRuntimePlanCache,
        db: input.db,
        sandboxInstanceId: input.sandboxInstanceId,
        tables: input.tables,
      });
    } catch (error) {
      if (error instanceof InvalidActiveSandboxRuntimePlanError) {
        this.rejectInvalidRuntimePlanStateFailure({
          error,
          message: input.message,
          sandboxInstanceId: input.sandboxInstanceId,
          sendBootstrapMessage: input.sendBootstrapMessage,
          sourceBootstrapSessionId: input.sourceBootstrapSessionId,
          url,
        });
        return;
      }

      throw error;
    }

    if (activeRuntimePlan === null) {
      this.rejectMissingActiveRuntimePlanState({
        message: input.message,
        sandboxInstanceId: input.sandboxInstanceId,
        sendBootstrapMessage: input.sendBootstrapMessage,
        sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        ...(input.testEnvironmentId === undefined
          ? {}
          : { testEnvironmentId: input.testEnvironmentId }),
        url,
      });
      return;
    }

    const classification = classifyRuntimePlanEgressRoute({
      authority: input.message.request.authority,
      method: input.message.request.method,
      path: input.message.request.path,
      runtimePlan: activeRuntimePlan.runtimePlan,
    });
    if (classification.kind === "ambiguous") {
      this.rejectManagedRouteAmbiguity({
        classification,
        message: input.message,
        runtimePlanRevision: activeRuntimePlan.runtimePlanRevision,
        sandboxInstanceId: input.sandboxInstanceId,
        sendBootstrapMessage: input.sendBootstrapMessage,
        sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        ...(input.testEnvironmentId === undefined
          ? {}
          : { testEnvironmentId: input.testEnvironmentId }),
        url,
      });
      return;
    }
    if (classification.kind === "matched") {
      const authorizationFailure = authorizeMatchedManagedRoute({
        route: classification.route,
        ...(input.message.request.actingUserId === undefined
          ? {}
          : { actingUserId: input.message.request.actingUserId }),
      });
      if (authorizationFailure !== undefined) {
        this.rejectManagedRouteAuthorizationFailure({
          authorizationFailure,
          classification,
          message: input.message,
          runtimePlanRevision: activeRuntimePlan.runtimePlanRevision,
          sandboxInstanceId: input.sandboxInstanceId,
          sendBootstrapMessage: input.sendBootstrapMessage,
          sourceBootstrapSessionId: input.sourceBootstrapSessionId,
          url,
        });
        return;
      }

      this.openManagedHttpStream({
        activeRuntimePlan,
        classification,
        key,
        message: input.message,
        sandboxInstanceId: input.sandboxInstanceId,
        sendBootstrapMessage: input.sendBootstrapMessage,
        sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        ...(input.testEnvironmentId === undefined
          ? {}
          : { testEnvironmentId: input.testEnvironmentId }),
        url,
      });
      return;
    }

    const attributes = buildStreamAttributes({
      classification,
      open: input.message,
      organizationId: activeRuntimePlan.organizationId,
      runtimePlanRevision: activeRuntimePlan.runtimePlanRevision,
      sandboxInstanceId: input.sandboxInstanceId,
      sandboxInstanceStatus: activeRuntimePlan.sandboxInstanceStatus,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      url,
    });
    const span = EgressTracer.startSpan("data_plane_gateway.egress.http_stream", {
      attributes,
    });
    const requestHeaders = toHeaderRecord(input.message.request.headers);
    requestHeaders.host = input.message.request.authority;
    const requestFactory = input.message.request.scheme === "https" ? requestHttps : requestHttp;
    const upstreamRequest = requestFactory({
      headers: requestHeaders,
      hostname: url.hostname,
      method: input.message.request.method,
      path: `${url.pathname}${url.search}`,
      port: url.port.length === 0 ? undefined : Number(url.port),
      protocol: `${input.message.request.scheme}:`,
    });
    const stream: ActiveGatewayEgressStream = {
      attributes,
      finished: false,
      openedAtMs: Date.now(),
      organizationId: activeRuntimePlan.organizationId,
      request: upstreamRequest,
      requestOpen: input.message.request,
      requestEnded: false,
      requestId: input.message.requestId,
      responseStarted: false,
      sandboxInstanceId: input.sandboxInstanceId,
      sendBootstrapMessage: input.sendBootstrapMessage,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      span,
      streamId: input.message.streamId,
      ...(input.testEnvironmentId === undefined
        ? {}
        : { testEnvironmentId: input.testEnvironmentId }),
      totalRequestBytes: 0,
      totalResponseBytes: 0,
      upgraded: false,
    };
    this.#activeStreamsByKey.set(key, stream);
    recordStreamEvent({ attributes, outcome: "opened" });
    logger.debug(
      {
        ...attributes,
        eventName: "gateway.egress.http_stream.opened",
      },
      "Gateway egress HTTP stream opened",
    );

    upstreamRequest.on("response", (response) => {
      this.handleUpstreamResponse({
        response,
        sandboxInstanceId: input.sandboxInstanceId,
        stream,
      });
    });
    upstreamRequest.on("upgrade", (response, socket, head) => {
      this.handleUpstreamUpgrade({
        head,
        response,
        sandboxInstanceId: input.sandboxInstanceId,
        socket,
        stream,
      });
    });
    upstreamRequest.on("error", (error) => {
      const failureCode = stream.responseStarted ? "upstream_io_error" : "upstream_connect_failed";
      this.failActiveStream({
        error,
        failureCode,
        outcome: stream.responseStarted ? "upstream_io_error" : "upstream_connect_failed",
        stream,
      });
    });
  }

  private openManagedHttpStream(input: {
    activeRuntimePlan: NonNullable<Awaited<ReturnType<typeof loadActiveSandboxRuntimePlan>>>;
    classification: Extract<GatewayEgressRouteClassification, { kind: "matched" }>;
    key: string;
    message: EgressHttpOpen;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
    testEnvironmentId?: string;
    url: URL;
  }): void {
    const attributes = buildStreamAttributes({
      classification: input.classification,
      open: input.message,
      organizationId: input.activeRuntimePlan.organizationId,
      runtimePlanRevision: input.activeRuntimePlan.runtimePlanRevision,
      sandboxInstanceId: input.sandboxInstanceId,
      sandboxInstanceStatus: input.activeRuntimePlan.sandboxInstanceStatus,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      url: input.url,
    });
    const span = EgressTracer.startSpan("data_plane_gateway.egress.http_stream", {
      attributes: {
        ...attributes,
        "mistle.gateway.egress.authorization_result": "authorized",
      },
    });
    const authorizedAttributes = {
      ...attributes,
      "mistle.gateway.egress.authorization_result": "authorized",
    };
    const stream: ActiveGatewayEgressStream = {
      attributes: authorizedAttributes,
      bodyChunks: [],
      finished: false,
      managedRoute: input.classification.route,
      openedAtMs: Date.now(),
      organizationId: input.activeRuntimePlan.organizationId,
      requestOpen: input.message.request,
      requestEnded: false,
      requestId: input.message.requestId,
      responseStarted: false,
      sandboxInstanceId: input.sandboxInstanceId,
      sendBootstrapMessage: input.sendBootstrapMessage,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      span,
      streamId: input.message.streamId,
      ...(input.testEnvironmentId === undefined
        ? {}
        : { testEnvironmentId: input.testEnvironmentId }),
      totalRequestBytes: 0,
      totalResponseBytes: 0,
      upgraded: false,
    };

    this.#activeStreamsByKey.set(input.key, stream);
    recordStreamEvent({ attributes: authorizedAttributes, outcome: "opened" });
    logger.debug(
      {
        ...authorizedAttributes,
        eventName: "gateway.egress.http_stream.opened",
        matchedManagedRoute: true,
      },
      "Gateway managed egress HTTP stream opened",
    );
  }

  private async startOpeningHttpStream(input: {
    db: DataPlaneDatabase;
    message: EgressHttpOpen;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
    tables: DataPlaneTables;
    testEnvironmentId?: string;
  }): Promise<boolean> {
    const streamIdentity = {
      sandboxInstanceId: input.sandboxInstanceId,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.message.streamId,
    };
    const key = toStreamKey(streamIdentity);
    if (this.#activeStreamsByKey.has(key) || this.#openingStreamsByKey.has(key)) {
      this.rejectForbiddenStreamState({
        message: `Egress stream '${String(input.message.streamId)}' is already active.`,
        sandboxInstanceId: input.sandboxInstanceId,
        sendBootstrapMessage: input.sendBootstrapMessage,
        sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        streamId: input.message.streamId,
      });
      return true;
    }

    const openingStream = this.openHttpStream(input).finally(() => {
      this.#openingStreamsByKey.delete(key);
    });
    this.#openingStreamsByKey.set(key, openingStream);
    await openingStream;
    return true;
  }

  private handleUpstreamResponse(input: {
    response: IncomingMessage;
    sandboxInstanceId: string;
    stream: ActiveGatewayEgressStream;
  }): void {
    input.stream.responseStarted = true;
    input.stream.responseStatusCode = input.response.statusCode ?? 502;
    this.setManagedResponseTelemetry({
      headers: input.response.headers,
      stream: input.stream,
    });
    input.stream.sendBootstrapMessage({
      type: "egress.http.response.start",
      streamId: input.stream.streamId,
      status: input.response.statusCode ?? 502,
      headers: toRepeatedHeaderValues(input.response.headers),
    } satisfies EgressHttpResponseStart);
    input.stream.span.addEvent("gateway.egress.http.response_start", {
      "http.response.status_code": input.response.statusCode ?? 502,
    });
    recordStreamEvent({
      attributes: {
        ...input.stream.attributes,
        "http.response.status_code": input.response.statusCode ?? 502,
      },
      outcome: "response_started",
    });

    input.response.on("data", (chunk: Buffer) => {
      if (input.stream.finished) {
        return;
      }

      input.stream.totalResponseBytes += chunk.byteLength;
      EgressStreamBytes.add(chunk.byteLength, {
        ...input.stream.attributes,
        "mistle.gateway.egress.byte_direction": "response",
      });
      input.stream.sendBootstrapMessage({
        type: "egress.http.response.body.chunk",
        streamId: input.stream.streamId,
        bytes: chunk.toString("base64"),
        encoding: "base64",
      } satisfies EgressHttpResponseBodyChunk);
    });
    input.response.on("end", () => {
      if (input.stream.finished) {
        return;
      }

      this.#activeStreamsByKey.delete(
        toStreamKey({
          sandboxInstanceId: input.sandboxInstanceId,
          sourceBootstrapSessionId: input.stream.sourceBootstrapSessionId,
          streamId: input.stream.streamId,
        }),
      );
      input.stream.sendBootstrapMessage({
        type: "egress.http.response.body.end",
        streamId: input.stream.streamId,
      } satisfies EgressHttpResponseBodyEnd);
      this.finishActiveStream({
        clockNowMs: Date.now(),
        outcome: "completed",
        stream: input.stream,
      });
    });
    input.response.on("error", (error) => {
      if (input.stream.finished) {
        return;
      }

      this.failActiveStream({
        error,
        failureCode: "upstream_io_error",
        outcome: "upstream_io_error",
        stream: input.stream,
      });
    });
  }

  private handleUpstreamUpgrade(input: {
    head: Buffer;
    response: IncomingMessage;
    sandboxInstanceId: string;
    socket: Socket;
    stream: ActiveGatewayEgressStream;
  }): void {
    input.stream.responseStarted = true;
    input.stream.responseStatusCode = input.response.statusCode ?? 101;
    input.stream.upgraded = true;
    input.stream.socket = input.socket;
    this.setManagedResponseTelemetry({
      headers: input.response.headers,
      stream: input.stream,
    });
    input.stream.sendBootstrapMessage({
      type: "egress.http.response.start",
      streamId: input.stream.streamId,
      status: input.response.statusCode ?? 101,
      headers: toRepeatedHeaderValues(input.response.headers),
    } satisfies EgressHttpResponseStart);
    recordStreamEvent({
      attributes: {
        ...input.stream.attributes,
        "http.response.status_code": input.response.statusCode ?? 101,
      },
      outcome: "upgraded",
    });

    if (input.head.byteLength > 0) {
      this.sendUpgradedBytes({
        bytes: input.head,
        direction: "response",
        stream: input.stream,
      });
    }

    input.socket.on("data", (chunk: Buffer) => {
      if (input.stream.finished) {
        return;
      }

      this.sendUpgradedBytes({
        bytes: chunk,
        direction: "response",
        stream: input.stream,
      });
    });
    input.socket.on("end", () => {
      if (input.stream.finished) {
        return;
      }

      input.stream.sendBootstrapMessage({
        type: "egress.tcp.close",
        streamId: input.stream.streamId,
        direction: "response",
      } satisfies EgressTcpClose);
    });
    input.socket.on("close", () => {
      if (input.stream.finished) {
        return;
      }

      this.#activeStreamsByKey.delete(
        toStreamKey({
          sandboxInstanceId: input.sandboxInstanceId,
          sourceBootstrapSessionId: input.stream.sourceBootstrapSessionId,
          streamId: input.stream.streamId,
        }),
      );
      this.finishActiveStream({
        clockNowMs: Date.now(),
        outcome: "completed",
        stream: input.stream,
      });
    });
    input.socket.on("error", (error) => {
      if (input.stream.finished) {
        return;
      }

      this.failActiveStream({
        error,
        failureCode: "upstream_io_error",
        outcome: "upstream_io_error",
        stream: input.stream,
      });
    });
  }

  private setManagedResponseTelemetry(input: {
    headers: IncomingHttpHeaders;
    stream: ActiveGatewayEgressStream;
  }): void {
    const managedRoute = input.stream.managedRoute;
    if (managedRoute === undefined) {
      return;
    }

    input.stream.span.setAttributes(
      createManagedEgressResponseTelemetryAttributes({
        headers: toHeaders(input.headers),
        route: managedRoute,
      }),
    );
  }

  private async writeRequestBodyChunk(input: {
    message: Extract<EgressTransportMessage, { type: "egress.http.request.body.chunk" }>;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
  }): Promise<boolean> {
    const streamIdentity = {
      sandboxInstanceId: input.sandboxInstanceId,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.message.streamId,
    };
    await this.waitForOpeningStream(streamIdentity);
    const stream = this.getActiveStream(streamIdentity);
    if (stream === undefined) {
      this.rejectForbiddenStreamState({
        message: `Egress stream '${String(input.message.streamId)}' is not active.`,
        sandboxInstanceId: input.sandboxInstanceId,
        sendBootstrapMessage: input.sendBootstrapMessage,
        sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        streamId: input.message.streamId,
      });
      return true;
    }
    if (stream.requestEnded || stream.upgraded) {
      this.failActiveStream({
        error: new GatewayEgressForbiddenTunnelStateError(
          `Egress stream '${String(input.message.streamId)}' cannot accept request body chunks.`,
        ),
        failureCode: "forbidden_tunnel_state",
        outcome: "forbidden_tunnel_state",
        stream,
      });
      return true;
    }

    const bytes = decodeValidatedBase64(input.message.bytes);
    if (bytes === undefined) {
      this.failActiveStream({
        error: new Error("Egress HTTP request body chunk must contain valid base64 bytes."),
        failureCode: "malformed_frame",
        outcome: "malformed_frame",
        stream,
      });
      return true;
    }

    stream.totalRequestBytes += bytes.byteLength;
    EgressStreamBytes.add(bytes.byteLength, {
      ...stream.attributes,
      "mistle.gateway.egress.byte_direction": "request",
    });
    if (stream.managedRoute !== undefined) {
      stream.bodyChunks?.push(bytes);
      return true;
    }

    const request = stream.request;
    if (request === undefined) {
      this.failActiveStream({
        error: new GatewayEgressForbiddenTunnelStateError(
          `Egress stream '${String(input.message.streamId)}' has no upstream request.`,
        ),
        failureCode: "forbidden_tunnel_state",
        outcome: "forbidden_tunnel_state",
        stream,
      });
      return true;
    }

    request.write(bytes);
    return true;
  }

  private async forwardManagedHttpStream(stream: ActiveGatewayEgressStream): Promise<void> {
    const managedRoute = stream.managedRoute;
    if (managedRoute === undefined) {
      throw new Error("Expected managed route for managed egress stream.");
    }

    let managedRequestResult: Awaited<ReturnType<typeof buildManagedEgressRequest>>;
    try {
      const body =
        stream.bodyChunks === undefined || stream.bodyChunks.length === 0
          ? undefined
          : Buffer.concat(stream.bodyChunks);
      managedRequestResult = await buildManagedEgressRequest({
        body,
        controlPlanePublicBaseUrl: this.controlPlanePublicBaseUrl,
        controlPlaneInternalClient: this.controlPlaneInternalClient,
        credentialCache: this.credentialCache,
        organizationId: stream.organizationId,
        request: stream.requestOpen,
        route: managedRoute,
        sandboxInstanceId: stream.sandboxInstanceId,
        ...(stream.testEnvironmentId === undefined
          ? {}
          : { testEnvironmentId: stream.testEnvironmentId }),
      });
    } catch (error) {
      const errorObject = error instanceof Error ? error : new Error(String(error));
      const failureCode =
        errorObject instanceof GatewayManagedEgressUnsupportedRouteError
          ? errorObject.failureCode
          : "credential_resolution_failed";
      this.failActiveStream({
        error: errorObject,
        failureCode,
        outcome: failureCode,
        stream,
      });
      return;
    }

    const outgoingRequest = managedRequestResult.request;
    stream.span.setAttributes(managedRequestResult.telemetryAttributes);
    const requestFactory = outgoingRequest.url.protocol === "https:" ? requestHttps : requestHttp;
    const upstreamRequest = requestFactory({
      headers: Object.fromEntries(outgoingRequest.headers.entries()),
      hostname: outgoingRequest.url.hostname,
      method: outgoingRequest.method,
      path: `${outgoingRequest.url.pathname}${outgoingRequest.url.search}`,
      port: outgoingRequest.url.port.length === 0 ? undefined : Number(outgoingRequest.url.port),
      protocol: outgoingRequest.url.protocol,
    });
    stream.request = upstreamRequest;

    upstreamRequest.on("response", (response) => {
      this.handleUpstreamResponse({
        response,
        sandboxInstanceId: stream.sandboxInstanceId,
        stream,
      });
    });
    upstreamRequest.on("upgrade", (response, socket, head) => {
      this.handleUpstreamUpgrade({
        head,
        response,
        sandboxInstanceId: stream.sandboxInstanceId,
        socket,
        stream,
      });
    });
    upstreamRequest.on("error", (error) => {
      this.failActiveStream({
        error,
        failureCode: stream.responseStarted ? "upstream_io_error" : "upstream_connect_failed",
        outcome: stream.responseStarted ? "upstream_io_error" : "upstream_connect_failed",
        stream,
      });
    });

    if (outgoingRequest.body === undefined) {
      upstreamRequest.end();
      return;
    }

    upstreamRequest.end(outgoingRequest.body);
  }

  private async endRequestBody(
    input: GatewayEgressStreamIdentity & {
      sendBootstrapMessage: SendBootstrapMessage;
    },
  ): Promise<boolean> {
    await this.waitForOpeningStream(input);
    const stream = this.getActiveStream(input);
    if (stream === undefined) {
      this.rejectForbiddenStreamState({
        message: `Egress stream '${String(input.streamId)}' is not active.`,
        sandboxInstanceId: input.sandboxInstanceId,
        sendBootstrapMessage: input.sendBootstrapMessage,
        sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        streamId: input.streamId,
      });
      return true;
    }
    if (stream.requestEnded || stream.upgraded) {
      return true;
    }

    stream.requestEnded = true;
    if (stream.managedRoute !== undefined) {
      await this.forwardManagedHttpStream(stream);
      return true;
    }

    const request = stream.request;
    if (request === undefined) {
      this.failActiveStream({
        error: new GatewayEgressForbiddenTunnelStateError(
          `Egress stream '${String(input.streamId)}' has no upstream request.`,
        ),
        failureCode: "forbidden_tunnel_state",
        outcome: "forbidden_tunnel_state",
        stream,
      });
      return true;
    }

    request.end();
    return true;
  }

  private async writeUpgradedBytes(input: {
    message: EgressTcpData;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
  }): Promise<boolean> {
    const streamIdentity = {
      sandboxInstanceId: input.sandboxInstanceId,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.message.streamId,
    };
    await this.waitForOpeningStream(streamIdentity);
    const stream = this.getActiveStream(streamIdentity);
    if (stream === undefined) {
      this.rejectForbiddenStreamState({
        message: `Egress stream '${String(input.message.streamId)}' is not active.`,
        sandboxInstanceId: input.sandboxInstanceId,
        sendBootstrapMessage: input.sendBootstrapMessage,
        sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        streamId: input.message.streamId,
      });
      return true;
    }
    if (!stream.upgraded || stream.socket === undefined || input.message.direction !== "request") {
      this.failActiveStream({
        error: new GatewayEgressForbiddenTunnelStateError(
          `Egress stream '${String(input.message.streamId)}' cannot accept upgraded request bytes.`,
        ),
        failureCode: "forbidden_tunnel_state",
        outcome: "forbidden_tunnel_state",
        stream,
      });
      return true;
    }

    const bytes = decodeValidatedBase64(input.message.bytes);
    if (bytes === undefined) {
      this.failActiveStream({
        error: new Error("Egress TCP data frame must contain valid base64 bytes."),
        failureCode: "malformed_frame",
        outcome: "malformed_frame",
        stream,
      });
      return true;
    }

    stream.totalRequestBytes += bytes.byteLength;
    EgressStreamBytes.add(bytes.byteLength, {
      ...stream.attributes,
      "mistle.gateway.egress.byte_direction": "request",
    });
    stream.socket.write(bytes);
    return true;
  }

  private async closeUpgradedDirection(input: {
    message: EgressTcpClose;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
  }): Promise<boolean> {
    const streamIdentity = {
      sandboxInstanceId: input.sandboxInstanceId,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.message.streamId,
    };
    await this.waitForOpeningStream(streamIdentity);
    const stream = this.getActiveStream(streamIdentity);
    if (stream === undefined) {
      this.rejectForbiddenStreamState({
        message: `Egress stream '${String(input.message.streamId)}' is not active.`,
        sandboxInstanceId: input.sandboxInstanceId,
        sendBootstrapMessage: input.sendBootstrapMessage,
        sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        streamId: input.message.streamId,
      });
      return true;
    }
    if (!stream.upgraded || stream.socket === undefined || input.message.direction !== "request") {
      this.failActiveStream({
        error: new GatewayEgressForbiddenTunnelStateError(
          `Egress stream '${String(input.message.streamId)}' cannot close upgraded request bytes.`,
        ),
        failureCode: "forbidden_tunnel_state",
        outcome: "forbidden_tunnel_state",
        stream,
      });
      return true;
    }

    stream.socket.end();
    return true;
  }

  private cancelStream(input: {
    message: EgressStreamCancel;
    sandboxInstanceId: string;
    sourceBootstrapSessionId: string;
  }): boolean {
    const stream = this.getActiveStream({
      sandboxInstanceId: input.sandboxInstanceId,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.message.streamId,
    });
    if (stream === undefined) {
      return false;
    }

    this.cancelActiveStream({
      outcome: "cancelled",
      stream,
    });
    return true;
  }

  private sendUpgradedBytes(input: {
    bytes: Buffer;
    direction: "response";
    stream: ActiveGatewayEgressStream;
  }): void {
    input.stream.totalResponseBytes += input.bytes.byteLength;
    EgressStreamBytes.add(input.bytes.byteLength, {
      ...input.stream.attributes,
      "mistle.gateway.egress.byte_direction": input.direction,
    });
    input.stream.sendBootstrapMessage({
      type: "egress.tcp.data",
      streamId: input.stream.streamId,
      direction: input.direction,
      bytes: input.bytes.toString("base64"),
      encoding: "base64",
    } satisfies EgressTcpData);
  }

  private getActiveStream(
    input: GatewayEgressStreamIdentity,
  ): ActiveGatewayEgressStream | undefined {
    return this.#activeStreamsByKey.get(toStreamKey(input));
  }

  private async waitForOpeningStream(input: GatewayEgressStreamIdentity): Promise<void> {
    const openingStream = this.#openingStreamsByKey.get(toStreamKey(input));
    if (openingStream === undefined) {
      return;
    }

    await openingStream;
  }

  private rejectForbiddenBootstrapMessage(input: {
    message: Extract<
      EgressTransportMessage,
      {
        type:
          | "egress.http.response.start"
          | "egress.http.response.body.chunk"
          | "egress.http.response.body.end"
          | "egress.stream.error";
      }
    >;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
  }): void {
    const errorMessage = `Bootstrap tunnel cannot send gateway-owned egress message '${input.message.type}'.`;
    const stream = this.getActiveStream({
      sandboxInstanceId: input.sandboxInstanceId,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.message.streamId,
    });
    if (stream === undefined) {
      this.sendStreamError({
        code: "forbidden_tunnel_state",
        message: errorMessage,
        sandboxInstanceId: input.sandboxInstanceId,
        sendBootstrapMessage: input.sendBootstrapMessage,
        sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        streamId: input.message.streamId,
      });
      return;
    }

    this.failActiveStream({
      error: new GatewayEgressForbiddenTunnelStateError(errorMessage),
      failureCode: "forbidden_tunnel_state",
      outcome: "forbidden_tunnel_state",
      stream,
    });
  }

  private rejectForbiddenStreamState(input: {
    message: string;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
    streamId: number;
  }): void {
    const stream = this.getActiveStream({
      sandboxInstanceId: input.sandboxInstanceId,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.streamId,
    });
    if (stream === undefined) {
      this.sendStreamError({
        code: "forbidden_tunnel_state",
        message: input.message,
        sandboxInstanceId: input.sandboxInstanceId,
        sendBootstrapMessage: input.sendBootstrapMessage,
        sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        streamId: input.streamId,
      });
      return;
    }

    this.failActiveStream({
      error: new GatewayEgressForbiddenTunnelStateError(input.message),
      failureCode: "forbidden_tunnel_state",
      outcome: "forbidden_tunnel_state",
      stream,
    });
  }

  private failActiveStream(input: {
    error: Error;
    failureCode: EgressStreamError["code"];
    outcome: EgressStreamOutcome;
    stream: ActiveGatewayEgressStream;
  }): void {
    if (input.stream.finished) {
      return;
    }

    this.#activeStreamsByKey.delete(
      toStreamKey({
        sandboxInstanceId: input.stream.sandboxInstanceId,
        sourceBootstrapSessionId: input.stream.sourceBootstrapSessionId,
        streamId: input.stream.streamId,
      }),
    );
    this.sendStreamError({
      code: input.failureCode,
      message: input.error.message,
      sandboxInstanceId: input.stream.sandboxInstanceId,
      sendBootstrapMessage: input.stream.sendBootstrapMessage,
      sourceBootstrapSessionId: input.stream.sourceBootstrapSessionId,
      streamId: input.stream.streamId,
    });
    this.cancelActiveStream({
      error: input.error,
      outcome: input.outcome,
      stream: input.stream,
    });
  }

  private sendStreamError(input: {
    code: EgressStreamError["code"];
    eventAttributes?: Record<string, string | number | boolean | null | undefined>;
    message: string;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
    streamId: number;
  }): void {
    logger.info(
      {
        ...input.eventAttributes,
        event: "gateway_egress_stream_error",
        failureCode: input.code,
        sandboxInstanceId: input.sandboxInstanceId,
        sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        streamId: input.streamId,
      },
      input.message,
    );
    input.sendBootstrapMessage({
      type: "egress.stream.error",
      streamId: input.streamId,
      code: input.code,
      message: input.message,
    } satisfies EgressStreamError);
  }

  private cancelActiveStream(input: {
    error?: Error;
    outcome: EgressStreamOutcome;
    stream: ActiveGatewayEgressStream;
  }): void {
    this.#activeStreamsByKey.delete(
      toStreamKey({
        sandboxInstanceId: input.stream.sandboxInstanceId,
        sourceBootstrapSessionId: input.stream.sourceBootstrapSessionId,
        streamId: input.stream.streamId,
      }),
    );
    this.finishActiveStream({
      clockNowMs: Date.now(),
      outcome: input.outcome,
      stream: input.stream,
      ...(input.error === undefined ? {} : { error: input.error }),
    });
    input.stream.request?.destroy();
    input.stream.socket?.destroy();
  }

  private finishActiveStream(input: {
    clockNowMs: number;
    error?: Error;
    outcome: EgressStreamOutcome;
    stream: ActiveGatewayEgressStream;
  }): void {
    const finished = finishStream(input);
    if (!finished) {
      return;
    }

    const matchedManagedRoute =
      input.stream.attributes["mistle.gateway.egress.classification_result"] === "matched";
    logger.info(
      {
        event: matchedManagedRoute ? "gateway_egress_managed" : "gateway_egress_passthrough",
        durationMs: input.clockNowMs - input.stream.openedAtMs,
        failureCode: input.error === undefined ? undefined : input.outcome,
        host: input.stream.attributes["server.address"],
        managedRouteId: input.stream.attributes["mistle.gateway.egress.managed_route_id"],
        matchedManagedRoute,
        method: input.stream.attributes["http.request.method"],
        outcome: input.outcome,
        path: input.stream.attributes["url.path"],
        requestId: input.stream.requestId,
        sandboxInstanceId: input.stream.sandboxInstanceId,
        sourceBootstrapSessionId: input.stream.sourceBootstrapSessionId,
        statusCode: input.stream.responseStatusCode,
        streamId: input.stream.streamId,
      },
      input.error === undefined ? "Gateway egress stream finished" : "Gateway egress stream failed",
    );
  }

  private rejectMissingActiveRuntimePlanState(input: {
    message: EgressHttpOpen;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
    url: URL;
  }): void {
    this.sendStreamError({
      code: "forbidden_tunnel_state",
      eventAttributes: {
        authorizationResult: "denied",
        classificationResult: "runtime_plan_unavailable",
        host: input.url.hostname,
        matchedManagedRoute: false,
        method: input.message.request.method,
        path: input.url.pathname,
        requestId: input.message.requestId,
      },
      message: `Sandbox instance '${input.sandboxInstanceId}' was not found with an active runtime plan while authorizing gateway egress.`,
      sandboxInstanceId: input.sandboxInstanceId,
      sendBootstrapMessage: input.sendBootstrapMessage,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.message.streamId,
    });
  }

  private rejectInvalidRuntimePlanStateFailure(input: {
    error: InvalidActiveSandboxRuntimePlanError;
    message: EgressHttpOpen;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
    url: URL;
  }): void {
    this.sendStreamError({
      code: "forbidden_tunnel_state",
      eventAttributes: {
        authorizationResult: "denied",
        classificationResult: "runtime_plan_invalid",
        host: input.url.hostname,
        matchedManagedRoute: false,
        method: input.message.request.method,
        path: input.url.pathname,
        requestId: input.message.requestId,
        runtimePlanError: input.error.message,
        runtimePlanRevision: input.error.details.runtimePlanRevision,
      },
      message: `Sandbox instance '${input.sandboxInstanceId}' has an invalid active runtime plan for gateway egress.`,
      sandboxInstanceId: input.sandboxInstanceId,
      sendBootstrapMessage: input.sendBootstrapMessage,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.message.streamId,
    });
  }

  private rejectManagedRouteAmbiguity(input: {
    classification: Extract<GatewayEgressRouteClassification, { kind: "ambiguous" }>;
    message: EgressHttpOpen;
    runtimePlanRevision: number;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
    url: URL;
  }): void {
    const routeIds = input.classification.routes.map((route) => route.egressRuleId);
    this.sendStreamError({
      code: "forbidden_tunnel_state",
      eventAttributes: {
        authorizationResult: "denied",
        classificationResult: "ambiguous",
        host: input.url.hostname,
        matchedManagedRoute: true,
        method: input.message.request.method,
        path: input.url.pathname,
        requestId: input.message.requestId,
        runtimePlanRevision: input.runtimePlanRevision,
        routeIds: routeIds.join(","),
      },
      message: `Multiple managed egress routes matched ${input.message.request.method} ${input.message.request.authority}${input.message.request.path}: ${routeIds.join(", ")}.`,
      sandboxInstanceId: input.sandboxInstanceId,
      sendBootstrapMessage: input.sendBootstrapMessage,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.message.streamId,
    });
  }

  private rejectManagedRouteAuthorizationFailure(input: {
    authorizationFailure: ManagedRouteAuthorizationFailure;
    classification: Extract<GatewayEgressRouteClassification, { kind: "matched" }>;
    message: EgressHttpOpen;
    runtimePlanRevision: number;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
    url: URL;
  }): void {
    this.sendStreamError({
      code: "forbidden_tunnel_state",
      eventAttributes: {
        authorizationFailureCode: input.authorizationFailure.code,
        authorizationResult: "denied",
        classificationResult: "matched",
        host: input.url.hostname,
        managedRouteId: input.classification.route.egressRuleId,
        matchedManagedRoute: true,
        method: input.message.request.method,
        path: input.url.pathname,
        requestId: input.message.requestId,
        runtimePlanRevision: input.runtimePlanRevision,
      },
      message: input.authorizationFailure.message,
      sandboxInstanceId: input.sandboxInstanceId,
      sendBootstrapMessage: input.sendBootstrapMessage,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.message.streamId,
    });
  }
}

function authorizeMatchedManagedRoute(input: {
  actingUserId?: string;
  route: Extract<GatewayEgressRouteClassification, { kind: "matched" }>["route"];
}): ManagedRouteAuthorizationFailure | undefined {
  if (
    input.actingUserId === undefined &&
    input.route.credentialResolver.kind === "linked_principal" &&
    input.route.credentialResolver.actingUserRequired
  ) {
    return {
      code: "acting_user_required",
      message: `Managed egress route '${input.route.egressRuleId}' requires acting-user context, but gateway egress did not receive one.`,
    };
  }

  const actingUserRequiredAdditionalHeader = input.route.additionalCredentialHeaders?.find(
    (header) =>
      header.credentialResolver.kind === "linked_principal" &&
      header.credentialResolver.actingUserRequired,
  );
  if (input.actingUserId === undefined && actingUserRequiredAdditionalHeader !== undefined) {
    return {
      code: "acting_user_required",
      message: `Managed egress route '${input.route.egressRuleId}' additional credential header '${actingUserRequiredAdditionalHeader.header}' requires acting-user context, but gateway egress did not receive one.`,
    };
  }

  return undefined;
}
