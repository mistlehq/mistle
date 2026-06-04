import { isDeepStrictEqual } from "node:util";

import {
  decodeDataFrame,
  encodeDataFrame,
  parseStreamControlMessage,
  PayloadKindWebSocketText,
} from "@mistle/sandbox-session-protocol";
import { type RawData, type WebSocket, WebSocketServer } from "ws";

export type SimulatedCodexRuntimeScenario =
  | "existing_conversation"
  | "existing_conversation_with_collaboration_mode"
  | "create_conversation"
  | "resume_not_loaded_conversation"
  | "no_default_model"
  | "turn_start_error";

export type SimulatedCodexRuntimeServer = {
  close: () => Promise<void>;
  deliveryContextMessage: Promise<DeliveryContextMessage>;
  methodSequence: Promise<string[]>;
  url: string;
};

export type SimulatedCodexRuntimeServerOptions = {
  expectedThreadStartCwd?: string;
  rejectReusedRequestUrl?: boolean;
};

export type DeliveryContextMessage = {
  method: string;
  params: Record<string, unknown>;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

export const DefaultCodexModel = "gpt-5.3-codex";
export const SimulatedTurnStartFailureMessage = "simulated turn failure";

const FallbackCodexModel = "gpt-5.5";
const FallbackCodexModelReasoningEffort = "medium";

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

function sendAgentPayload(
  socket: WebSocket,
  input: {
    streamId: number;
    payload: unknown;
  },
): void {
  socket.send(encodeAgentTextPayload(input));
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

function expectRequestModel(input: {
  method: string;
  params: Record<string, unknown> | undefined;
  expectedModel: string;
  expectedEffort?: string | undefined;
}): void {
  if (input.params === undefined || input.params.model !== input.expectedModel) {
    throw new Error(`Expected ${input.method} to use Codex model '${input.expectedModel}'.`);
  }
  if (input.expectedEffort === undefined) {
    if ("effort" in input.params) {
      throw new Error(`Expected ${input.method} to omit Codex reasoning effort.`);
    }
    return;
  }
  if (input.params.effort !== input.expectedEffort) {
    throw new Error(
      `Expected ${input.method} to use Codex reasoning effort '${input.expectedEffort}'.`,
    );
  }
}

function expectCollaborationModeSettings(input: {
  params: Record<string, unknown> | undefined;
  expectedModel: string;
  expectedEffort: string | null;
  expectedDeveloperInstructions: string | null;
}): void {
  if (input.params === undefined) {
    throw new Error("Expected JSON-RPC params.");
  }
  const collaborationMode = expectRecord(input.params.collaborationMode);
  if (collaborationMode.mode !== "default") {
    throw new Error("Expected default Codex collaboration mode.");
  }
  const settings = expectRecord(collaborationMode.settings);
  const expectedSettings = {
    model: input.expectedModel,
    reasoning_effort: input.expectedEffort,
    developer_instructions: input.expectedDeveloperInstructions,
  };
  if (!isDeepStrictEqual(settings, expectedSettings)) {
    throw new Error(
      `Expected collaboration mode settings ${JSON.stringify(expectedSettings)}, received ${JSON.stringify(settings)}.`,
    );
  }
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

// Simulates the Codex runtime WebSocket protocol that production delivery reaches
// through the sandbox session connection. The method sequence is grounded in
// packages/integrations-definitions/src/agent-runtimes/codex/conversation-provider.server.ts
// and packages/integrations-definitions/src/agent-runtimes/codex/codex-json-rpc.ts.
export async function startSimulatedCodexRuntimeServer(
  scenario: SimulatedCodexRuntimeScenario,
  options: SimulatedCodexRuntimeServerOptions = {},
): Promise<SimulatedCodexRuntimeServer> {
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
  const seenRequestUrls = new Set<string>();

  wsServer.on("connection", (socket: WebSocket, request) => {
    if (options.rejectReusedRequestUrl === true) {
      const requestUrl = request.url;
      if (requestUrl === undefined) {
        throw new Error("Expected websocket request url.");
      }
      if (seenRequestUrls.has(requestUrl)) {
        socket.close(1008, "simulated connection URL replay");
        return;
      }
      seenRequestUrls.add(requestUrl);
    }

    let didHandleOpen = false;
    let threadReadCount = 0;

    socket.on("message", (message: RawData) => {
      try {
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
          sendAgentPayload(socket, {
            streamId: activeStreamId,
            payload: {
              id: expectJsonRpcId(methodPayload.id),
              result: {
                protocolVersion: "2026-03-14",
                userAgent: "codex-cli/0.137.0",
              },
            },
          });
          return;
        }

        if (methodPayload.method === "initialized") {
          return;
        }

        if (methodPayload.method === "mistle/setDeliveryContext") {
          deliveryContextDeferred.resolve(readDeliveryContextMessage(payload));
          return;
        }

        if (methodPayload.method === "model/list") {
          const modelListData =
            scenario === "no_default_model"
              ? [
                  {
                    id: "model_other",
                    model: "gpt-5.4",
                    displayName: "GPT-5.4",
                    isDefault: false,
                  },
                ]
              : [
                  {
                    id: "model_default",
                    model: DefaultCodexModel,
                    displayName: "GPT-5.3 Codex",
                    isDefault: true,
                  },
                  {
                    id: "model_other",
                    model: "gpt-5.4",
                    displayName: "GPT-5.4",
                    isDefault: false,
                  },
                ];

          sendAgentPayload(socket, {
            streamId: activeStreamId,
            payload: {
              id: expectJsonRpcId(methodPayload.id),
              result: {
                data: modelListData,
                nextCursor: null,
              },
            },
          });
          return;
        }

        if (methodPayload.method === "thread/read") {
          threadReadCount += 1;
          const threadStatusType =
            scenario === "resume_not_loaded_conversation" && threadReadCount === 1
              ? "notLoaded"
              : "idle";

          sendAgentPayload(socket, {
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
          });
          return;
        }

        if (methodPayload.method === "thread/start") {
          if (scenario !== "create_conversation") {
            throw new Error("Unexpected thread/start request for this scenario.");
          }
          expectRequestModel({
            method: methodPayload.method,
            params: methodPayload.params,
            expectedModel: DefaultCodexModel,
          });
          if (options.expectedThreadStartCwd !== undefined) {
            if (methodPayload.params?.cwd !== options.expectedThreadStartCwd) {
              throw new Error(
                `Expected thread/start cwd '${options.expectedThreadStartCwd}', received '${String(methodPayload.params?.cwd)}'.`,
              );
            }
          }

          sendAgentPayload(socket, {
            streamId: activeStreamId,
            payload: {
              id: expectJsonRpcId(methodPayload.id),
              result: {
                thread: {
                  id: "thread_123",
                },
              },
            },
          });
          return;
        }

        if (methodPayload.method === "thread/resume") {
          if (scenario !== "resume_not_loaded_conversation") {
            throw new Error("Unexpected thread/resume request for this scenario.");
          }

          sendAgentPayload(socket, {
            streamId: activeStreamId,
            payload: {
              id: expectJsonRpcId(methodPayload.id),
              result: {},
            },
          });
          return;
        }

        if (methodPayload.method === "turn/start") {
          expectRequestModel(
            scenario === "no_default_model"
              ? {
                  method: methodPayload.method,
                  params: methodPayload.params,
                  expectedModel: FallbackCodexModel,
                  expectedEffort: FallbackCodexModelReasoningEffort,
                }
              : {
                  method: methodPayload.method,
                  params: methodPayload.params,
                  expectedModel: DefaultCodexModel,
                },
          );
          if (scenario === "existing_conversation_with_collaboration_mode") {
            expectCollaborationModeSettings({
              params: methodPayload.params,
              expectedModel: DefaultCodexModel,
              expectedEffort: null,
              expectedDeveloperInstructions: "Use the staged Slack workflow instructions.",
            });
          }
          if (scenario === "turn_start_error") {
            sendAgentPayload(socket, {
              streamId: activeStreamId,
              payload: {
                id: expectJsonRpcId(methodPayload.id),
                error: {
                  code: -32000,
                  message: SimulatedTurnStartFailureMessage,
                },
              },
            });
            methodSequenceDeferred.resolve([...methodSequence]);
            return;
          }

          sendAgentPayload(socket, {
            streamId: activeStreamId,
            payload: {
              id: expectJsonRpcId(methodPayload.id),
              result: {
                turn: {
                  id: "turn_123",
                },
              },
            },
          });
          methodSequenceDeferred.resolve([...methodSequence]);
          return;
        }

        throw new Error(`Unexpected JSON-RPC method '${methodPayload.method}'.`);
      } catch (error) {
        deliveryContextDeferred.reject(error);
        methodSequenceDeferred.reject(error);
      }
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
