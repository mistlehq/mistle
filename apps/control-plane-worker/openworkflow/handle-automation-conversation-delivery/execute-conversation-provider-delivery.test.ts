import {
  decodeDataFrame,
  encodeDataFrame,
  parseStreamControlMessage,
  PayloadKindWebSocketText,
} from "@mistle/sandbox-session-protocol";
import { extractW3cTraceCarrier } from "@mistle/telemetry/trace-context.js";
import { TraceFlags, context, trace, type Context } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RawData, type WebSocket, WebSocketServer } from "ws";

import {
  executeConversationProviderDelivery,
  resolveDeliveryContextNotificationParams,
} from "./execute-conversation-provider-delivery.js";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type DeliveryContextMessage = {
  method: string;
  params: Record<string, unknown>;
};

type DeliveryServer = {
  close: () => Promise<void>;
  deliveryContextMessage: Promise<DeliveryContextMessage>;
  methodSequence: Promise<string[]>;
  url: string;
};

type DeliveryServerScenario =
  | "existing_conversation"
  | "create_conversation"
  | "resume_not_loaded_conversation";

const ParentSpanContext = {
  traceId: "0123456789abcdef0123456789abcdef",
  spanId: "0123456789abcdef",
  traceFlags: TraceFlags.SAMPLED,
};

const contextManager = new AsyncLocalStorageContextManager();

function createDeferred<T>(): Deferred<T> {
  let resolveFn: ((value: T) => void) | undefined;
  let rejectFn: ((reason: unknown) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });

  return {
    promise,
    resolve: (value) => {
      if (resolveFn === undefined) {
        throw new Error("Deferred resolve function was not initialized.");
      }
      resolveFn(value);
    },
    reject: (reason) => {
      if (rejectFn === undefined) {
        throw new Error("Deferred reject function was not initialized.");
      }
      rejectFn(reason);
    },
  };
}

function toText(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }

  return Buffer.concat(data).toString("utf8");
}

