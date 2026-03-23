import type { CompiledAgentRuntime, CompiledRuntimeClient } from "@mistle/integrations-core";
import type WebSocket from "ws";

import { logSandboxRuntimeEvent } from "../runtime/logger.js";
import { ignorePromiseRejectionAfterAbort } from "./abortable-race.js";
import {
  finishActiveTunnelStreamRelay,
  type ActiveTunnelStreamRelay,
  type ActiveTunnelStreamRelayResult,
} from "./active-relay.js";
import { handleAgentConnectRequest } from "./agent-channel.js";
import { AsyncQueue } from "./async-queue.js";
import { parseConnectRequestMessage, parsePtyConnectRequest } from "./connect-request.js";
import { ExecutionLeaseEngine } from "./execution-lease-engine.js";
import {
  CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST,
  CONNECT_ERROR_CODE_UNSUPPORTED_CHANNEL,
  STREAM_RESET_CODE_INVALID_STREAM_CLOSE,
  STREAM_RESET_CODE_INVALID_STREAM_DATA,
  STREAM_RESET_CODE_INVALID_STREAM_SIGNAL,
  writeStreamOpenError,
  writeStreamReset,
} from "./messages.js";
import { handlePtyConnectRequest } from "./pty-channel.js";
import type { PtySession } from "./pty-session.js";
import {
  TunnelTokens,
  exchangeTunnelTokensNow,
  nextTunnelReconnectDelay,
  normalizeBootstrapToken,
  parseGatewayUrl,
  runTunnelTokenExchangeLoop,
} from "./token-exchange.js";
import { parseTunnelMessageRouting } from "./tunnel-message.js";
import { closeWebSocket, connectWebSocket, createWebSocketMessageQueue } from "./websocket.js";

export type TunnelCompletion =
  | {
      kind: "aborted";
    }
  | {
      kind: "closed";
    }
  | {
      kind: "error";
      error: Error;
    };

export type StartedTunnelClient = {
  close(): Promise<void>;
  closed: Promise<void>;
  completion: Promise<TunnelCompletion>;
};

export type StartTunnelClientInput = {
  signal: AbortSignal;
  gatewayWsUrl: string;
  bootstrapToken: string;
  tunnelExchangeToken: string;
  agentRuntimes: ReadonlyArray<CompiledAgentRuntime>;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
};

function describeUnknownError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint" ||
    typeof error === "symbol"
  ) {
    return error.toString();
  }

  return "unknown tunnel error";
}

function writeStreamAlreadyOpenError(socket: WebSocket, streamId: number): Promise<void> {
  return writeStreamOpenError(socket, {
    type: "stream.open.error",
    streamId,
    code: CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST,
    message: `stream ${String(streamId)} is already open on the bootstrap tunnel`,
  });
}

function writeUnboundStreamReset(
  socket: WebSocket,
  routing: ReturnType<typeof parseTunnelMessageRouting>,
): Promise<void> {
  let resetCode = STREAM_RESET_CODE_INVALID_STREAM_DATA;
  if (routing.controlMessageType === "stream.signal") {
    resetCode = STREAM_RESET_CODE_INVALID_STREAM_SIGNAL;
  } else if (routing.controlMessageType === "stream.close") {
    resetCode = STREAM_RESET_CODE_INVALID_STREAM_CLOSE;
  }

  return writeStreamReset(socket, {
    type: "stream.reset",
    streamId: routing.streamId,
    code: resetCode,
    message: `stream ${String(routing.streamId)} is not open on the bootstrap tunnel`,
  });
}

async function waitForReconnect(signal: AbortSignal, delayMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", abortListener);
      resolve();
    }, delayMs);
    const abortListener = (): void => {
      clearTimeout(timeout);
      reject(signal.reason ?? new Error("operation was aborted"));
    };

    if (signal.aborted) {
      abortListener();
      return;
    }

    signal.addEventListener("abort", abortListener, { once: true });
  });
}

