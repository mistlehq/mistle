import {
  PayloadKindWebSocketBinary,
  PayloadKindWebSocketText,
  type StreamOpenError,
  type StreamOpenOK,
} from "@mistle/sandbox-session-protocol";

import {
  SandboxSessionSocketReadyStates,
  type SandboxSessionSendGuarantee,
  type SandboxSessionSocket,
} from "./runtime.js";
import { isRecord } from "./shared/is-record.js";
import {
  SandboxSessionStreamOpenError,
  GatewayServiceRestartReconnectMessage,
  type SandboxSessionStream,
  type SandboxSessionStreamEvent,
  type SandboxSessionTransport,
  type SandboxSessionTransportEvent,
  type GatewayServiceRestartCloseInfo,
} from "./transport.js";
import type {
  JsonRpcErrorResponse,
  JsonRpcNotification,
  JsonRpcServerRequest,
  JsonRpcSuccessResponse,
  SandboxSessionConnectionState,
  SandboxSessionEvent,
  SandboxSessionResetInfo,
} from "./types.js";

const JsonTextEncoder = new TextEncoder();
const JsonTextDecoder = new TextDecoder();

export type AgentStreamClientInput = {
  transport: SandboxSessionTransport;
};

type EventListener = (event: SandboxSessionEvent) => void;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readJsonRpcId(value: unknown): string | number | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  return null;
}

function parseJsonRpcSuccessResponse(value: unknown): JsonRpcSuccessResponse | null {
  if (!isRecord(value) || !("result" in value)) {
    return null;
  }

  const id = readJsonRpcId(value.id);
  if (id === null) {
    return null;
  }

  return {
    id,
    result: value.result,
  };
}

function parseJsonRpcErrorResponse(value: unknown): JsonRpcErrorResponse | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readJsonRpcId(value.id);
  const error = value.error;
  if (id === null || !isRecord(error)) {
    return null;
  }

  const code = error.code;
  const message = readString(error.message);
  if (typeof code !== "number" || !Number.isInteger(code) || message === null) {
    return null;
  }

  return {
    id,
    error: {
      code,
      message,
      ...("data" in error ? { data: error.data } : {}),
    },
  };
}

function parseJsonRpcNotification(value: unknown): JsonRpcNotification | null {
  if (!isRecord(value) || "id" in value) {
    return null;
  }

  const method = readString(value.method);
  if (method === null) {
    return null;
  }

  return {
    method,
    ...("params" in value ? { params: value.params } : {}),
  };
}

function parseJsonRpcServerRequest(value: unknown): JsonRpcServerRequest | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readJsonRpcId(value.id);
  const method = readString(value.method);
  if (id === null || method === null) {
    return null;
  }

  return {
    id,
    method,
    ...("params" in value ? { params: value.params } : {}),
  };
}

function parseStreamOpenControlMessage(payload: string): StreamOpenOK | StreamOpenError | null {
  let parsedPayload: unknown;
  try {
    parsedPayload = JSON.parse(payload);
  } catch {
    return null;
  }

  if (!isRecord(parsedPayload)) {
    return null;
  }

  if (
    typeof parsedPayload.streamId !== "number" ||
    !Number.isInteger(parsedPayload.streamId) ||
    parsedPayload.streamId <= 0
  ) {
    return null;
  }

  if (parsedPayload.type === "stream.open.ok") {
    return {
      type: "stream.open.ok",
      streamId: parsedPayload.streamId,
    };
  }

  if (parsedPayload.type !== "stream.open.error") {
    return null;
  }

  const code = readString(parsedPayload.code);
  const message = readString(parsedPayload.message);
  if (code === null || message === null) {
    return null;
  }

  return {
    type: "stream.open.error",
    streamId: parsedPayload.streamId,
    code,
    message,
  };
}

export {
  parseJsonRpcErrorResponse,
  parseJsonRpcNotification,
  parseJsonRpcServerRequest,
  parseJsonRpcSuccessResponse,
  parseStreamOpenControlMessage,
};