function toUint8Array(data: RawData): Uint8Array {
  if (typeof data === "string") {
    return new TextEncoder().encode(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (Buffer.isBuffer(data)) {
    return new Uint8Array(data);
  }

  return new Uint8Array(Buffer.concat(data));
}

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

function decodeAgentTextPayload(data: RawData): string {
  const dataFrame = decodeDataFrame(toUint8Array(data));
  if (dataFrame.payloadKind !== PayloadKindWebSocketText) {
    throw new Error(
      `Expected websocket text payload kind ${String(PayloadKindWebSocketText)}, received ${String(dataFrame.payloadKind)}.`,
    );
  }

  return new TextDecoder().decode(dataFrame.payload);
}

function encodeAgentTextPayload(input: { payload: unknown; streamId: number }): Uint8Array {
  return encodeDataFrame({
    streamId: input.streamId,
    payloadKind: PayloadKindWebSocketText,
    payload: new TextEncoder().encode(JSON.stringify(input.payload)),
  });
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected JSON object payload.");
  }

  return Object.fromEntries(Object.entries(value));
}

function expectMethodPayload(value: unknown): {
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
} {
  const record = expectRecord(value);
  if (typeof record.method !== "string") {
    throw new Error("Expected JSON-RPC method.");
  }

  const methodPayload: {
    id?: number | string;
    method: string;
    params?: Record<string, unknown>;
  } = {
    method: record.method,
  };

  if (typeof record.id === "string" || typeof record.id === "number") {
    methodPayload.id = record.id;
  }
  if ("params" in record) {
    methodPayload.params = expectRecord(record.params);
  }

  return methodPayload;
}

function expectJsonRpcId(value: number | string | undefined): number | string {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  throw new Error("Expected JSON-RPC id.");
}

function readDeliveryContextMessage(value: unknown): DeliveryContextMessage {
  const payload = expectMethodPayload(value);
  if (payload.method !== "mistle/setDeliveryContext") {
    throw new Error("Expected mistle/setDeliveryContext notification.");
  }

  return {
    method: payload.method,
    params: payload.params ?? {},
  };
}

async function startDeliveryServer(scenario: DeliveryServerScenario): Promise<DeliveryServer> {
  const deliveryContextDeferred = createDeferred<DeliveryContextMessage>();
  const methodSequenceDeferred = createDeferred<string[]>();

  const wsServer = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
  });

  await new Promise<void>((resolve, reject) => {
    wsServer.once("listening", () => resolve());
    wsServer.once("error", (error: Error) => reject(error));
  });

  let activeStreamId: number | null = null;
  const methodSequence: string[] = [];

  wsServer.on("connection", (socket: WebSocket) => {
    let didHandleOpen = false;
    let threadReadCount = 0;

    socket.on("message", (message: RawData) => {
      if (!didHandleOpen) {
        didHandleOpen = true;
        const payload = parseJson(toText(message));
        const record = expectRecord(payload);
        if (
          record.type !== "stream.open" ||
          typeof record.streamId !== "number" ||
          !Number.isInteger(record.streamId)
        ) {
          throw new Error("Expected stream.open handshake.");
        }

        activeStreamId = record.streamId;
        socket.send(
          JSON.stringify({
            type: "stream.open.ok",
            streamId: record.streamId,
          }),
        );
        return;
      }

      const controlMessage = parseStreamControlMessage(toText(message));
      if (controlMessage !== undefined) {
        return;
      }

      if (activeStreamId === null) {
        throw new Error("Expected active stream id.");
      }

      const payload = parseJson(decodeAgentTextPayload(message));
      const methodPayload = expectMethodPayload(payload);
      methodSequence.push(methodPayload.method);

      if (methodPayload.method === "initialize") {
        socket.send(
          encodeAgentTextPayload({
            streamId: activeStreamId,
            payload: {
              id: expectJsonRpcId(methodPayload.id),
              result: {
                protocolVersion: "2026-03-14",
                userAgent: "codex-cli/0.122.0",
              },
            },
          }),
        );
        return;
      }

      if (methodPayload.method === "initialized") {
        return;
      }

      if (methodPayload.method === "mistle/setDeliveryContext") {
        deliveryContextDeferred.resolve(readDeliveryContextMessage(payload));
        return;
      }

      if (methodPayload.method === "thread/read") {
        threadReadCount += 1;
        const threadStatusType =
          scenario === "resume_not_loaded_conversation" && threadReadCount === 1
            ? "notLoaded"
            : "idle";

        socket.send(
          encodeAgentTextPayload({
            streamId: activeStreamId,
            payload: {
              id: expectJsonRpcId(methodPayload.id),
              result: {
                thread: {
                  id: "thread_123",
                  status: {
                    type: threadStatusType,
                  },
                },
              },
            },
          }),
        );
        return;
      }

      if (methodPayload.method === "thread/start") {
        if (scenario !== "create_conversation") {
          throw new Error("Unexpected thread/start request for this scenario.");
        }

        socket.send(
          encodeAgentTextPayload({
            streamId: activeStreamId,
            payload: {
              id: expectJsonRpcId(methodPayload.id),
              result: {
                thread: {
                  id: "thread_123",
                },
              },
            },
          }),
        );
        return;
      }

      if (methodPayload.method === "thread/resume") {
        if (scenario !== "resume_not_loaded_conversation") {
          throw new Error("Unexpected thread/resume request for this scenario.");
        }

        socket.send(
          encodeAgentTextPayload({
            streamId: activeStreamId,
            payload: {
              id: expectJsonRpcId(methodPayload.id),
              result: {},
            },
          }),
        );
        return;
      }

      if (methodPayload.method === "turn/start") {
        socket.send(
          encodeAgentTextPayload({
            streamId: activeStreamId,
            payload: {
              id: expectJsonRpcId(methodPayload.id),
              result: {
                turn: {
                  id: "turn_123",
                },
              },
            },
          }),
        );
        methodSequenceDeferred.resolve([...methodSequence]);
        return;
      }

      throw new Error(`Unexpected JSON-RPC method '${methodPayload.method}'.`);
    });
  });

  const address = wsServer.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Expected websocket server to expose a concrete socket address.");
  }

  return {
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        wsServer.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }

          reject(error);
        });
      });
    },
    deliveryContextMessage: deliveryContextDeferred.promise,
    methodSequence: methodSequenceDeferred.promise,
    url: `ws://127.0.0.1:${String(address.port)}`,
  };
}

function expectedTraceparent(activeContext: Context): string {
  const traceparent = extractW3cTraceCarrier(activeContext)?.traceparent;
  if (typeof traceparent !== "string" || traceparent.length === 0) {
    throw new Error("Expected traceparent.");
  }

  return traceparent;
}

