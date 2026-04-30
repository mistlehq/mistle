import type { Duplex } from "node:stream";

import {
  DefaultStreamWindowBytes,
  encodeDataFrame,
  MaxStreamWindowBytes,
  type PortAccessTarget,
  type PortsTcpClose,
  type PortsTcpConnected,
  type PortsTcpOpen,
  type PortsStreamError,
  type PortsTransportMessage,
  type StreamWindow,
  PayloadKindRawBytes,
  decodeDataFrame,
} from "@mistle/sandbox-session-protocol";
import {
  systemClock,
  systemScheduler,
  type Clock,
  type Scheduler,
  type TimerHandle,
} from "@mistle/time";
import { metrics, SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";

import { BootstrapTunnelNotConnectedError } from "../tunnel/bootstrap-tunnel-not-connected-error.js";
import type { TunnelRelayCoordinator } from "../tunnel/relay-coordinator.js";
import type { TunnelSessionRegistry } from "../tunnel/tunnel-session/index.js";
import type { RelayTarget } from "../tunnel/types.js";

const DefaultTcpConnectTimeoutMs = 10_000;
const DefaultTcpIdleTimeoutMs = 30 * 60 * 1_000;
const DefaultMaxActiveTcpStreamsPerSandbox = 256;
const DefaultMaxActiveTcpStreamsPerPortAccessSession = 64;
const PortAccessTracer = trace.getTracer("@mistle/data-plane-gateway/port-access");
const PortAccessMeter = metrics.getMeter("@mistle/data-plane-gateway/port-access");
const PortAccessStreamEvents = PortAccessMeter.createCounter("mistle.port_access.stream.events", {
  description: "Port Access stream lifecycle events observed by the data-plane gateway.",
});
const PortAccessStreamBytes = PortAccessMeter.createCounter("mistle.port_access.stream.bytes", {
  description: "Port Access stream bytes relayed by the data-plane gateway.",
  unit: "By",
});
const PortAccessActiveStreams = PortAccessMeter.createUpDownCounter(
  "mistle.port_access.stream.active",
  {
    description: "Active Port Access streams currently owned by the data-plane gateway.",
  },
);
const PortAccessStreamDurationMs = PortAccessMeter.createHistogram(
  "mistle.port_access.stream.duration",
  {
    description: "Port Access stream duration observed by the data-plane gateway.",
    unit: "ms",
  },
);

type PortAccessStreamKind = "tcp";
type PortAccessStreamOutcome =
  | "opened"
  | "connected"
  | "completed"
  | "client_closed"
  | "client_error"
  | "connect_failed"
  | "bootstrap_disconnected"
  | "connect_timeout"
  | "idle_timeout"
  | "stream_error";

type TcpStreamCloseDirection = "request" | "response";

type ActivePortAccessTcpStream = {
  attributes: Attributes;
  clientRequestEnded: boolean;
  client: Duplex;
  connected: boolean;
  connectTimeoutHandle: TimerHandle;
  idleTimeoutHandle: TimerHandle;
  initialBytes: Uint8Array;
  observabilityFinished: boolean;
  openedAtMs: number;
  outboundCreditBytes: number;
  pendingOutboundBytes: Uint8Array[];
  pendingOutboundByteLength: number;
  pendingOutboundOffset: number;
  portAccessSpan: Span;
  portAccessSessionKey: string;
  releaseStarted: boolean;
  rejectConnected: (error: Error) => void;
  requestClosed: boolean;
  resolveConnected: (message: PortsTcpConnected) => void;
  responseClosed: boolean;
  sandboxInstanceId: string;
  streamId: number;
  targetBootstrapSessionId: string;
  totalRequestBytes: number;
  totalResponseBytes: number;
};

export type PortAccessTcpStreamHandle = {
  connected: Promise<PortsTcpConnected>;
  streamId: number;
};

export type PortAccessTransportOptions = {
  clock?: Clock;
  connectTimeoutMs?: number;
  idleTimeoutMs?: number;
  initialTcpStreamWindowBytes?: number;
  maxActiveTcpStreamsPerPortAccessSession?: number;
  maxActiveTcpStreamsPerSandbox?: number;
  scheduler?: Scheduler;
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

export class PortAccessTcpStreamLimitExceededError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PortAccessTcpStreamLimitExceededError";
  }
}

