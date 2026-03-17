import type {
  AgentExecutionObserverSession,
  CompiledAgentRuntime,
  CompiledRuntimeClient,
} from "@mistle/integrations-core";
import { resolveAgentExecutionObserver } from "@mistle/integrations-definitions/agent";
import {
  decodeDataFrame,
  PayloadKindWebSocketBinary,
  PayloadKindWebSocketText,
} from "@mistle/sandbox-session-protocol";
import type WebSocket from "ws";

import type { ActiveTunnelStreamRelay, ActiveTunnelStreamRelayResult } from "./active-relay.js";
import { trackObservedExecutions } from "./agent-execution-monitor.js";
import { AsyncQueue } from "./async-queue.js";
import type { TunnelSocketMessage } from "./connect-request.js";
import { parseControlMessageType, parseStreamCloseMessage } from "./connect-request.js";
import { ExecutionLeaseEngine } from "./execution-lease-engine.js";
import {
  CONNECT_ERROR_CODE_AGENT_ENDPOINT_DIAL_FAILED,
  CONNECT_ERROR_CODE_AGENT_ENDPOINT_UNAVAILABLE,
  CONNECT_ERROR_CODE_UNSUPPORTED_CONNECTION_MODE,
  STREAM_RESET_CODE_INVALID_STREAM_DATA,
  STREAM_RESET_CODE_INVALID_STREAM_WINDOW,
  STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
  writeBinaryDataFrame,
  writeStreamOpenError,
  writeStreamOpenOk,
  writeStreamReset,
  writeStreamWindow,
} from "./messages.js";
import { StreamSendWindow } from "./stream-window.js";
import {
  connectWebSocket,
  closeWebSocket,
  createWebSocketMessageQueue,
  isExpectedWebSocketClose,
} from "./websocket.js";

export type ResolvedAgentEndpoint = {
  runtimeKey: string;
  clientId: string;
  endpointKey: string;
  adapterKey: string;
  connectionMode: "dedicated" | "shared";
  transportUrl: string;
};

export function resolveAgentEndpoint(
  agentRuntimes: ReadonlyArray<CompiledAgentRuntime>,
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>,
): ResolvedAgentEndpoint | undefined {
  if (agentRuntimes.length === 0) {
    return undefined;
  }
  if (agentRuntimes.length > 1) {
    throw new Error(
      `runtime plan must declare at most one agent runtime for agent channel (found ${String(agentRuntimes.length)})`,
    );
  }

  const agentRuntime = agentRuntimes[0];
  if (agentRuntime === undefined) {
    throw new Error("agent runtime is required");
  }

  const runtimeClient = runtimeClients.find((client) => client.clientId === agentRuntime.clientId);
  if (runtimeClient === undefined) {
    throw new Error(
      `agent runtime '${agentRuntime.runtimeKey}' references missing runtime client '${agentRuntime.clientId}'`,
    );
  }

  const endpoint = runtimeClient.endpoints.find(
    (candidateEndpoint) => candidateEndpoint.endpointKey === agentRuntime.endpointKey,
  );
  if (endpoint === undefined) {
    throw new Error(
      `agent runtime '${agentRuntime.runtimeKey}' references missing endpoint '${agentRuntime.endpointKey}' on client '${agentRuntime.clientId}'`,
    );
  }
  if (endpoint.transport.type !== "ws") {
    throw new Error(
      `agent runtime '${agentRuntime.runtimeKey}' on client '${agentRuntime.clientId}' must reference a websocket endpoint`,
    );
  }

  return {
    runtimeKey: agentRuntime.runtimeKey,
    clientId: runtimeClient.clientId,
    endpointKey: endpoint.endpointKey,
    adapterKey: agentRuntime.adapterKey,
    connectionMode: endpoint.connectionMode,
    transportUrl: endpoint.transport.url,
  };
}

