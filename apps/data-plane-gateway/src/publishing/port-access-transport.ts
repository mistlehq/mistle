import {
  type PortAccessTarget,
  type PortsHttpBodyChunk,
  type PortsHttpBodyEnd,
  type PortsHttpOpen,
  type PortsHttpResponseStart,
  type PortsWsAccept,
  type PortsWsClose,
  type PortsWsFrame,
  type PortsWsOpen,
  type PortsStreamError,
  type PortsTransportMessage,
} from "@mistle/sandbox-session-protocol";
import { metrics, SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";
import type { WSContext } from "hono/ws";
import type WebSocket from "ws";

import { logger } from "../logger.js";
import { BootstrapTunnelNotConnectedError } from "../tunnel/bootstrap-tunnel-not-connected-error.js";
import type { TunnelRelayCoordinator } from "../tunnel/relay-coordinator.js";
import type { RelayTarget } from "../tunnel/types.js";
import { PortAccessSessionCookieName } from "./auth/port-access-session.js";

const HopByHopHeaderNames = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);
const BootstrapDisconnectedCloseReason = "Sandbox bootstrap tunnel disconnected.";
const PortAccessTracer = trace.getTracer("@mistle/data-plane-gateway/port-access");
const PortAccessMeter = metrics.getMeter("@mistle/data-plane-gateway/port-access");
const PortAccessStreamEvents = PortAccessMeter.createCounter("mistle.port_access.stream.events", {
  description: "Port Access stream lifecycle events observed by the data-plane gateway.",
});
const PortAccessStreamDurationMs = PortAccessMeter.createHistogram(
  "mistle.port_access.stream.duration",
  {
    description: "Port Access stream duration observed by the data-plane gateway.",
    unit: "ms",
  },
);

type RepeatedHeaderValues = Record<string, string[]>;
type PortAccessStreamKind = "http" | "websocket";
type PortAccessStreamOutcome =
  | "opened"
  | "response_started"
  | "completed"
  | "browser_closed"
  | "browser_error"
  | "bootstrap_disconnected"
  | "stream_error";

type ActivePortAccessHttpStream = {
  attributes: Attributes;
  observabilityFinished: boolean;
  openedAtMs: number;
  portAccessSpan: Span;
  responseStarted: boolean;
  rejectResponseStart: (error: Error) => void;
  resolveResponseStart: (responseStart: PortsHttpResponseStart) => void;
  responseBodyWriter: WritableStreamDefaultWriter<Uint8Array>;
  targetBootstrapSessionId: string;
};

type PortAccessWebSocketPendingEvent =
  | { kind: "frame"; message: PortsWsFrame }
  | { kind: "close"; message: PortsWsClose };

type ActivePortAccessWebSocketStream = {
  accepted: boolean;
  attributes: Attributes;
  browserClosed: boolean;
  observabilityFinished: boolean;
  openedAtMs: number;
  pendingEvents: PortAccessWebSocketPendingEvent[];
  portAccessSpan: Span;
  rejectAccept: (error: Error) => void;
  resolveAccept: (accept: PortsWsAccept) => void;
  socket?: WSContext<WebSocket>;
  targetBootstrapSessionId: string;
};

export type PortAccessHttpRequestHandle = {
  close: () => Promise<void>;
  finishRequestBody: () => Promise<void>;
  responseBody: ReadableStream<Uint8Array>;
  responseStart: Promise<PortsHttpResponseStart>;
  sendRequestBodyChunk: (bytes: Uint8Array) => Promise<void>;
};

export type PortAccessWebSocketHandle = {
  accepted: Promise<PortsWsAccept>;
  attachSocket: (socket: WSContext<WebSocket>) => void;
  notifyBrowserClose: (input: { code: number; reason: string }) => Promise<void>;
  notifyBrowserError: (error: Error) => Promise<void>;
  notifyBrowserFrame: (input: {
    bytes: Uint8Array;
    opcode: PortsWsFrame["opcode"];
  }) => Promise<void>;
};

export class PortAccessTransportBootstrapDisconnectedError extends Error {
  public constructor(sandboxInstanceId: string) {
    super(
      `Sandbox bootstrap tunnel disconnected before port access transport completed for sandbox '${sandboxInstanceId}'.`,
    );
  }
}

export class PortAccessTransportStreamError extends Error {
  public readonly code: PortsStreamError["code"];

  public constructor(input: { code: PortsStreamError["code"]; message: string }) {
    super(input.message);
    this.code = input.code;
  }
}

function stripPortAccessSessionCookie(cookieHeader: string): string | undefined {
  const remainingSegments = cookieHeader
    .split(";")
    .map((segment) => segment.trim())
    .filter(
      (segment) => segment.length > 0 && !segment.startsWith(`${PortAccessSessionCookieName}=`),
    );
  if (remainingSegments.length === 0) {
    return undefined;
  }

  return remainingSegments.join("; ");
}

function getPortAccessTargetAttributes(target: PortAccessTarget): Attributes {
  if (target.kind === "port") {
    return {
      "mistle.port_access.target_kind": target.kind,
      "mistle.port_access.target_port": target.port,
    };
  }

  return {
    "mistle.port_access.target_kind": target.kind,
  };
}