export class PortAccessTcpStreamTimeoutError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PortAccessTcpStreamTimeoutError";
  }
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

export class PortAccessTransportService {
  readonly #activeTcpStreamsBySandboxInstanceId = new Map<
    string,
    Map<number, ActivePortAccessTcpStream>
  >();
  readonly #activeTcpStreamCountsByPortAccessSessionKey = new Map<string, number>();
  readonly #clock: Clock;
  readonly #connectTimeoutMs: number;
  readonly #idleTimeoutMs: number;
  readonly #initialTcpStreamWindowBytes: number;
  readonly #maxActiveTcpStreamsPerPortAccessSession: number;
  readonly #maxActiveTcpStreamsPerSandbox: number;
  readonly #scheduler: Scheduler;

  public constructor(
    private readonly relayCoordinator: Pick<
      TunnelRelayCoordinator,
      "forwardPeerMessage" | "getBootstrapPeer"
    >,
    private readonly tunnelSessionRegistry: Pick<
      TunnelSessionRegistry,
      "reserveTunnelStream" | "releaseReservedTunnelStream"
    >,
    options: PortAccessTransportOptions = {},
  ) {
    this.#clock = options.clock ?? systemClock;
    this.#connectTimeoutMs = options.connectTimeoutMs ?? DefaultTcpConnectTimeoutMs;
    this.#idleTimeoutMs = options.idleTimeoutMs ?? DefaultTcpIdleTimeoutMs;
    this.#initialTcpStreamWindowBytes =
      options.initialTcpStreamWindowBytes ?? DefaultStreamWindowBytes;
    this.#maxActiveTcpStreamsPerPortAccessSession =
      options.maxActiveTcpStreamsPerPortAccessSession ??
      DefaultMaxActiveTcpStreamsPerPortAccessSession;
    this.#maxActiveTcpStreamsPerSandbox =
      options.maxActiveTcpStreamsPerSandbox ?? DefaultMaxActiveTcpStreamsPerSandbox;
    this.#scheduler = options.scheduler ?? systemScheduler;
  }

