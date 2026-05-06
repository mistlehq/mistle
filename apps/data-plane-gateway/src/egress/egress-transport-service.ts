import { request as requestHttp, type ClientRequest, type IncomingMessage } from "node:http";
import { request as requestHttps } from "node:https";
import type { Socket } from "node:net";

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

const HopByHopHeaderNames = new Set([
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
]);

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
  | "upstream_connect_failed"
  | "upstream_handshake_failed"
  | "upstream_io_error"
  | "forbidden_tunnel_state";

type SendBootstrapMessage = (message: EgressTransportMessage) => void;

type GatewayEgressStreamIdentity = {
  sandboxInstanceId: string;
  sourceBootstrapSessionId: string;
  streamId: number;
};

type ActiveGatewayEgressStream = {
  attributes: Attributes;
  finished: boolean;
  openedAtMs: number;
  request: ClientRequest;
  requestEnded: boolean;
  requestId: string;
  responseStarted: boolean;
  responseStatusCode?: number;
  sandboxInstanceId: string;
  sendBootstrapMessage: SendBootstrapMessage;
  sourceBootstrapSessionId: string;
  socket?: Socket;
  span: Span;
  streamId: number;
  totalRequestBytes: number;
  totalResponseBytes: number;
  upgraded: boolean;
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

function buildStreamAttributes(input: {
  open: EgressHttpOpen;
  sandboxInstanceId: string;
  sourceBootstrapSessionId: string;
  url: URL;
}): Attributes {
  return {
    "mistle.gateway.egress.authorization_result": "passthrough",
    "mistle.gateway.egress.request_id": input.open.requestId,
    "mistle.gateway.egress.stream_id": input.open.streamId,
    "mistle.gateway.egress.transport": "http",
    "mistle.sandbox.instance_id": input.sandboxInstanceId,
    "mistle.sandbox.tunnel.bootstrap_session_id": input.sourceBootstrapSessionId,
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

  public async handleBootstrapTransportMessage(input: {
    message: EgressTransportMessage;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
  }): Promise<boolean> {
    switch (input.message.type) {
      case "egress.http.open":
        await this.openHttpStream({
          message: input.message,
          sandboxInstanceId: input.sandboxInstanceId,
          sendBootstrapMessage: input.sendBootstrapMessage,
          sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        });
        return true;
      case "egress.http.request.body.chunk":
        return this.writeRequestBodyChunk({
          bytes: Buffer.from(input.message.bytes, "base64"),
          sandboxInstanceId: input.sandboxInstanceId,
          sourceBootstrapSessionId: input.sourceBootstrapSessionId,
          streamId: input.message.streamId,
        });
      case "egress.http.request.body.end":
        return this.endRequestBody({
          sandboxInstanceId: input.sandboxInstanceId,
          sourceBootstrapSessionId: input.sourceBootstrapSessionId,
          streamId: input.message.streamId,
        });
      case "egress.tcp.data":
        return this.writeUpgradedBytes({
          message: input.message,
          sandboxInstanceId: input.sandboxInstanceId,
          sourceBootstrapSessionId: input.sourceBootstrapSessionId,
        });
      case "egress.tcp.close":
        return this.closeUpgradedDirection({
          message: input.message,
          sandboxInstanceId: input.sandboxInstanceId,
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
    message: EgressHttpOpen;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
  }): Promise<void> {
    const key = toStreamKey({
      sandboxInstanceId: input.sandboxInstanceId,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.message.streamId,
    });
    if (this.#activeStreamsByKey.has(key)) {
      throw new GatewayEgressForbiddenTunnelStateError(
        `Egress stream '${String(input.message.streamId)}' is already active.`,
      );
    }

    const url = toUrl(input.message.request);
    const attributes = buildStreamAttributes({
      open: input.message,
      sandboxInstanceId: input.sandboxInstanceId,
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
      request: upstreamRequest,
      requestEnded: false,
      requestId: input.message.requestId,
      responseStarted: false,
      sandboxInstanceId: input.sandboxInstanceId,
      sendBootstrapMessage: input.sendBootstrapMessage,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      span,
      streamId: input.message.streamId,
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

  private handleUpstreamResponse(input: {
    response: IncomingMessage;
    sandboxInstanceId: string;
    stream: ActiveGatewayEgressStream;
  }): void {
    input.stream.responseStarted = true;
    input.stream.responseStatusCode = input.response.statusCode ?? 502;
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

  private writeRequestBodyChunk(input: {
    bytes: Buffer;
    sandboxInstanceId: string;
    sourceBootstrapSessionId: string;
    streamId: number;
  }): boolean {
    const stream = this.getActiveStream(input);
    if (stream === undefined) {
      return false;
    }
    if (stream.requestEnded || stream.upgraded) {
      throw new GatewayEgressForbiddenTunnelStateError(
        `Egress stream '${String(input.streamId)}' cannot accept request body chunks.`,
      );
    }

    stream.totalRequestBytes += input.bytes.byteLength;
    EgressStreamBytes.add(input.bytes.byteLength, {
      ...stream.attributes,
      "mistle.gateway.egress.byte_direction": "request",
    });
    stream.request.write(input.bytes);
    return true;
  }

  private endRequestBody(input: GatewayEgressStreamIdentity): boolean {
    const stream = this.getActiveStream(input);
    if (stream === undefined) {
      return false;
    }
    if (stream.requestEnded || stream.upgraded) {
      return true;
    }

    stream.requestEnded = true;
    stream.request.end();
    return true;
  }

  private writeUpgradedBytes(input: {
    message: EgressTcpData;
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
    if (!stream.upgraded || stream.socket === undefined || input.message.direction !== "request") {
      throw new GatewayEgressForbiddenTunnelStateError(
        `Egress stream '${String(input.message.streamId)}' cannot accept upgraded request bytes.`,
      );
    }

    const bytes = Buffer.from(input.message.bytes, "base64");
    stream.totalRequestBytes += bytes.byteLength;
    EgressStreamBytes.add(bytes.byteLength, {
      ...stream.attributes,
      "mistle.gateway.egress.byte_direction": "request",
    });
    stream.socket.write(bytes);
    return true;
  }

  private closeUpgradedDirection(input: {
    message: EgressTcpClose;
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
    if (!stream.upgraded || stream.socket === undefined || input.message.direction !== "request") {
      throw new GatewayEgressForbiddenTunnelStateError(
        `Egress stream '${String(input.message.streamId)}' cannot close upgraded request bytes.`,
      );
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
    message: string;
    sandboxInstanceId: string;
    sendBootstrapMessage: SendBootstrapMessage;
    sourceBootstrapSessionId: string;
    streamId: number;
  }): void {
    logger.info(
      {
        event: "gateway_egress_stream_error",
        failureCode: input.code,
        matchedManagedRoute: false,
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
    input.stream.request.destroy();
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

    logger.info(
      {
        event: "gateway_egress_passthrough",
        durationMs: input.clockNowMs - input.stream.openedAtMs,
        failureCode: input.error === undefined ? undefined : input.outcome,
        host: input.stream.attributes["server.address"],
        matchedManagedRoute: false,
        method: input.stream.attributes["http.request.method"],
        outcome: input.outcome,
        path: input.stream.attributes["url.path"],
        requestId: input.stream.requestId,
        sandboxInstanceId: input.stream.sandboxInstanceId,
        sourceBootstrapSessionId: input.stream.sourceBootstrapSessionId,
        statusCode: input.stream.responseStatusCode,
        streamId: input.stream.streamId,
      },
      input.error === undefined
        ? "Gateway egress pass-through stream finished"
        : "Gateway egress pass-through stream failed",
    );
  }
}