function buildPortAccessStreamAttributes(input: {
  sandboxInstanceId: string;
  streamId: number;
  streamKind: PortAccessStreamKind;
  target: PortAccessTarget;
  targetBootstrapSessionId: string;
  upstreamProtocol: "http" | "https";
}): Attributes {
  return {
    "mistle.sandbox.instance_id": input.sandboxInstanceId,
    "mistle.port_access.stream_id": input.streamId,
    "mistle.port_access.stream_kind": input.streamKind,
    "mistle.port_access.upstream_protocol": input.upstreamProtocol,
    "mistle.port_access.target_bootstrap_session_id": input.targetBootstrapSessionId,
    ...getPortAccessTargetAttributes(input.target),
  };
}

function recordPortAccessStreamEvent(input: {
  attributes: Attributes;
  durationMs?: number;
  error?: Error;
  outcome: PortAccessStreamOutcome;
}): void {
  const eventAttributes = {
    ...input.attributes,
    "mistle.port_access.outcome": input.outcome,
    ...(input.error === undefined
      ? {}
      : {
          "mistle.port_access.error_name": input.error.name,
          "mistle.port_access.error_message": input.error.message,
        }),
  };

  PortAccessStreamEvents.add(1, eventAttributes);
  if (input.durationMs !== undefined) {
    PortAccessStreamDurationMs.record(input.durationMs, eventAttributes);
  }
}

function startPortAccessStreamSpan(input: {
  attributes: Attributes;
  streamKind: PortAccessStreamKind;
}): Span {
  return PortAccessTracer.startSpan(`data_plane_gateway.port_access.${input.streamKind}_stream`, {
    attributes: input.attributes,
  });
}

function finishPortAccessStream(input: {
  attributes: Attributes;
  durationMs: number;
  error?: Error;
  outcome: PortAccessStreamOutcome;
  span: Span;
}): void {
  input.span.setAttributes({
    "mistle.port_access.duration_ms": input.durationMs,
    "mistle.port_access.outcome": input.outcome,
    ...(input.error === undefined
      ? {}
      : {
          "mistle.port_access.error_name": input.error.name,
          "mistle.port_access.error_message": input.error.message,
        }),
  });

  if (input.error !== undefined) {
    input.span.recordException(input.error);
    input.span.setStatus({
      code: SpanStatusCode.ERROR,
      message: input.error.message,
    });
  }

  recordPortAccessStreamEvent({
    attributes: input.attributes,
    durationMs: input.durationMs,
    ...(input.error === undefined ? {} : { error: input.error }),
    outcome: input.outcome,
  });
  input.span.end();
}

export function buildPortAccessRequestHeaders(input: {
  browserEdgePort: string;
  browserEdgeProto: "http" | "https";
  browserVisibleHost: string;
  requestHeaders: Headers;
  targetPort: number;
  upstreamProtocol: "http" | "https";
}): RepeatedHeaderValues {
  const tunneledHeaders: RepeatedHeaderValues = {};

  for (const [headerName, value] of input.requestHeaders.entries()) {
    const normalizedHeaderName = headerName.toLowerCase();
    if (HopByHopHeaderNames.has(normalizedHeaderName) || normalizedHeaderName === "host") {
      continue;
    }

    if (normalizedHeaderName === "cookie") {
      const sanitizedCookieHeader = stripPortAccessSessionCookie(value);
      if (sanitizedCookieHeader === undefined) {
        continue;
      }

      tunneledHeaders.cookie = [sanitizedCookieHeader];
      continue;
    }

    if (normalizedHeaderName === "origin") {
      tunneledHeaders.origin = [
        `${input.upstreamProtocol}://127.0.0.1:${String(input.targetPort)}`,
      ];
      continue;
    }

    tunneledHeaders[normalizedHeaderName] = [value];
  }

  tunneledHeaders.host = [`127.0.0.1:${String(input.targetPort)}`];
  tunneledHeaders["x-forwarded-host"] = [input.browserVisibleHost];
  tunneledHeaders["x-forwarded-proto"] = [input.browserEdgeProto];
  tunneledHeaders["x-forwarded-port"] = [input.browserEdgePort];

  return tunneledHeaders;
}

export function toPortAccessResponseHeaders(headers: PortsHttpResponseStart["headers"]): Headers {
  const responseHeaders = new Headers();
  for (const [headerName, values] of Object.entries(headers)) {
    for (const value of values) {
      responseHeaders.append(headerName, value);
    }
  }

  return responseHeaders;
}

export class PortAccessTransportService {
  readonly #activeHttpStreamsBySandboxInstanceId = new Map<
    string,
    Map<number, ActivePortAccessHttpStream>
  >();
  readonly #activeWebSocketStreamsBySandboxInstanceId = new Map<
    string,
    Map<number, ActivePortAccessWebSocketStream>
  >();
  #nextStreamId = 1;

  public constructor(
    private readonly relayCoordinator: Pick<
      TunnelRelayCoordinator,
      "forwardPeerMessage" | "getBootstrapPeer"
    >,
  ) {}