  public async openTcpStream(input: {
    client: Duplex;
    initialBytes: Uint8Array;
    portAccessSessionId: string;
    sandboxInstanceId: string;
    target: PortAccessTarget;
    upstreamProtocol: "http" | "https";
  }): Promise<PortAccessTcpStreamHandle> {
    const bootstrapTarget = this.requireBootstrapTarget({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    const streamId = this.reserveTcpStreamId({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    const portAccessSessionKey = toPortAccessSessionKey({
      portAccessSessionId: input.portAccessSessionId,
      sandboxInstanceId: input.sandboxInstanceId,
    });

    try {
      this.assertTcpStreamLimits({
        portAccessSessionKey,
        sandboxInstanceId: input.sandboxInstanceId,
      });
    } catch (error) {
      this.releaseTcpStreamId({
        sandboxInstanceId: input.sandboxInstanceId,
        streamId,
      });
      throw error;
    }

    const openedAtMs = this.#clock.nowMs();
    const streamAttributes = buildPortAccessStreamAttributes({
      sandboxInstanceId: input.sandboxInstanceId,
      streamId,
      streamKind: "tcp",
      target: input.target,
      targetBootstrapSessionId: bootstrapTarget.sessionId,
      upstreamProtocol: input.upstreamProtocol,
    });
    const portAccessSpan = startPortAccessStreamSpan({
      attributes: streamAttributes,
      streamKind: "tcp",
    });
    recordPortAccessStreamEvent({
      attributes: streamAttributes,
      outcome: "opened",
    });

    let resolveConnected: ((message: PortsTcpConnected) => void) | undefined;
    let rejectConnected: ((error: Error) => void) | undefined;
    const connected = new Promise<PortsTcpConnected>((resolve, reject) => {
      resolveConnected = resolve;
      rejectConnected = reject;
    });
    if (resolveConnected === undefined || rejectConnected === undefined) {
      throw new Error("Port access TCP connected promise callbacks were not initialized.");
    }

    input.client.pause();
    const connectTimeoutHandle = this.#scheduler.schedule(() => {
      void this.failTcpStream({
        error: new PortAccessTcpStreamTimeoutError(
          `Port Access TCP stream ${String(streamId)} did not connect within ${String(
            this.#connectTimeoutMs,
          )}ms.`,
        ),
        notifyBootstrap: true,
        outcome: "connect_timeout",
        sandboxInstanceId: input.sandboxInstanceId,
        streamId,
      });
    }, this.#connectTimeoutMs);
    const idleTimeoutHandle = this.#scheduler.schedule(() => {
      void this.failTcpStream({
        error: new PortAccessTcpStreamTimeoutError(
          `Port Access TCP stream ${String(streamId)} was idle for ${String(
            this.#idleTimeoutMs,
          )}ms.`,
        ),
        notifyBootstrap: true,
        outcome: "idle_timeout",
        sandboxInstanceId: input.sandboxInstanceId,
        streamId,
      });
    }, this.#idleTimeoutMs);

    const stream: ActivePortAccessTcpStream = {
      attributes: streamAttributes,
      clientRequestEnded: false,
      client: input.client,
      connected: false,
      connectTimeoutHandle,
      idleTimeoutHandle,
      initialBytes: input.initialBytes,
      observabilityFinished: false,
      openedAtMs,
      outboundCreditBytes: this.#initialTcpStreamWindowBytes,
      pendingOutboundBytes: [],
      pendingOutboundByteLength: 0,
      pendingOutboundOffset: 0,
      portAccessSpan,
      portAccessSessionKey,
      releaseStarted: false,
      rejectConnected,
      requestClosed: false,
      resolveConnected,
      responseClosed: false,
      sandboxInstanceId: input.sandboxInstanceId,
      streamId,
      targetBootstrapSessionId: bootstrapTarget.sessionId,
      totalRequestBytes: 0,
      totalResponseBytes: 0,
    };
    this.setActiveTcpStream({
      sandboxInstanceId: input.sandboxInstanceId,
      stream,
      streamId,
    });
    this.attachTcpClientSocket({
      sandboxInstanceId: input.sandboxInstanceId,
      stream,
      streamId,
    });

    try {
      await this.forwardMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        targetBootstrapSessionId: bootstrapTarget.sessionId,
        payload: JSON.stringify({
          type: "ports.tcp.open",
          streamId,
          target: input.target,
          upstreamProtocol: input.upstreamProtocol,
        } satisfies PortsTcpOpen),
      });
    } catch (error) {
      const streamError = error instanceof Error ? error : new Error(String(error));
      await this.failTcpStream({
        error: streamError,
        notifyBootstrap: false,
        outcome: "stream_error",
        sandboxInstanceId: input.sandboxInstanceId,
        streamId,
      });
      throw error;
    }

    return {
      connected,
      streamId,
    };
  }