async function relayAgentFramesDirection(input: {
  signal: AbortSignal;
  agentSocket: WebSocket;
  observerSession: AgentExecutionObserverSession;
  sendWindow: StreamSendWindow;
  tunnelSocket: WebSocket;
  streamId: number;
}): Promise<void> {
  const agentMessages = createWebSocketMessageQueue(input.agentSocket);

  while (!input.signal.aborted) {
    let message: TunnelSocketMessage;
    try {
      message = await agentMessages.next(input.signal);
    } catch (error) {
      if (input.signal.aborted || isExpectedWebSocketClose(error)) {
        return;
      }

      throw new Error(
        `agent websocket read failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const payloadBytes =
      message.kind === "text" ? new TextEncoder().encode(message.payload) : message.payload;
    input.observerSession.onInboundMessage(
      message.kind === "text" ? message.payload : message.payload,
    );
    if (!input.sendWindow.tryConsume(payloadBytes.length)) {
      await writeStreamReset(input.tunnelSocket, {
        type: "stream.reset",
        streamId: input.streamId,
        code: STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
        message: "agent stream send window is exhausted",
      });
      return;
    }

    await writeBinaryDataFrame(input.tunnelSocket, {
      streamId: input.streamId,
      payloadKind: message.kind === "text" ? PayloadKindWebSocketText : PayloadKindWebSocketBinary,
      payload: payloadBytes,
    });
  }
}

async function relayTunnelFrames(input: {
  signal: AbortSignal;
  tunnelSocket: WebSocket;
  agentSocket: WebSocket;
  observerSession: AgentExecutionObserverSession;
  streamId: number;
  messages: AsyncQueue<TunnelSocketMessage>;
}): Promise<void> {
  const sendWindow = new StreamSendWindow();
  const outboundRelay = relayAgentFramesDirection({
    signal: input.signal,
    agentSocket: input.agentSocket,
    observerSession: input.observerSession,
    sendWindow,
    tunnelSocket: input.tunnelSocket,
    streamId: input.streamId,
  });

  while (!input.signal.aborted) {
    const nextTunnelMessage = input.messages.next(input.signal).then((message) => ({
      source: "tunnel" as const,
      message,
    }));
    const nextAgentResult = outboundRelay.then(() => ({
      source: "agent" as const,
    }));
    const nextEvent = await Promise.race([nextTunnelMessage, nextAgentResult]);

    if (nextEvent.source === "agent") {
      return;
    }

    const message = nextEvent.message;
    if (message.kind === "text") {
      const controlMessageType = parseControlMessageType(message.payload);
      if (controlMessageType === "stream.window") {
        const parsedWindow = JSON.parse(message.payload);
        const streamId =
          typeof parsedWindow.streamId === "number" && Number.isInteger(parsedWindow.streamId)
            ? parsedWindow.streamId
            : 0;
        const bytes =
          typeof parsedWindow.bytes === "number" && Number.isInteger(parsedWindow.bytes)
            ? parsedWindow.bytes
            : 0;
        if (streamId !== input.streamId) {
          throw new Error(
            `stream.window streamId ${String(streamId)} does not match active agent stream ${String(input.streamId)}`,
          );
        }
        try {
          sendWindow.add(bytes);
        } catch (error) {
          await writeStreamReset(input.tunnelSocket, {
            type: "stream.reset",
            streamId: input.streamId,
            code: STREAM_RESET_CODE_INVALID_STREAM_WINDOW,
            message: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        continue;
      }
      if (controlMessageType === "stream.close") {
        const closeMessage = parseStreamCloseMessage(message.payload);
        if (closeMessage.streamId !== input.streamId) {
          throw new Error(
            `stream.close streamId ${String(closeMessage.streamId)} does not match active agent stream ${String(input.streamId)}`,
          );
        }
        return;
      }

      await writeStreamReset(input.tunnelSocket, {
        type: "stream.reset",
        streamId: input.streamId,
        code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
        message: "agent stream only accepts binary data frames after stream.open",
      });
      return;
    }

    let dataFrame;
    try {
      dataFrame = decodeDataFrame(message.payload);
    } catch (error) {
      await writeStreamReset(input.tunnelSocket, {
        type: "stream.reset",
        streamId: input.streamId,
        code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (dataFrame.streamId !== input.streamId) {
      await writeStreamReset(input.tunnelSocket, {
        type: "stream.reset",
        streamId: input.streamId,
        code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
        message: `stream data frame streamId ${String(dataFrame.streamId)} does not match active agent stream ${String(input.streamId)}`,
      });
      return;
    }

    let outboundMessage: TunnelSocketMessage;
    switch (dataFrame.payloadKind) {
      case PayloadKindWebSocketText:
        outboundMessage = {
          kind: "text",
          payload: new TextDecoder().decode(dataFrame.payload),
        };
        break;
      case PayloadKindWebSocketBinary:
        outboundMessage = {
          kind: "binary",
          payload: dataFrame.payload,
        };
        break;
      default:
        await writeStreamReset(input.tunnelSocket, {
          type: "stream.reset",
          streamId: input.streamId,
          code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
          message: `agent stream payloadKind ${String(dataFrame.payloadKind)} is not supported`,
        });
        return;
    }

    try {
      input.observerSession.onOutboundMessage(
        outboundMessage.kind === "text" ? outboundMessage.payload : outboundMessage.payload,
      );
      await connectAndSendAgentMessage(input.agentSocket, outboundMessage);
    } catch (error) {
      if (isExpectedWebSocketClose(error)) {
        return;
      }

      throw new Error(
        `agent websocket write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    await writeStreamWindow(input.tunnelSocket, {
      type: "stream.window",
      streamId: input.streamId,
      bytes: dataFrame.payload.length,
    });
  }
}

function connectAndSendAgentMessage(
  agentSocket: WebSocket,
  outboundMessage: TunnelSocketMessage,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    agentSocket.send(
      outboundMessage.payload,
      { binary: outboundMessage.kind === "binary" },
      (error) => {
        if (error == null) {
          resolve();
          return;
        }

        reject(error);
      },
    );
  });
}