  public async openHttpStream(input: {
    request: PortsHttpOpen["request"];
    sandboxInstanceId: string;
    target: PortAccessTarget;
    upstreamProtocol: "http" | "https";
  }): Promise<PortAccessHttpRequestHandle> {
    const bootstrapTarget = this.requireBootstrapTarget({
      sandboxInstanceId: input.sandboxInstanceId,
    });

    const streamId = this.allocateStreamId();
    const openedAtMs = Date.now();
    const streamAttributes = buildPortAccessStreamAttributes({
      sandboxInstanceId: input.sandboxInstanceId,
      streamId,
      streamKind: "http",
      target: input.target,
      targetBootstrapSessionId: bootstrapTarget.sessionId,
      upstreamProtocol: input.upstreamProtocol,
    });
    const portAccessSpan = startPortAccessStreamSpan({
      attributes: streamAttributes,
      streamKind: "http",
    });
    recordPortAccessStreamEvent({
      attributes: streamAttributes,
      outcome: "opened",
    });
    logger.debug(
      {
        ...streamAttributes,
        eventName: "gateway.port_access.http_stream.opened",
      },
      "Port Access HTTP stream opened",
    );
    const responseStream = new TransformStream<Uint8Array, Uint8Array>();
    const responseBodyWriter = responseStream.writable.getWriter();
    let resolveResponseStart: ((responseStart: PortsHttpResponseStart) => void) | undefined;
    let rejectResponseStart: ((error: Error) => void) | undefined;
    const responseStart = new Promise<PortsHttpResponseStart>((resolve, reject) => {
      resolveResponseStart = resolve;
      rejectResponseStart = reject;
    });
    if (resolveResponseStart === undefined || rejectResponseStart === undefined) {
      throw new Error("Port access responseStart promise callbacks were not initialized.");
    }

    this.setActiveHttpStream({
      sandboxInstanceId: input.sandboxInstanceId,
      streamId,
      stream: {
        attributes: streamAttributes,
        observabilityFinished: false,
        openedAtMs,
        portAccessSpan,
        responseStarted: false,
        rejectResponseStart,
        resolveResponseStart,
        responseBodyWriter,
        targetBootstrapSessionId: bootstrapTarget.sessionId,
      },
    });

    try {
      await this.forwardMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        targetBootstrapSessionId: bootstrapTarget.sessionId,
        payload: JSON.stringify({
          type: "ports.http.open",
          streamId,
          target: input.target,
          upstreamProtocol: input.upstreamProtocol,
          request: input.request,
        } satisfies PortsHttpOpen),
      });
    } catch (error) {
      this.deleteActiveHttpStream({
        sandboxInstanceId: input.sandboxInstanceId,
        streamId,
      });
      await responseBodyWriter.abort(error);
      const streamError = error instanceof Error ? error : new Error(String(error));
      finishPortAccessStream({
        attributes: streamAttributes,
        durationMs: Date.now() - openedAtMs,
        error: streamError,
        outcome: "stream_error",
        span: portAccessSpan,
      });
      logger.warn(
        {
          ...streamAttributes,
          err: streamError,
          eventName: "gateway.port_access.http_stream.open_failed",
        },
        "Port Access HTTP stream failed to open",
      );
      throw error;
    }

    return {
      close: async () => {
        const activeStream = this.getActiveHttpStream({
          sandboxInstanceId: input.sandboxInstanceId,
          streamId,
        });
        this.deleteActiveHttpStream({
          sandboxInstanceId: input.sandboxInstanceId,
          streamId,
        });
        await responseBodyWriter.abort();
        if (activeStream !== undefined) {
          this.finishHttpStreamObservability({
            outcome: "browser_closed",
            stream: activeStream,
          });
        }
        logger.debug(
          {
            ...streamAttributes,
            eventName: "gateway.port_access.http_stream.browser_closed",
          },
          "Port Access HTTP stream closed by browser",
        );
        await this.forwardMessage({
          sandboxInstanceId: input.sandboxInstanceId,
          targetBootstrapSessionId: bootstrapTarget.sessionId,
          payload: JSON.stringify({
            type: "ports.stream.close",
            streamId,
          }),
        });
      },
      finishRequestBody: async () => {
        await this.forwardMessage({
          sandboxInstanceId: input.sandboxInstanceId,
          targetBootstrapSessionId: bootstrapTarget.sessionId,
          payload: JSON.stringify({
            type: "ports.http.body.end",
            streamId,
            direction: "request",
          } satisfies PortsHttpBodyEnd),
        });
      },
      responseBody: responseStream.readable,
      responseStart,
      sendRequestBodyChunk: async (bytes) => {
        await this.forwardMessage({
          sandboxInstanceId: input.sandboxInstanceId,
          targetBootstrapSessionId: bootstrapTarget.sessionId,
          payload: JSON.stringify({
            type: "ports.http.body.chunk",
            streamId,
            direction: "request",
            bytes: Buffer.from(bytes).toString("base64"),
            encoding: "base64",
          } satisfies PortsHttpBodyChunk),
        });
      },
    };
  }

  public async openWebSocketStream(input: {
    request: PortsWsOpen["request"];
    sandboxInstanceId: string;
    target: PortAccessTarget;
    upstreamProtocol: "http" | "https";
  }): Promise<PortAccessWebSocketHandle> {
    const bootstrapTarget = this.requireBootstrapTarget({
      sandboxInstanceId: input.sandboxInstanceId,
    });

    const streamId = this.allocateStreamId();
    const openedAtMs = Date.now();
    const streamAttributes = buildPortAccessStreamAttributes({
      sandboxInstanceId: input.sandboxInstanceId,
      streamId,
      streamKind: "websocket",
      target: input.target,
      targetBootstrapSessionId: bootstrapTarget.sessionId,
      upstreamProtocol: input.upstreamProtocol,
    });
    const portAccessSpan = startPortAccessStreamSpan({
      attributes: streamAttributes,
      streamKind: "websocket",
    });
    recordPortAccessStreamEvent({
      attributes: streamAttributes,
      outcome: "opened",
    });
    logger.debug(
      {
        ...streamAttributes,
        eventName: "gateway.port_access.websocket_stream.opened",
      },
      "Port Access websocket stream opened",
    );
    let resolveAccept: ((accept: PortsWsAccept) => void) | undefined;
    let rejectAccept: ((error: Error) => void) | undefined;
    const accepted = new Promise<PortsWsAccept>((resolve, reject) => {
      resolveAccept = resolve;
      rejectAccept = reject;
    });
    if (resolveAccept === undefined || rejectAccept === undefined) {
      throw new Error("Port access websocket accept promise callbacks were not initialized.");
    }

    this.setActiveWebSocketStream({
      sandboxInstanceId: input.sandboxInstanceId,
      streamId,
      stream: {
        accepted: false,
        attributes: streamAttributes,
        browserClosed: false,
        observabilityFinished: false,
        openedAtMs,
        pendingEvents: [],
        portAccessSpan,
        rejectAccept,
        resolveAccept,
        targetBootstrapSessionId: bootstrapTarget.sessionId,
      },
    });

    try {
      await this.forwardMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        targetBootstrapSessionId: bootstrapTarget.sessionId,
        payload: JSON.stringify({
          type: "ports.ws.open",
          streamId,
          target: input.target,
          upstreamProtocol: input.upstreamProtocol,
          request: input.request,
        } satisfies PortsWsOpen),
      });
    } catch (error) {
      this.deleteActiveWebSocketStream({
        sandboxInstanceId: input.sandboxInstanceId,
        streamId,
      });
      const streamError = error instanceof Error ? error : new Error(String(error));
      rejectAccept(streamError);
      finishPortAccessStream({
        attributes: streamAttributes,
        durationMs: Date.now() - openedAtMs,
        error: streamError,
        outcome: "stream_error",
        span: portAccessSpan,
      });
      logger.warn(
        {
          ...streamAttributes,
          err: streamError,
          eventName: "gateway.port_access.websocket_stream.open_failed",
        },
        "Port Access websocket stream failed to open",
      );
      throw error;
    }

    return {
      accepted,
      attachSocket: (socket) => {
        this.attachWebSocket({
          sandboxInstanceId: input.sandboxInstanceId,
          socket,
          streamId,
        });
      },
      notifyBrowserClose: async ({ code, reason }) => {
        await this.closeWebSocketFromBrowser({
          code,
          reason,
          sandboxInstanceId: input.sandboxInstanceId,
          streamId,
        });
      },
      notifyBrowserError: async (error) => {
        await this.failWebSocketFromBrowser({
          error,
          sandboxInstanceId: input.sandboxInstanceId,
          streamId,
        });
      },
      notifyBrowserFrame: async ({ bytes, opcode }) => {
        await this.forwardMessage({
          sandboxInstanceId: input.sandboxInstanceId,
          targetBootstrapSessionId: bootstrapTarget.sessionId,
          payload: JSON.stringify({
            type: "ports.ws.frame",
            streamId,
            direction: "request",
            opcode,
            bytes: Buffer.from(bytes).toString("base64"),
            encoding: "base64",
          } satisfies PortsWsFrame),
        });
      },
    };
  }

  public async handleBootstrapTransportMessage(input: {
    message: PortsTransportMessage;
    sandboxInstanceId: string;
    sourceBootstrapSessionId: string;
  }): Promise<boolean> {
    const activeHttpStream = this.getMatchingActiveHttpStream({
      sandboxInstanceId: input.sandboxInstanceId,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.message.streamId,
    });
    const activeWebSocketStream = this.getMatchingActiveWebSocketStream({
      sandboxInstanceId: input.sandboxInstanceId,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.message.streamId,
    });

    switch (input.message.type) {
      case "ports.http.response.start": {
        if (activeHttpStream === undefined) {
          return false;
        }
        activeHttpStream.responseStarted = true;
        activeHttpStream.resolveResponseStart(input.message);
        activeHttpStream.portAccessSpan.addEvent("gateway.port_access.http.response_start", {
          "mistle.port_access.http.status_code": input.message.status,
        });
        recordPortAccessStreamEvent({
          attributes: {
            ...activeHttpStream.attributes,
            "mistle.port_access.http.status_code": input.message.status,
          },
          outcome: "response_started",
        });
        logger.debug(
          {
            ...activeHttpStream.attributes,
            eventName: "gateway.port_access.http_stream.response_started",
            status: input.message.status,
          },
          "Port Access HTTP response started",
        );
        return true;
      }
      case "ports.http.body.chunk": {
        if (activeHttpStream === undefined) {
          return false;
        }
        if (input.message.direction !== "response") {
          await this.failHttpStream({
            error: new PortAccessTransportStreamError({
              code: "upstream_io_error",
              message: "Gateway received a non-response body chunk from sandboxd.",
            }),
            sandboxInstanceId: input.sandboxInstanceId,
            streamId: input.message.streamId,
          });
          return true;
        }

        await activeHttpStream.responseBodyWriter.write(
          Uint8Array.from(Buffer.from(input.message.bytes, "base64")),
        );
        return true;
      }
      case "ports.http.body.end": {
        if (activeHttpStream === undefined) {
          return false;
        }
        this.deleteActiveHttpStream({
          sandboxInstanceId: input.sandboxInstanceId,
          streamId: input.message.streamId,
        });
        await activeHttpStream.responseBodyWriter.close();
        this.finishHttpStreamObservability({
          outcome: "completed",
          stream: activeHttpStream,
        });
        logger.debug(
          {
            ...activeHttpStream.attributes,
            eventName: "gateway.port_access.http_stream.completed",
          },
          "Port Access HTTP stream completed",
        );
        return true;
      }
      case "ports.ws.accept": {
        if (activeWebSocketStream === undefined) {
          return false;
        }

        activeWebSocketStream.accepted = true;
        activeWebSocketStream.resolveAccept(input.message);
        activeWebSocketStream.portAccessSpan.addEvent("gateway.port_access.websocket.accepted");
        recordPortAccessStreamEvent({
          attributes: activeWebSocketStream.attributes,
          outcome: "response_started",
        });
        logger.debug(
          {
            ...activeWebSocketStream.attributes,
            eventName: "gateway.port_access.websocket_stream.accepted",
          },
          "Port Access websocket stream accepted",
        );
        return true;
      }
      case "ports.ws.frame": {
        if (activeWebSocketStream === undefined) {
          return false;
        }
        if (input.message.direction !== "response") {
          await this.failWebSocketStream({
            error: new PortAccessTransportStreamError({
              code: "upstream_io_error",
              message: "Gateway received a non-response websocket frame from sandboxd.",
            }),
            sandboxInstanceId: input.sandboxInstanceId,
            streamId: input.message.streamId,
          });
          return true;
        }

        this.deliverWebSocketEvent({
          event: {
            kind: "frame",
            message: input.message,
          },
          stream: activeWebSocketStream,
        });
        return true;
      }
      case "ports.ws.close": {
        if (activeWebSocketStream === undefined) {
          return false;
        }
        if (input.message.direction !== "response") {
          await this.failWebSocketStream({
            error: new PortAccessTransportStreamError({
              code: "upstream_io_error",
              message: "Gateway received a non-response websocket close from sandboxd.",
            }),
            sandboxInstanceId: input.sandboxInstanceId,
            streamId: input.message.streamId,
          });
          return true;
        }

        this.deleteActiveWebSocketStream({
          sandboxInstanceId: input.sandboxInstanceId,
          streamId: input.message.streamId,
        });
        this.deliverWebSocketEvent({
          event: {
            kind: "close",
            message: input.message,
          },
          stream: activeWebSocketStream,
        });
        this.finishWebSocketStreamObservability({
          outcome: "completed",
          stream: activeWebSocketStream,
        });
        logger.debug(
          {
            ...activeWebSocketStream.attributes,
            eventName: "gateway.port_access.websocket_stream.completed",
            closeCode: input.message.code,
            closeReason: input.message.reason,
          },
          "Port Access websocket stream completed",
        );
        return true;
      }
      case "ports.stream.error": {
        if (activeHttpStream !== undefined) {
          await this.failHttpStream({
            error: new PortAccessTransportStreamError({
              code: input.message.code,
              message: input.message.message,
            }),
            sandboxInstanceId: input.sandboxInstanceId,
            streamId: input.message.streamId,
          });
          return true;
        }

        if (activeWebSocketStream !== undefined) {
          await this.failWebSocketStream({
            error: new PortAccessTransportStreamError({
              code: input.message.code,
              message: input.message.message,
            }),
            sandboxInstanceId: input.sandboxInstanceId,
            streamId: input.message.streamId,
          });
          return true;
        }

        return false;
      }
      case "ports.http.open":
      case "ports.ws.open":
      case "ports.stream.close": {
        return false;
      }
    }
  }

  public rejectPendingStreamsForBootstrapSession(input: {
    sandboxInstanceId: string;
    targetBootstrapSessionId: string;
  }): void {
    const activeStreams = this.#activeHttpStreamsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (activeStreams !== undefined) {
      for (const [streamId, stream] of activeStreams) {
        if (stream.targetBootstrapSessionId !== input.targetBootstrapSessionId) {
          continue;
        }

        activeStreams.delete(streamId);
        const disconnectError = new PortAccessTransportBootstrapDisconnectedError(
          input.sandboxInstanceId,
        );
        if (!stream.responseStarted) {
          stream.rejectResponseStart(disconnectError);
        }
        void stream.responseBodyWriter.abort(disconnectError);
        this.finishHttpStreamObservability({
          error: disconnectError,
          outcome: "bootstrap_disconnected",
          stream,
        });
        logger.debug(
          {
            ...stream.attributes,
            err: disconnectError,
            eventName: "gateway.port_access.http_stream.bootstrap_disconnected",
          },
          "Port Access HTTP stream rejected because bootstrap disconnected",
        );
        void this.forwardMessage({
          sandboxInstanceId: input.sandboxInstanceId,
          targetBootstrapSessionId: stream.targetBootstrapSessionId,
          payload: JSON.stringify({
            type: "ports.stream.close",
            streamId,
          }),
        }).catch(() => undefined);
      }
      if (activeStreams.size === 0) {
        this.#activeHttpStreamsBySandboxInstanceId.delete(input.sandboxInstanceId);
      }
    }

    const activeWebSocketStreams = this.#activeWebSocketStreamsBySandboxInstanceId.get(
      input.sandboxInstanceId,
    );
    if (activeWebSocketStreams === undefined) {
      return;
    }

    for (const [streamId, stream] of activeWebSocketStreams) {
      if (stream.targetBootstrapSessionId !== input.targetBootstrapSessionId) {
        continue;
      }

      activeWebSocketStreams.delete(streamId);
      const disconnectError = new PortAccessTransportBootstrapDisconnectedError(
        input.sandboxInstanceId,
      );
      if (!stream.accepted) {
        stream.rejectAccept(disconnectError);
        this.finishWebSocketStreamObservability({
          error: disconnectError,
          outcome: "bootstrap_disconnected",
          stream,
        });
        continue;
      }

      if (stream.socket !== undefined) {
        closeBrowserWebSocket(stream.socket, {
          code: 1011,
          reason: BootstrapDisconnectedCloseReason,
        });
      }
      this.finishWebSocketStreamObservability({
        error: disconnectError,
        outcome: "bootstrap_disconnected",
        stream,
      });
      logger.debug(
        {
          ...stream.attributes,
          err: disconnectError,
          eventName: "gateway.port_access.websocket_stream.bootstrap_disconnected",
        },
        "Port Access websocket stream rejected because bootstrap disconnected",
      );
      void this.forwardMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        targetBootstrapSessionId: stream.targetBootstrapSessionId,
        payload: JSON.stringify({
          type: "ports.stream.close",
          streamId,
        }),
      }).catch(() => undefined);
    }
    if (activeWebSocketStreams.size === 0) {
      this.#activeWebSocketStreamsBySandboxInstanceId.delete(input.sandboxInstanceId);
    }
  }

  private allocateStreamId(): number {
    const streamId = this.#nextStreamId;
    this.#nextStreamId += 1;
    return streamId;
  }

  private deleteActiveHttpStream(input: { sandboxInstanceId: string; streamId: number }): void {
    const sandboxStreams = this.#activeHttpStreamsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (sandboxStreams === undefined) {
      return;
    }

    sandboxStreams.delete(input.streamId);
    if (sandboxStreams.size === 0) {
      this.#activeHttpStreamsBySandboxInstanceId.delete(input.sandboxInstanceId);
    }
  }

  private finishHttpStreamObservability(input: {
    error?: Error;
    outcome: PortAccessStreamOutcome;
    stream: ActivePortAccessHttpStream;
  }): void {
    if (input.stream.observabilityFinished) {
      return;
    }

    input.stream.observabilityFinished = true;
    finishPortAccessStream({
      attributes: input.stream.attributes,
      durationMs: Date.now() - input.stream.openedAtMs,
      ...(input.error === undefined ? {} : { error: input.error }),
      outcome: input.outcome,
      span: input.stream.portAccessSpan,
    });
  }

  private async failHttpStream(input: {
    error: Error;
    sandboxInstanceId: string;
    streamId: number;
  }): Promise<void> {
    const activeStream = this.getActiveHttpStream(input);
    if (activeStream === undefined) {
      return;
    }

    this.deleteActiveHttpStream(input);
    if (!activeStream.responseStarted) {
      activeStream.rejectResponseStart(input.error);
    }
    await activeStream.responseBodyWriter.abort(input.error);
    this.finishHttpStreamObservability({
      error: input.error,
      outcome: "stream_error",
      stream: activeStream,
    });
    logger.warn(
      {
        ...activeStream.attributes,
        err: input.error,
        eventName: "gateway.port_access.http_stream.failed",
      },
      "Port Access HTTP stream failed",
    );
  }

  private attachWebSocket(input: {
    sandboxInstanceId: string;
    socket: WSContext<WebSocket>;
    streamId: number;
  }): void {
    const activeStream = this.getActiveWebSocketStream(input);
    if (activeStream === undefined) {
      closeBrowserWebSocket(input.socket, {
        code: 1011,
        reason: "Port Access websocket stream is no longer active.",
      });
      return;
    }

    if (input.socket.raw === undefined) {
      throw new Error("Expected raw websocket for Port Access browser attachment.");
    }
    Reflect.set(input.socket.raw, "_autoPong", false);
    activeStream.socket = input.socket;

    const pendingEvents = [...activeStream.pendingEvents];
    activeStream.pendingEvents = [];
    for (const event of pendingEvents) {
      this.deliverWebSocketEvent({
        event,
        stream: activeStream,
      });
    }
  }

  private async closeWebSocketFromBrowser(input: {
    code: number;
    reason: string;
    sandboxInstanceId: string;
    streamId: number;
  }): Promise<void> {
    const activeStream = this.getActiveWebSocketStream(input);
    if (activeStream === undefined || activeStream.browserClosed) {
      return;
    }

    activeStream.browserClosed = true;
    this.finishWebSocketStreamObservability({
      outcome: "browser_closed",
      stream: activeStream,
    });
    logger.debug(
      {
        ...activeStream.attributes,
        eventName: "gateway.port_access.websocket_stream.browser_closed",
        closeCode: input.code,
        closeReason: input.reason,
      },
      "Port Access websocket stream closed by browser",
    );
    if (input.code === 1006) {
      await this.forwardMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        targetBootstrapSessionId: activeStream.targetBootstrapSessionId,
        payload: JSON.stringify({
          type: "ports.stream.close",
          streamId: input.streamId,
        }),
      });
      return;
    }

    await this.forwardMessage({
      sandboxInstanceId: input.sandboxInstanceId,
      targetBootstrapSessionId: activeStream.targetBootstrapSessionId,
      payload: JSON.stringify({
        type: "ports.ws.close",
        streamId: input.streamId,
        direction: "request",
        ...(input.code === 1005
          ? {}
          : {
              code: input.code,
              ...(input.reason.length === 0 ? {} : { reason: input.reason }),
            }),
      } satisfies PortsWsClose),
    });
  }

  private async failWebSocketFromBrowser(input: {
    error: Error;
    sandboxInstanceId: string;
    streamId: number;
  }): Promise<void> {
    const activeStream = this.getActiveWebSocketStream(input);
    if (activeStream === undefined || activeStream.browserClosed) {
      return;
    }

    activeStream.browserClosed = true;
    this.finishWebSocketStreamObservability({
      error: input.error,
      outcome: "browser_error",
      stream: activeStream,
    });
    logger.warn(
      {
        ...activeStream.attributes,
        err: input.error,
        eventName: "gateway.port_access.websocket_stream.browser_error",
      },
      "Port Access websocket stream failed from browser error",
    );
    await this.forwardMessage({
      sandboxInstanceId: input.sandboxInstanceId,
      targetBootstrapSessionId: activeStream.targetBootstrapSessionId,
      payload: JSON.stringify({
        type: "ports.stream.close",
        streamId: input.streamId,
      }),
    }).catch(() => undefined);
  }

  private async failWebSocketStream(input: {
    error: Error;
    sandboxInstanceId: string;
    streamId: number;
  }): Promise<void> {
    const activeStream = this.getActiveWebSocketStream(input);
    if (activeStream === undefined) {
      return;
    }

    this.deleteActiveWebSocketStream(input);
    if (!activeStream.accepted) {
      activeStream.rejectAccept(input.error);
      this.finishWebSocketStreamObservability({
        error: input.error,
        outcome: "stream_error",
        stream: activeStream,
      });
      return;
    }

    if (activeStream.socket !== undefined) {
      closeBrowserWebSocket(activeStream.socket, {
        code: 1011,
        reason: "Port Access upstream websocket failed.",
      });
    }
    this.finishWebSocketStreamObservability({
      error: input.error,
      outcome: "stream_error",
      stream: activeStream,
    });
    logger.warn(
      {
        ...activeStream.attributes,
        err: input.error,
        eventName: "gateway.port_access.websocket_stream.failed",
      },
      "Port Access websocket stream failed",
    );
  }

  private finishWebSocketStreamObservability(input: {
    error?: Error;
    outcome: PortAccessStreamOutcome;
    stream: ActivePortAccessWebSocketStream;
  }): void {
    if (input.stream.observabilityFinished) {
      return;
    }

    input.stream.observabilityFinished = true;
    finishPortAccessStream({
      attributes: input.stream.attributes,
      durationMs: Date.now() - input.stream.openedAtMs,
      ...(input.error === undefined ? {} : { error: input.error }),
      outcome: input.outcome,
      span: input.stream.portAccessSpan,
    });
  }

  private async forwardMessage(input: {
    payload: string;
    sandboxInstanceId: string;
    targetBootstrapSessionId: string;
  }): Promise<void> {
    await this.relayCoordinator.forwardPeerMessage({
      sandboxInstanceId: input.sandboxInstanceId,
      fromSide: "connection",
      payload: input.payload,
      targetSessionId: input.targetBootstrapSessionId,
    });
  }

  private requireBootstrapTarget(input: { sandboxInstanceId: string }): RelayTarget {
    const bootstrapTarget = this.relayCoordinator.getBootstrapPeer({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (bootstrapTarget === undefined) {
      throw new BootstrapTunnelNotConnectedError(input.sandboxInstanceId);
    }

    return bootstrapTarget;
  }

  private getActiveHttpStream(input: {
    sandboxInstanceId: string;
    streamId: number;
  }): ActivePortAccessHttpStream | undefined {
    return this.#activeHttpStreamsBySandboxInstanceId
      .get(input.sandboxInstanceId)
      ?.get(input.streamId);
  }

  private getMatchingActiveHttpStream(input: {
    sandboxInstanceId: string;
    sourceBootstrapSessionId: string;
    streamId: number;
  }): ActivePortAccessHttpStream | undefined {
    if (!this.isCurrentBootstrapSession(input)) {
      return undefined;
    }

    const activeStream = this.getActiveHttpStream(input);
    if (activeStream?.targetBootstrapSessionId !== input.sourceBootstrapSessionId) {
      return undefined;
    }

    return activeStream;
  }

  private setActiveHttpStream(input: {
    sandboxInstanceId: string;
    stream: ActivePortAccessHttpStream;
    streamId: number;
  }): void {
    const sandboxStreams =
      this.#activeHttpStreamsBySandboxInstanceId.get(input.sandboxInstanceId) ?? new Map();
    sandboxStreams.set(input.streamId, input.stream);
    this.#activeHttpStreamsBySandboxInstanceId.set(input.sandboxInstanceId, sandboxStreams);
  }

  private deleteActiveWebSocketStream(input: {
    sandboxInstanceId: string;
    streamId: number;
  }): void {
    const sandboxStreams = this.#activeWebSocketStreamsBySandboxInstanceId.get(
      input.sandboxInstanceId,
    );
    if (sandboxStreams === undefined) {
      return;
    }

    sandboxStreams.delete(input.streamId);
    if (sandboxStreams.size === 0) {
      this.#activeWebSocketStreamsBySandboxInstanceId.delete(input.sandboxInstanceId);
    }
  }

  private deliverWebSocketEvent(input: {
    event: PortAccessWebSocketPendingEvent;
    stream: ActivePortAccessWebSocketStream;
  }): void {
    if (input.stream.socket === undefined) {
      input.stream.pendingEvents.push(input.event);
      return;
    }

    switch (input.event.kind) {
      case "frame": {
        sendBrowserWebSocketFrame(input.stream.socket, input.event.message);
        return;
      }
      case "close": {
        closeBrowserWebSocket(input.stream.socket, {
          code: input.event.message.code,
          reason: input.event.message.reason,
        });
      }
    }
  }

  private getActiveWebSocketStream(input: {
    sandboxInstanceId: string;
    streamId: number;
  }): ActivePortAccessWebSocketStream | undefined {
    return this.#activeWebSocketStreamsBySandboxInstanceId
      .get(input.sandboxInstanceId)
      ?.get(input.streamId);
  }

  private getMatchingActiveWebSocketStream(input: {
    sandboxInstanceId: string;
    sourceBootstrapSessionId: string;
    streamId: number;
  }): ActivePortAccessWebSocketStream | undefined {
    if (!this.isCurrentBootstrapSession(input)) {
      return undefined;
    }

    const activeStream = this.getActiveWebSocketStream(input);
    if (activeStream?.targetBootstrapSessionId !== input.sourceBootstrapSessionId) {
      return undefined;
    }

    return activeStream;
  }

  private isCurrentBootstrapSession(input: {
    sandboxInstanceId: string;
    sourceBootstrapSessionId: string;
  }): boolean {
    return (
      this.relayCoordinator.getBootstrapPeer({
        sandboxInstanceId: input.sandboxInstanceId,
      })?.sessionId === input.sourceBootstrapSessionId
    );
  }

  private setActiveWebSocketStream(input: {
    sandboxInstanceId: string;
    stream: ActivePortAccessWebSocketStream;
    streamId: number;
  }): void {
    const sandboxStreams =
      this.#activeWebSocketStreamsBySandboxInstanceId.get(input.sandboxInstanceId) ?? new Map();
    sandboxStreams.set(input.streamId, input.stream);
    this.#activeWebSocketStreamsBySandboxInstanceId.set(input.sandboxInstanceId, sandboxStreams);
  }
}