  public async handleBootstrapTransportMessage(input: {
    message: PortsTransportMessage;
    sandboxInstanceId: string;
    sourceBootstrapSessionId: string;
  }): Promise<boolean> {
    const activeTcpStream = this.getMatchingActiveTcpStream({
      sandboxInstanceId: input.sandboxInstanceId,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.message.streamId,
    });

    switch (input.message.type) {
      case "ports.stream.error": {
        if (activeTcpStream !== undefined) {
          await this.failTcpStream({
            error: new PortAccessTransportStreamError({
              code: input.message.code,
              message: input.message.message,
            }),
            notifyBootstrap: false,
            outcome: "stream_error",
            sandboxInstanceId: input.sandboxInstanceId,
            streamId: input.message.streamId,
          });
          return true;
        }

        return false;
      }
      case "ports.tcp.connected": {
        if (activeTcpStream === undefined) {
          return false;
        }
        activeTcpStream.connected = true;
        this.#scheduler.cancel(activeTcpStream.connectTimeoutHandle);
        activeTcpStream.resolveConnected(input.message);
        activeTcpStream.portAccessSpan.addEvent("gateway.port_access.tcp.connected");
        recordPortAccessStreamEvent({
          attributes: activeTcpStream.attributes,
          outcome: "connected",
        });
        this.enqueueTcpOutboundBytes({
          bytes: activeTcpStream.initialBytes,
          sandboxInstanceId: input.sandboxInstanceId,
          stream: activeTcpStream,
          streamId: input.message.streamId,
        });
        void this.flushTcpOutboundBytes({
          sandboxInstanceId: input.sandboxInstanceId,
          stream: activeTcpStream,
          streamId: input.message.streamId,
        });
        return true;
      }
      case "ports.tcp.close": {
        if (activeTcpStream === undefined) {
          return false;
        }
        await this.handleTcpCloseFromBootstrap({
          message: input.message,
          sandboxInstanceId: input.sandboxInstanceId,
          stream: activeTcpStream,
          streamId: input.message.streamId,
        });
        return true;
      }
      case "ports.tcp.error": {
        if (activeTcpStream === undefined) {
          return false;
        }
        await this.failTcpStream({
          error: new PortAccessTransportStreamError({
            code: input.message.code,
            message: input.message.message,
          }),
          notifyBootstrap: false,
          outcome: activeTcpStream.connected ? "stream_error" : "connect_failed",
          sandboxInstanceId: input.sandboxInstanceId,
          streamId: input.message.streamId,
        });
        return true;
      }
      case "ports.tcp.open":
      case "ports.stream.close": {
        return false;
      }
      default: {
        return false;
      }
    }
  }

  public async handleBootstrapDataFrame(input: {
    payload: ArrayBuffer;
    sandboxInstanceId: string;
    sourceBootstrapSessionId: string;
  }): Promise<boolean> {
    const frame = decodeDataFrame(new Uint8Array(input.payload));
    if (frame.payloadKind !== PayloadKindRawBytes) {
      return false;
    }

    const activeTcpStream = this.getMatchingActiveTcpStream({
      sandboxInstanceId: input.sandboxInstanceId,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: frame.streamId,
    });
    if (activeTcpStream === undefined) {
      return false;
    }

    this.touchTcpStreamIdleTimeout(activeTcpStream);
    activeTcpStream.totalResponseBytes += frame.payload.byteLength;
    PortAccessStreamBytes.add(frame.payload.byteLength, {
      ...activeTcpStream.attributes,
      "mistle.port_access.direction": "target_to_client",
    });
    await writeTcpClientBytes({
      bytes: frame.payload,
      client: activeTcpStream.client,
    });
    await this.forwardMessage({
      sandboxInstanceId: input.sandboxInstanceId,
      targetBootstrapSessionId: activeTcpStream.targetBootstrapSessionId,
      payload: JSON.stringify({
        type: "stream.window",
        streamId: frame.streamId,
        bytes: frame.payload.byteLength,
      } satisfies StreamWindow),
    });
    return true;
  }

  public handleBootstrapStreamWindow(input: {
    message: StreamWindow;
    sandboxInstanceId: string;
    sourceBootstrapSessionId: string;
  }): boolean {
    const activeTcpStream = this.getMatchingActiveTcpStream({
      sandboxInstanceId: input.sandboxInstanceId,
      sourceBootstrapSessionId: input.sourceBootstrapSessionId,
      streamId: input.message.streamId,
    });
    if (activeTcpStream === undefined) {
      return false;
    }

    activeTcpStream.outboundCreditBytes += input.message.bytes;
    void this.flushTcpOutboundBytes({
      sandboxInstanceId: input.sandboxInstanceId,
      stream: activeTcpStream,
      streamId: input.message.streamId,
    });
    return true;
  }