describe("executeConversationProviderDelivery", () => {
  beforeAll(() => {
    context.setGlobalContextManager(contextManager.enable());
  });

  afterAll(() => {
    contextManager.disable();
  });

  it("sends delivery context before any Codex delivery RPC", async () => {
    const server = await startDeliveryServer("existing_conversation");

    try {
      const activeContext = trace.setSpan(
        context.active(),
        trace.wrapSpanContext(ParentSpanContext),
      );
      const expectedTraceparentValue = expectedTraceparent(activeContext);

      const result = await context.with(
        activeContext,
        async () =>
          await executeConversationProviderDelivery({
            conversationId: "acv_123",
            runtimeId: "codex",
            connectionUrl: server.url,
            inputText: "Handle the webhook payload.",
            deliveryContext: {
              webhookEventId: "iwe_123",
              deliveryTaskId: "cdt_123",
              externalDeliveryId: "slack_delivery_123",
              automationRunId: "aru_123",
              conversationId: "acv_123",
              sandboxInstanceId: "sbi_123",
              routeId: "acr_123",
            },
            providerConversationId: "thread_123",
            providerExecutionId: null,
          }),
      );

      expect(result).toEqual({
        providerConversationId: "thread_123",
        providerExecutionId: "turn_123",
      });

      const deliveryContextMessage = await server.deliveryContextMessage;
      expect(deliveryContextMessage).toEqual({
        method: "mistle/setDeliveryContext",
        params: {
          traceparent: expectedTraceparentValue,
          webhookEventId: "iwe_123",
          deliveryTaskId: "cdt_123",
          externalDeliveryId: "slack_delivery_123",
          automationRunId: "aru_123",
          conversationId: "acv_123",
          sandboxInstanceId: "sbi_123",
          routeId: "acr_123",
        },
      });

      const methodSequence = await server.methodSequence;
      expect(methodSequence).toEqual([
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "thread/read",
        "turn/start",
      ]);
    } finally {
      await server.close();
    }
  });

  it("sends delivery context before creating a new Codex conversation", async () => {
    const server = await startDeliveryServer("create_conversation");

    try {
      const activeContext = trace.setSpan(
        context.active(),
        trace.wrapSpanContext(ParentSpanContext),
      );
      const expectedTraceparentValue = expectedTraceparent(activeContext);

      await context.with(
        activeContext,
        async () =>
          await executeConversationProviderDelivery({
            conversationId: "acv_123",
            runtimeId: "codex",
            connectionUrl: server.url,
            inputText: "Handle the webhook payload.",
            deliveryContext: {
              webhookEventId: "iwe_123",
              deliveryTaskId: "cdt_123",
              automationRunId: "aru_123",
              conversationId: "acv_123",
              sandboxInstanceId: "sbi_123",
            },
            providerConversationId: null,
            providerExecutionId: null,
          }),
      );

      expect(await server.deliveryContextMessage).toEqual({
        method: "mistle/setDeliveryContext",
        params: {
          traceparent: expectedTraceparentValue,
          webhookEventId: "iwe_123",
          deliveryTaskId: "cdt_123",
          automationRunId: "aru_123",
          conversationId: "acv_123",
          sandboxInstanceId: "sbi_123",
        },
      });

      expect(await server.methodSequence).toEqual([
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "thread/start",
        "thread/read",
        "turn/start",
      ]);
    } finally {
      await server.close();
    }
  });

  it("sends delivery context before resuming a not-loaded Codex conversation", async () => {
    const server = await startDeliveryServer("resume_not_loaded_conversation");

    try {
      await context.with(
        trace.setSpan(context.active(), trace.wrapSpanContext(ParentSpanContext)),
        async () =>
          await executeConversationProviderDelivery({
            conversationId: "acv_123",
            runtimeId: "codex",
            connectionUrl: server.url,
            inputText: "Handle the webhook payload.",
            deliveryContext: {
              webhookEventId: "iwe_123",
              deliveryTaskId: "cdt_123",
              automationRunId: "aru_123",
              conversationId: "acv_123",
              sandboxInstanceId: "sbi_123",
            },
            providerConversationId: "thread_123",
            providerExecutionId: null,
          }),
      );

      expect(await server.methodSequence).toEqual([
        "initialize",
        "initialized",
        "mistle/setDeliveryContext",
        "thread/read",
        "thread/resume",
        "thread/read",
        "turn/start",
      ]);
    } finally {
      await server.close();
    }
  });

  it("requires an active trace context for delivery-context notification params", () => {
    expect(() =>
      resolveDeliveryContextNotificationParams({
        webhookEventId: "iwe_123",
        deliveryTaskId: "cdt_123",
        automationRunId: "aru_123",
        conversationId: "acv_123",
        sandboxInstanceId: "sbi_123",
      }),
    ).toThrow(
      "Automation conversation delivery requires an active OpenTelemetry trace context before sending delivery context to Codex proxy.",
    );
  });
});