function sendBrowserWebSocketFrame(socket: WSContext<WebSocket>, message: PortsWsFrame): void {
  const bytes = Uint8Array.from(Buffer.from(message.bytes, "base64"));

  switch (message.opcode) {
    case "text":
      socket.send(Buffer.from(bytes).toString("utf8"));
      return;
    case "binary":
      socket.send(bytes);
      return;
    case "ping":
      socket.raw?.ping(bytes);
      return;
    case "pong":
      socket.raw?.pong(bytes);
      return;
  }
}

function closeBrowserWebSocket(
  socket: WSContext<WebSocket>,
  input: { code: number | undefined; reason: string | undefined },
): void {
  if (input.code === undefined) {
    socket.close();
    return;
  }

  socket.close(input.code, input.reason);
}

export function buildPortAccessWebSocketRequestHeaders(input: {
  browserEdgePort: string;
  browserEdgeProto: "http" | "https";
  browserVisibleHost: string;
  requestHeaders: Headers;
  targetPort: number;
  upstreamProtocol: "http" | "https";
}): RepeatedHeaderValues {
  const tunneledHeaders: RepeatedHeaderValues = {};

  for (const [headerName, value] of input.requestHeaders.entries()) {
    const normalizedHeaderName = headerName.toLowerCase();
    if (normalizedHeaderName === "host") {
      continue;
    }

    if (normalizedHeaderName === "cookie") {
      const sanitizedCookieHeader = stripPortAccessSessionCookie(value);
      if (sanitizedCookieHeader === undefined) {
        continue;
      }

      tunneledHeaders.cookie = [sanitizedCookieHeader];
      continue;
    }

    if (normalizedHeaderName === "origin") {
      tunneledHeaders.origin = [
        `${input.upstreamProtocol}://127.0.0.1:${String(input.targetPort)}`,
      ];
      continue;
    }

    if (
      HopByHopHeaderNames.has(normalizedHeaderName) &&
      normalizedHeaderName !== "connection" &&
      normalizedHeaderName !== "upgrade"
    ) {
      continue;
    }

    tunneledHeaders[normalizedHeaderName] = [value];
  }

  tunneledHeaders.host = [`127.0.0.1:${String(input.targetPort)}`];
  tunneledHeaders["x-forwarded-host"] = [input.browserVisibleHost];
  tunneledHeaders["x-forwarded-proto"] = [input.browserEdgeProto];
  tunneledHeaders["x-forwarded-port"] = [input.browserEdgePort];

  return tunneledHeaders;
}