async function handleTunnelConnection(input: {
  signal: AbortSignal;
  tunnelSocket: WebSocket;
  executionLeases: ExecutionLeaseEngine;
  agentRuntimes: ReadonlyArray<CompiledAgentRuntime>;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
}): Promise<void> {
  const tunnelMessages = createWebSocketMessageQueue(input.tunnelSocket);
  const relayResultQueue = new AsyncQueue<ActiveTunnelStreamRelayResult>();
  const activeRelaysByStreamId = new Map<number, ActiveTunnelStreamRelay>();
  let activePtyRelay: ActiveTunnelStreamRelay | undefined;
  let activePtySession: PtySession | undefined;

  while (!input.signal.aborted) {
    const nextTunnelMessageAbortController = new AbortController();
    const nextRelayResultAbortController = new AbortController();
    const nextTunnelMessage = ignorePromiseRejectionAfterAbort(
      tunnelMessages
        .next(AbortSignal.any([input.signal, nextTunnelMessageAbortController.signal]))
        .then((message) => ({
          source: "tunnel" as const,
          message,
        })),
      nextTunnelMessageAbortController.signal,
    );
    const nextRelayResult = ignorePromiseRejectionAfterAbort(
      relayResultQueue
        .next(AbortSignal.any([input.signal, nextRelayResultAbortController.signal]))
        .then((result) => ({
          source: "relay" as const,
          result,
        })),
      nextRelayResultAbortController.signal,
    );

    const nextEvent = await Promise.race([nextTunnelMessage, nextRelayResult]);
    nextTunnelMessageAbortController.abort();
    nextRelayResultAbortController.abort();

    if (nextEvent.source === "relay") {
      const updatedState = finishActiveTunnelStreamRelay(
        activeRelaysByStreamId,
        activePtyRelay,
        activePtySession,
        nextEvent.result,
      );
      activePtyRelay = updatedState.activePtyRelay;
      activePtySession = updatedState.activePtySession;
      if (nextEvent.result.error !== undefined) {
        throw nextEvent.result.error;
      }
      continue;
    }

    const message = nextEvent.message;
    let connectRequest;
    try {
      connectRequest = parseConnectRequestMessage(message);
    } catch {
      connectRequest = undefined;
    }

    if (connectRequest !== undefined) {
      if (activeRelaysByStreamId.has(connectRequest.streamId)) {
        await writeStreamAlreadyOpenError(input.tunnelSocket, connectRequest.streamId);
        continue;
      }

      if (connectRequest.channelKind === "pty" && activePtyRelay !== undefined) {
        let ptyConnectRequest;
        try {
          ptyConnectRequest = parsePtyConnectRequest(connectRequest.rawPayload);
        } catch (error) {
          await writeStreamOpenError(input.tunnelSocket, {
            type: "stream.open.error",
            streamId: connectRequest.streamId,
            code: CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST,
            message: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        if (ptyConnectRequest.channel.kind !== "pty") {
          throw new Error("pty stream.open request channel.kind must be 'pty'");
        }

        if (ptyConnectRequest.channel.session === "attach") {
          activeRelaysByStreamId.set(connectRequest.streamId, activePtyRelay);
        }

        activePtyRelay.messages.push(message);
        continue;
      }

      switch (connectRequest.channelKind) {
        case "agent": {
          const relay = await handleAgentConnectRequest({
            signal: input.signal,
            tunnelSocket: input.tunnelSocket,
            streamId: connectRequest.streamId,
            agentRuntimes: input.agentRuntimes,
            runtimeClients: input.runtimeClients,
            executionLeases: input.executionLeases,
            relayResultQueue,
          });
          if (relay !== undefined) {
            activeRelaysByStreamId.set(connectRequest.streamId, relay);
          }
          continue;
        }
        case "pty": {
          const { ptySession, relay } = await handlePtyConnectRequest({
            signal: input.signal,
            tunnelSocket: input.tunnelSocket,
            rawPayload: connectRequest.rawPayload,
            streamId: connectRequest.streamId,
            activePtySession,
            relayResultQueue,
          });
          activePtySession = ptySession;
          if (relay !== undefined) {
            activePtyRelay = relay;
            activeRelaysByStreamId.set(connectRequest.streamId, relay);
          }
          continue;
        }
        default:
          await writeStreamOpenError(input.tunnelSocket, {
            type: "stream.open.error",
            streamId: connectRequest.streamId,
            code: CONNECT_ERROR_CODE_UNSUPPORTED_CHANNEL,
            message: `channel kind '${connectRequest.channelKind}' is not supported`,
          });
          continue;
      }
    }

    const routing = parseTunnelMessageRouting(message);
    const relay = activeRelaysByStreamId.get(routing.streamId);
    if (relay === undefined) {
      await writeUnboundStreamReset(input.tunnelSocket, routing);
      continue;
    }

    const releasePtyAttachBinding =
      routing.controlMessageType === "stream.close" &&
      relay.channelKind === "pty" &&
      routing.streamId !== relay.primaryStreamId;

    relay.messages.push(message);
    if (releasePtyAttachBinding) {
      activeRelaysByStreamId.delete(routing.streamId);
    }
  }
}

async function runTunnelClientLoop(input: {
  signal: AbortSignal;
  gatewayWsUrl: string;
  tokens: TunnelTokens;
  agentRuntimes: ReadonlyArray<CompiledAgentRuntime>;
  runtimeClients: ReadonlyArray<CompiledRuntimeClient>;
}): Promise<void> {
  const executionLeases = new ExecutionLeaseEngine();

  void runTunnelTokenExchangeLoop({
    signal: input.signal,
    gatewayWsUrl: input.gatewayWsUrl,
    tokens: input.tokens,
  }).catch(() => undefined);

  for (let dialAttempt = 1; !input.signal.aborted; dialAttempt += 1) {
    if (dialAttempt > 1) {
      try {
        await exchangeTunnelTokensNow(input.gatewayWsUrl, input.tokens);
      } catch (error) {
        logSandboxRuntimeEvent({
          level: "warn",
          event: "sandbox_tunnel_token_exchange_before_redial_failed",
          fields: {
            dialAttempt,
            message: error instanceof Error ? error.message : describeUnknownError(error),
          },
        });
        await waitForReconnect(input.signal, nextTunnelReconnectDelay());
        continue;
      }
    }

    let tunnelSocket: WebSocket;
    try {
      logSandboxRuntimeEvent({
        level: "info",
        event: "sandbox_tunnel_connect_attempt_started",
        fields: {
          dialAttempt,
        },
      });
      const parsedUrl = parseGatewayUrl(input.gatewayWsUrl);
      parsedUrl.searchParams.set("bootstrap_token", input.tokens.currentBootstrapToken());
      tunnelSocket = await connectWebSocket(parsedUrl.toString(), input.signal);
      logSandboxRuntimeEvent({
        level: "info",
        event: "sandbox_tunnel_connect_attempt_succeeded",
        fields: {
          dialAttempt,
        },
      });
    } catch (error) {
      logSandboxRuntimeEvent({
        level: "warn",
        event: "sandbox_tunnel_connect_attempt_failed",
        fields: {
          dialAttempt,
          retryDelayMs: nextTunnelReconnectDelay(),
          message: error instanceof Error ? error.message : describeUnknownError(error),
        },
      });
      await waitForReconnect(input.signal, nextTunnelReconnectDelay());
      continue;
    }

    executionLeases.attachTunnelConnection(tunnelSocket);

    let connectionError: unknown;
    try {
      await handleTunnelConnection({
        signal: input.signal,
        tunnelSocket,
        executionLeases,
        agentRuntimes: input.agentRuntimes,
        runtimeClients: input.runtimeClients,
      });
    } catch (error) {
      connectionError = error;
    } finally {
      executionLeases.detachTunnelConnection(tunnelSocket);
      await closeWebSocket(tunnelSocket).catch(() => undefined);
    }

    if (input.signal.aborted) {
      return;
    }
    if (connectionError === undefined) {
      logSandboxRuntimeEvent({
        level: "info",
        event: "sandbox_tunnel_connection_closed_cleanly",
        fields: {
          dialAttempt,
        },
      });
      return;
    }
    if (!(connectionError instanceof Error)) {
      throw new Error(describeUnknownError(connectionError));
    }

    logSandboxRuntimeEvent({
      level: "warn",
      event: "sandbox_tunnel_connection_lost",
      fields: {
        dialAttempt,
        retryDelayMs: nextTunnelReconnectDelay(),
        message: connectionError.message,
      },
    });
    await waitForReconnect(input.signal, nextTunnelReconnectDelay());
    continue;
  }
}

export function startTunnelClient(input: StartTunnelClientInput): StartedTunnelClient {
  parseGatewayUrl(input.gatewayWsUrl);
  const tokens = new TunnelTokens(
    normalizeBootstrapToken(input.bootstrapToken),
    input.tunnelExchangeToken,
  );

  const controller = new AbortController();
  const abortListener = (): void => {
    controller.abort(input.signal.reason);
  };
  input.signal.addEventListener("abort", abortListener, { once: true });

  const runPromise = runTunnelClientLoop({
    signal: controller.signal,
    gatewayWsUrl: input.gatewayWsUrl,
    tokens,
    agentRuntimes: input.agentRuntimes,
    runtimeClients: input.runtimeClients,
  });

  const completion = runPromise
    .then(
      (): TunnelCompletion =>
        controller.signal.aborted
          ? {
              kind: "aborted",
            }
          : {
              kind: "closed",
            },
    )
    .catch(
      (error: unknown): TunnelCompletion => ({
        kind: "error",
        error: error instanceof Error ? error : new Error(String(error)),
      }),
    )
    .finally(() => {
      input.signal.removeEventListener("abort", abortListener);
    });

  return {
    close: async () => {
      controller.abort();
      await runPromise.catch(() => undefined);
    },
    closed: runPromise.then(() => undefined).catch(() => undefined),
    completion,
  };
}