export class AgentStreamClient {
  readonly #listeners = new Set<EventListener>();
  readonly #transport: SandboxSessionTransport;
  readonly #unsubscribeTransportEvent: () => void;

  #errorMessage: string | null = null;
  #openError: StreamOpenError | null = null;
  #resetInfo: SandboxSessionResetInfo | null = null;
  #state: SandboxSessionConnectionState = "idle";
  #stream: SandboxSessionStream | null = null;
  #unsubscribeStreamEvent: (() => void) | null = null;
  #gatewayServiceRestartCloseInfo: GatewayServiceRestartCloseInfo | null = null;

  constructor(input: AgentStreamClientInput) {
    this.#transport = input.transport;
    this.#unsubscribeTransportEvent = this.#transport.onEvent((event) => {
      this.#handleTransportEvent(event);
    });
  }

  get state(): SandboxSessionConnectionState {
    return this.#state;
  }

  get errorMessage(): string | null {
    return this.#errorMessage;
  }

  get openError(): StreamOpenError | null {
    return this.#openError;
  }

  get resetInfo(): SandboxSessionResetInfo | null {
    return this.#resetInfo;
  }

  get socket(): SandboxSessionSocket | null {
    return this.#transport.socket;
  }

  get streamId(): number | null {
    return this.#stream?.streamId ?? null;
  }

  get sendGuarantee(): SandboxSessionSendGuarantee | null {
    return this.#transport.sendGuarantee;
  }

  onEvent(listener: EventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async connect(): Promise<void> {
    await this.openAgentStream();
  }

  async openAgentStream(): Promise<void> {
    if (this.#transport.readyState !== SandboxSessionSocketReadyStates.OPEN) {
      throw new Error("Sandbox session transport is not connected.");
    }
    if (this.#stream !== null) {
      throw new Error("Sandbox session stream is already open.");
    }

    this.#openError = null;
    this.#resetInfo = null;
    this.#setState("opening_agent_stream", null);

    try {
      const stream = await this.#transport.openStream({
        channel: {
          kind: "agent",
        },
      });
      this.#attachStream(stream);
      this.#setState("connected_socket", null);
    } catch (error) {
      if (this.#hasGatewayServiceRestartCloseState()) {
        throw error;
      }

      if (error instanceof SandboxSessionStreamOpenError) {
        this.#openError = error.openError;
        this.#setState("error", error.openError.message);
        throw error;
      }

      if (error instanceof Error) {
        this.#setState("error", error.message);
      }

      throw error;
    }
  }

  disconnect(): void {
    const stream = this.#stream;
    this.#detachStream();
    if (stream !== null && stream.state === "open") {
      void stream.sendControl({ type: "stream.close" }).catch(() => {});
    }
    this.#setState("closed", null);
  }

  dispose(): void {
    this.disconnect();
    this.#unsubscribeTransportEvent();
    this.#listeners.clear();
  }

  async sendJson(payload: unknown): Promise<void> {
    await this.sendText(JSON.stringify(payload));
  }

  async sendText(payload: string): Promise<void> {
    const stream = this.#stream;
    if (this.#transport.readyState !== SandboxSessionSocketReadyStates.OPEN) {
      throw new Error("Sandbox session socket is not open.");
    }
    if (stream === null || stream.state !== "open") {
      throw new Error("Sandbox session stream is not open.");
    }

    await stream.sendDataFrame({
      payloadKind: PayloadKindWebSocketText,
      payload: JsonTextEncoder.encode(payload),
    });
  }

  markInitializing(): void {
    this.#setState("initializing", null);
  }

  markReady(): void {
    this.#setState("ready", null);
  }

  #attachStream(stream: SandboxSessionStream): void {
    this.#stream = stream;
    this.#unsubscribeStreamEvent = stream.onEvent((event) => {
      this.#handleStreamEvent(stream, event);
    });
  }

  #detachStream(): void {
    this.#unsubscribeStreamEvent?.();
    this.#unsubscribeStreamEvent = null;
    this.#stream = null;
  }

  #handleTransportEvent(event: SandboxSessionTransportEvent): void {
    if (this.#state === "idle" || this.#state === "closed") {
      return;
    }

    if (event.type === "close") {
      this.#detachStream();
      this.#setState(
        "closed",
        event.gatewayServiceRestart !== null
          ? GatewayServiceRestartReconnectMessage
          : event.reason.length > 0
            ? event.reason
            : "Sandbox websocket connection closed.",
        event.gatewayServiceRestart,
      );
      return;
    }

    if (event.type === "error") {
      this.#detachStream();
      this.#setState("error", event.error.message);
    }
  }

  #handleStreamEvent(stream: SandboxSessionStream, event: SandboxSessionStreamEvent): void {
    if (this.#stream !== stream) {
      return;
    }

    if (event.type === "state_changed") {
      if (event.state === "reset") {
        const resetInfo = this.#resetInfo;
        this.#detachStream();
        this.#setState("connected_socket", null);
        if (resetInfo !== null) {
          this.#emit({
            type: "stream_reset",
            resetInfo,
          });
        }
        return;
      }

      if (event.state === "transport_closed") {
        this.#detachStream();
        this.#setState(
          "closed",
          event.errorMessage ?? "Sandbox websocket connection closed.",
          event.gatewayServiceRestart ?? null,
        );
        return;
      }

      if (event.state === "closed") {
        this.#detachStream();
        this.#setState("connected_socket", null);
      }
      return;
    }

    if (event.type === "control") {
      if (event.message.type === "stream.reset") {
        this.#resetInfo = {
          code: event.message.code,
          message: event.message.message,
        };
      }
      return;
    }

    if (event.frame.payloadKind === PayloadKindWebSocketText) {
      this.#emitParsedJsonMessage(JsonTextDecoder.decode(event.frame.payload));
      return;
    }

    if (event.frame.payloadKind === PayloadKindWebSocketBinary) {
      this.#emit({
        type: "unhandled_message",
        payload: event.frame.payload,
      });
      return;
    }

    this.#emit({
      type: "unhandled_message",
      payload: event.frame,
    });
  }

  #setState(
    state: SandboxSessionConnectionState,
    errorMessage: string | null,
    gatewayServiceRestart?: GatewayServiceRestartCloseInfo | null,
  ): void {
    this.#state = state;
    this.#errorMessage = errorMessage;
    this.#gatewayServiceRestartCloseInfo =
      state === "closed" && gatewayServiceRestart !== undefined ? gatewayServiceRestart : null;
    this.#emit(
      gatewayServiceRestart === undefined || gatewayServiceRestart === null
        ? {
            type: "connection_state_changed",
            state,
            errorMessage,
          }
        : {
            type: "connection_state_changed",
            state,
            errorMessage,
            gatewayServiceRestart,
          },
    );
  }

  #hasGatewayServiceRestartCloseState(): boolean {
    return this.#state === "closed" && this.#gatewayServiceRestartCloseInfo !== null;
  }

  #emit(event: SandboxSessionEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }

  #emitParsedJsonMessage(payload: string): void {
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(payload);
    } catch {
      this.#emit({
        type: "unhandled_message",
        payload,
      });
      return;
    }

    const successResponse = parseJsonRpcSuccessResponse(parsedPayload);
    if (successResponse !== null) {
      this.#emit({
        type: "response",
        response: successResponse,
      });
      return;
    }

    const errorResponse = parseJsonRpcErrorResponse(parsedPayload);
    if (errorResponse !== null) {
      this.#emit({
        type: "response",
        response: errorResponse,
      });
      return;
    }

    const serverRequest = parseJsonRpcServerRequest(parsedPayload);
    if (serverRequest !== null) {
      this.#emit({
        type: "server_request",
        request: serverRequest,
      });
      return;
    }

    const notification = parseJsonRpcNotification(parsedPayload);
    if (notification !== null) {
      this.#emit({
        type: "notification",
        notification,
      });
      return;
    }

    this.#emit({
      type: "unhandled_message",
      payload: parsedPayload,
    });
  }
}