export async function handleAgentConnectRequest(input: {
  signal: AbortSignal;
  tunnelSocket: WebSocket;
  streamId: number;
  agentRuntimes: ReadonlyArray<CompiledAgentRuntime>;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
  executionLeases: ExecutionLeaseEngine;
  executionLeasePollIntervalMs?: number;
  relayResultQueue: AsyncQueue<ActiveTunnelStreamRelayResult>;
}): Promise<ActiveTunnelStreamRelay | undefined> {
  let agentEndpoint: ResolvedAgentEndpoint | undefined;
  try {
    agentEndpoint = resolveAgentEndpoint(input.agentRuntimes, input.runtimeClients);
  } catch (error) {
    await writeStreamOpenError(input.tunnelSocket, {
      type: "stream.open.error",
      streamId: input.streamId,
      code: CONNECT_ERROR_CODE_AGENT_ENDPOINT_UNAVAILABLE,
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }

  if (agentEndpoint === undefined) {
    await writeStreamOpenError(input.tunnelSocket, {
      type: "stream.open.error",
      streamId: input.streamId,
      code: CONNECT_ERROR_CODE_AGENT_ENDPOINT_UNAVAILABLE,
      message: "agent endpoint is not declared in runtime plan",
    });
    return undefined;
  }
  if (agentEndpoint.connectionMode !== "dedicated") {
    await writeStreamOpenError(input.tunnelSocket, {
      type: "stream.open.error",
      streamId: input.streamId,
      code: CONNECT_ERROR_CODE_UNSUPPORTED_CONNECTION_MODE,
      message: `connection mode '${agentEndpoint.connectionMode}' is not supported`,
    });
    return undefined;
  }

  let observerSession: AgentExecutionObserverSession;
  try {
    observerSession = resolveAgentExecutionObserver(agentEndpoint.adapterKey).createSession({
      transportUrl: agentEndpoint.transportUrl,
    });
  } catch (error) {
    await writeStreamOpenError(input.tunnelSocket, {
      type: "stream.open.error",
      streamId: input.streamId,
      code: CONNECT_ERROR_CODE_AGENT_ENDPOINT_UNAVAILABLE,
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }

  let agentSocket: WebSocket;
  try {
    agentSocket = await connectWebSocket(agentEndpoint.transportUrl, input.signal);
  } catch (error) {
    await writeStreamOpenError(input.tunnelSocket, {
      type: "stream.open.error",
      streamId: input.streamId,
      code: CONNECT_ERROR_CODE_AGENT_ENDPOINT_DIAL_FAILED,
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }

  await writeStreamOpenOk(input.tunnelSocket, {
    type: "stream.open.ok",
    streamId: input.streamId,
  });

  const relay: ActiveTunnelStreamRelay = {
    primaryStreamId: input.streamId,
    channelKind: "agent",
    messages: new AsyncQueue<TunnelSocketMessage>(),
  };

  void relayAgentSession({
    signal: input.signal,
    tunnelSocket: input.tunnelSocket,
    agentSocket,
    observerSession,
    executionLeases: input.executionLeases,
    ...(input.executionLeasePollIntervalMs === undefined
      ? {}
      : { executionLeasePollIntervalMs: input.executionLeasePollIntervalMs }),
    streamId: input.streamId,
    messages: relay.messages,
  })
    .then(() => {
      input.relayResultQueue.push({
        relay,
        updatesPtySession: false,
      });
    })
    .catch((error: unknown) => {
      input.relayResultQueue.push({
        relay,
        error: error instanceof Error ? error : new Error(String(error)),
        updatesPtySession: false,
      });
    });

  return relay;
}

async function relayAgentSession(input: {
  signal: AbortSignal;
  tunnelSocket: WebSocket;
  agentSocket: WebSocket;
  observerSession: AgentExecutionObserverSession;
  executionLeases: ExecutionLeaseEngine;
  executionLeasePollIntervalMs?: number;
  streamId: number;
  messages: AsyncQueue<TunnelSocketMessage>;
}): Promise<void> {
  try {
    await relayTunnelFrames(input);
  } finally {
    await closeWebSocket(input.agentSocket).catch(() => undefined);
    if (!input.signal.aborted) {
      trackObservedExecutions({
        signal: input.signal,
        executionLeases: input.executionLeases,
        observations: input.observerSession.drainObservations(),
        ...(input.executionLeasePollIntervalMs === undefined
          ? {}
          : { pollIntervalMs: input.executionLeasePollIntervalMs }),
      });
    }
  }
}