  public rejectPendingStreamsForBootstrapSession(input: {
    sandboxInstanceId: string;
    targetBootstrapSessionId: string;
  }): void {
    const activeTcpStreams = this.#activeTcpStreamsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (activeTcpStreams !== undefined) {
      for (const [streamId, stream] of activeTcpStreams) {
        if (stream.targetBootstrapSessionId !== input.targetBootstrapSessionId) {
          continue;
        }

        void this.failTcpStream({
          error: new PortAccessTransportBootstrapDisconnectedError(input.sandboxInstanceId),
          notifyBootstrap: false,
          outcome: "bootstrap_disconnected",
          sandboxInstanceId: input.sandboxInstanceId,
          streamId,
        });
      }
    }
  }

  private attachTcpClientSocket(input: {
    sandboxInstanceId: string;
    stream: ActivePortAccessTcpStream;
    streamId: number;
  }): void {
    input.stream.client.on("data", (chunk: Buffer) => {
      this.touchTcpStreamIdleTimeout(input.stream);
      this.enqueueTcpOutboundBytes({
        bytes: new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
        sandboxInstanceId: input.sandboxInstanceId,
        stream: input.stream,
        streamId: input.streamId,
      });
      void this.flushTcpOutboundBytes(input);
    });
    input.stream.client.once("end", () => {
      input.stream.clientRequestEnded = true;
      void this.flushTcpOutboundBytes({
        sandboxInstanceId: input.sandboxInstanceId,
        stream: input.stream,
        streamId: input.streamId,
      });
    });
    input.stream.client.once("close", () => {
      if (input.stream.releaseStarted) {
        return;
      }
      void this.failTcpStream({
        error: new Error("Port Access TCP client socket closed."),
        notifyBootstrap: true,
        outcome: "client_closed",
        sandboxInstanceId: input.sandboxInstanceId,
        streamId: input.streamId,
      });
    });
    input.stream.client.once("error", (error) => {
      void this.failTcpStream({
        error,
        notifyBootstrap: true,
        outcome: "client_error",
        sandboxInstanceId: input.sandboxInstanceId,
        streamId: input.streamId,
      });
    });
  }

  private enqueueTcpOutboundBytes(input: {
    bytes: Uint8Array;
    sandboxInstanceId: string;
    stream: ActivePortAccessTcpStream;
    streamId: number;
  }): void {
    if (input.bytes.byteLength === 0) {
      return;
    }

    const nextPendingByteLength = input.stream.pendingOutboundByteLength + input.bytes.byteLength;
    if (nextPendingByteLength > MaxStreamWindowBytes) {
      void this.failTcpStream({
        error: new PortAccessTransportStreamError({
          code: "upstream_io_error",
          message: `Port Access TCP stream ${String(
            input.streamId,
          )} exceeded the maximum pending outbound byte window.`,
        }),
        notifyBootstrap: true,
        outcome: "stream_error",
        sandboxInstanceId: input.sandboxInstanceId,
        streamId: input.streamId,
      });
      return;
    }

    input.stream.pendingOutboundBytes.push(input.bytes);
    input.stream.pendingOutboundByteLength = nextPendingByteLength;
    input.stream.client.pause();
  }

  private async flushTcpOutboundBytes(input: {
    sandboxInstanceId: string;
    stream: ActivePortAccessTcpStream;
    streamId: number;
  }): Promise<void> {
    if (!input.stream.connected || input.stream.requestClosed || input.stream.releaseStarted) {
      return;
    }

    while (input.stream.outboundCreditBytes > 0 && input.stream.pendingOutboundBytes.length > 0) {
      const pendingBytes = input.stream.pendingOutboundBytes[0];
      if (pendingBytes === undefined) {
        throw new Error("Expected pending TCP bytes.");
      }

      const availableBytes = pendingBytes.byteLength - input.stream.pendingOutboundOffset;
      const bytesToSend = Math.min(availableBytes, input.stream.outboundCreditBytes);
      const chunk = pendingBytes.slice(
        input.stream.pendingOutboundOffset,
        input.stream.pendingOutboundOffset + bytesToSend,
      );
      input.stream.pendingOutboundOffset += bytesToSend;
      input.stream.outboundCreditBytes -= bytesToSend;
      input.stream.pendingOutboundByteLength -= bytesToSend;
      input.stream.totalRequestBytes += bytesToSend;
      this.touchTcpStreamIdleTimeout(input.stream);
      try {
        await this.forwardDataFrame({
          payload: chunk,
          sandboxInstanceId: input.sandboxInstanceId,
          streamId: input.streamId,
          targetBootstrapSessionId: input.stream.targetBootstrapSessionId,
        });
        PortAccessStreamBytes.add(bytesToSend, {
          ...input.stream.attributes,
          "mistle.port_access.direction": "client_to_target",
        });
      } catch (error: unknown) {
        const streamError = error instanceof Error ? error : new Error(String(error));
        await this.failTcpStream({
          error: streamError,
          notifyBootstrap: false,
          outcome: "stream_error",
          sandboxInstanceId: input.sandboxInstanceId,
          streamId: input.streamId,
        });
        return;
      }

      if (input.stream.pendingOutboundOffset === pendingBytes.byteLength) {
        input.stream.pendingOutboundBytes.shift();
        input.stream.pendingOutboundOffset = 0;
      }
    }

    if (input.stream.outboundCreditBytes === 0) {
      input.stream.client.pause();
      return;
    }

    if (input.stream.pendingOutboundBytes.length === 0 && input.stream.clientRequestEnded) {
      await this.closeTcpDirectionFromClient({
        direction: "request",
        sandboxInstanceId: input.sandboxInstanceId,
        stream: input.stream,
        streamId: input.streamId,
      });
      return;
    }

    if (input.stream.pendingOutboundBytes.length === 0) {
      input.stream.client.resume();
    }
  }

  private async closeTcpDirectionFromClient(input: {
    direction: TcpStreamCloseDirection;
    sandboxInstanceId: string;
    stream: ActivePortAccessTcpStream;
    streamId: number;
  }): Promise<void> {
    if (input.stream.requestClosed || input.stream.releaseStarted) {
      return;
    }

    input.stream.requestClosed = true;
    await this.forwardMessage({
      sandboxInstanceId: input.sandboxInstanceId,
      targetBootstrapSessionId: input.stream.targetBootstrapSessionId,
      payload: JSON.stringify({
        type: "ports.tcp.close",
        streamId: input.streamId,
        direction: input.direction,
      } satisfies PortsTcpClose),
    }).catch(() => undefined);
    this.releaseTcpStreamIfComplete({
      sandboxInstanceId: input.sandboxInstanceId,
      stream: input.stream,
      streamId: input.streamId,
    });
  }

  private async handleTcpCloseFromBootstrap(input: {
    message: PortsTcpClose;
    sandboxInstanceId: string;
    stream: ActivePortAccessTcpStream;
    streamId: number;
  }): Promise<void> {
    if (input.message.direction === "request") {
      input.stream.requestClosed = true;
    } else {
      if (!input.stream.responseClosed) {
        input.stream.responseClosed = true;
        input.stream.client.end();
      }
    }

    this.releaseTcpStreamIfComplete({
      sandboxInstanceId: input.sandboxInstanceId,
      stream: input.stream,
      streamId: input.streamId,
    });
  }

  private releaseTcpStreamIfComplete(input: {
    sandboxInstanceId: string;
    stream: ActivePortAccessTcpStream;
    streamId: number;
  }): void {
    if (!input.stream.requestClosed || !input.stream.responseClosed) {
      return;
    }

    this.releaseTcpStream({
      outcome: "completed",
      sandboxInstanceId: input.sandboxInstanceId,
      stream: input.stream,
      streamId: input.streamId,
    });
  }

  private async failTcpStream(input: {
    error: Error;
    notifyBootstrap: boolean;
    outcome: PortAccessStreamOutcome;
    sandboxInstanceId: string;
    streamId: number;
  }): Promise<void> {
    const activeStream = this.getActiveTcpStream(input);
    if (activeStream === undefined || activeStream.releaseStarted) {
      return;
    }

    if (!activeStream.connected) {
      activeStream.rejectConnected(input.error);
    }
    this.releaseTcpStream({
      error: input.error,
      outcome: input.outcome,
      sandboxInstanceId: input.sandboxInstanceId,
      stream: activeStream,
      streamId: input.streamId,
    });
    activeStream.client.destroy(input.error);
    if (input.notifyBootstrap) {
      await this.forwardMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        targetBootstrapSessionId: activeStream.targetBootstrapSessionId,
        payload: JSON.stringify({
          type: "ports.tcp.close",
          streamId: input.streamId,
          direction: "request",
        } satisfies PortsTcpClose),
      }).catch(() => undefined);
    }
  }

  private releaseTcpStream(input: {
    error?: Error;
    outcome: PortAccessStreamOutcome;
    sandboxInstanceId: string;
    stream: ActivePortAccessTcpStream;
    streamId: number;
  }): void {
    if (input.stream.releaseStarted) {
      return;
    }

    input.stream.releaseStarted = true;
    this.#scheduler.cancel(input.stream.connectTimeoutHandle);
    this.#scheduler.cancel(input.stream.idleTimeoutHandle);
    this.deleteActiveTcpStream({
      sandboxInstanceId: input.sandboxInstanceId,
      streamId: input.streamId,
    });
    this.releaseTcpStreamId({
      sandboxInstanceId: input.sandboxInstanceId,
      streamId: input.streamId,
    });
    this.finishTcpStreamObservability(input);
  }

  private finishTcpStreamObservability(input: {
    error?: Error;
    outcome: PortAccessStreamOutcome;
    stream: ActivePortAccessTcpStream;
  }): void {
    if (input.stream.observabilityFinished) {
      return;
    }

    input.stream.observabilityFinished = true;
    finishPortAccessStream({
      attributes: {
        ...input.stream.attributes,
        "mistle.port_access.request_bytes": input.stream.totalRequestBytes,
        "mistle.port_access.response_bytes": input.stream.totalResponseBytes,
      },
      durationMs: this.#clock.nowMs() - input.stream.openedAtMs,
      ...(input.error === undefined ? {} : { error: input.error }),
      outcome: input.outcome,
      span: input.stream.portAccessSpan,
    });
  }

  private touchTcpStreamIdleTimeout(stream: ActivePortAccessTcpStream): void {
    this.#scheduler.cancel(stream.idleTimeoutHandle);
    stream.idleTimeoutHandle = this.#scheduler.schedule(() => {
      void this.failTcpStream({
        error: new PortAccessTcpStreamTimeoutError(
          `Port Access TCP stream ${String(
            stream.streamId,
          )} was idle for ${String(this.#idleTimeoutMs)}ms.`,
        ),
        notifyBootstrap: true,
        outcome: "idle_timeout",
        sandboxInstanceId: stream.sandboxInstanceId,
        streamId: stream.streamId,
      });
    }, this.#idleTimeoutMs);
  }

  private async forwardDataFrame(input: {
    payload: Uint8Array;
    sandboxInstanceId: string;
    streamId: number;
    targetBootstrapSessionId: string;
  }): Promise<void> {
    await this.relayCoordinator.forwardPeerMessage({
      sandboxInstanceId: input.sandboxInstanceId,
      fromSide: "connection",
      payload: encodeDataFrame({
        streamId: input.streamId,
        payloadKind: PayloadKindRawBytes,
        payload: input.payload,
      }).slice().buffer,
      targetSessionId: input.targetBootstrapSessionId,
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

  private assertTcpStreamLimits(input: {
    portAccessSessionKey: string;
    sandboxInstanceId: string;
  }): void {
    const sandboxStreamCount =
      this.#activeTcpStreamsBySandboxInstanceId.get(input.sandboxInstanceId)?.size ?? 0;
    if (sandboxStreamCount >= this.#maxActiveTcpStreamsPerSandbox) {
      throw new PortAccessTcpStreamLimitExceededError(
        `Sandbox '${input.sandboxInstanceId}' already has the maximum ${String(
          this.#maxActiveTcpStreamsPerSandbox,
        )} active TCP Port Access streams.`,
      );
    }

    const sessionStreamCount =
      this.#activeTcpStreamCountsByPortAccessSessionKey.get(input.portAccessSessionKey) ?? 0;
    if (sessionStreamCount >= this.#maxActiveTcpStreamsPerPortAccessSession) {
      throw new PortAccessTcpStreamLimitExceededError(
        `Port Access session already has the maximum ${String(
          this.#maxActiveTcpStreamsPerPortAccessSession,
        )} active TCP Port Access streams.`,
      );
    }
  }

  private reserveTcpStreamId(input: { sandboxInstanceId: string }): number {
    return this.tunnelSessionRegistry.reserveTunnelStream({
      sandboxInstanceId: input.sandboxInstanceId,
    }).tunnelStreamId;
  }

  private releaseTcpStreamId(input: { sandboxInstanceId: string; streamId: number }): void {
    this.tunnelSessionRegistry.releaseReservedTunnelStream({
      sandboxInstanceId: input.sandboxInstanceId,
      tunnelStreamId: input.streamId,
    });
  }

  private getActiveTcpStream(input: {
    sandboxInstanceId: string;
    streamId: number;
  }): ActivePortAccessTcpStream | undefined {
    return this.#activeTcpStreamsBySandboxInstanceId
      .get(input.sandboxInstanceId)
      ?.get(input.streamId);
  }

  private getMatchingActiveTcpStream(input: {
    sandboxInstanceId: string;
    sourceBootstrapSessionId: string;
    streamId: number;
  }): ActivePortAccessTcpStream | undefined {
    if (!this.isCurrentBootstrapSession(input)) {
      return undefined;
    }

    const activeStream = this.getActiveTcpStream(input);
    if (activeStream?.targetBootstrapSessionId !== input.sourceBootstrapSessionId) {
      return undefined;
    }

    return activeStream;
  }

  private setActiveTcpStream(input: {
    sandboxInstanceId: string;
    stream: ActivePortAccessTcpStream;
    streamId: number;
  }): void {
    const sandboxStreams =
      this.#activeTcpStreamsBySandboxInstanceId.get(input.sandboxInstanceId) ?? new Map();
    sandboxStreams.set(input.streamId, input.stream);
    this.#activeTcpStreamsBySandboxInstanceId.set(input.sandboxInstanceId, sandboxStreams);
    this.#activeTcpStreamCountsByPortAccessSessionKey.set(
      input.stream.portAccessSessionKey,
      (this.#activeTcpStreamCountsByPortAccessSessionKey.get(input.stream.portAccessSessionKey) ??
        0) + 1,
    );
    PortAccessActiveStreams.add(1, input.stream.attributes);
  }

  private deleteActiveTcpStream(input: { sandboxInstanceId: string; streamId: number }): void {
    const sandboxStreams = this.#activeTcpStreamsBySandboxInstanceId.get(input.sandboxInstanceId);
    if (sandboxStreams === undefined) {
      return;
    }

    const stream = sandboxStreams.get(input.streamId);
    sandboxStreams.delete(input.streamId);
    if (sandboxStreams.size === 0) {
      this.#activeTcpStreamsBySandboxInstanceId.delete(input.sandboxInstanceId);
    }
    if (stream === undefined) {
      return;
    }
    PortAccessActiveStreams.add(-1, stream.attributes);

    const nextSessionCount =
      (this.#activeTcpStreamCountsByPortAccessSessionKey.get(stream.portAccessSessionKey) ?? 1) - 1;
    if (nextSessionCount <= 0) {
      this.#activeTcpStreamCountsByPortAccessSessionKey.delete(stream.portAccessSessionKey);
      return;
    }

    this.#activeTcpStreamCountsByPortAccessSessionKey.set(
      stream.portAccessSessionKey,
      nextSessionCount,
    );
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
}

function toPortAccessSessionKey(input: {
  portAccessSessionId: string;
  sandboxInstanceId: string;
}): string {
  return `${input.sandboxInstanceId}:${input.portAccessSessionId}`;
}

function writeTcpClientBytes(input: { bytes: Uint8Array; client: Duplex }): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      input.client.off("drain", onDrain);
      input.client.off("error", onError);
    };
    const onDrain = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    if (input.client.write(input.bytes)) {
      resolve();
      return;
    }

    input.client.once("drain", onDrain);
    input.client.once("error", onError);
  });
}
