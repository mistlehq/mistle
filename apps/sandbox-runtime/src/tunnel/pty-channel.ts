import {
  decodeDataFrame,
  PayloadKindRawBytes,
  type StreamOpen,
} from "@mistle/sandbox-session-protocol";
import type WebSocket from "ws";

import { createAbortRace, ignorePromiseRejectionAfterAbort } from "./abortable-race.js";
import type { ActiveTunnelStreamRelay, ActiveTunnelStreamRelayResult } from "./active-relay.js";
import { AsyncQueue } from "./async-queue.js";
import type { TunnelSocketMessage } from "./connect-request.js";
import {
  parseControlMessageType,
  parsePtyConnectRequest,
  parsePtyResizeSignal,
  parseStreamCloseMessage,
} from "./connect-request.js";
import {
  CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST,
  CONNECT_ERROR_CODE_PTY_SESSION_CREATE_FAILED,
  CONNECT_ERROR_CODE_PTY_SESSION_EXISTS,
  CONNECT_ERROR_CODE_PTY_SESSION_UNAVAILABLE,
  STREAM_RESET_CODE_INVALID_STREAM_CLOSE,
  STREAM_RESET_CODE_INVALID_STREAM_DATA,
  STREAM_RESET_CODE_INVALID_STREAM_SIGNAL,
  STREAM_RESET_CODE_INVALID_STREAM_WINDOW,
  STREAM_RESET_CODE_STREAM_CLOSE_FAILED,
  STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
  createPtyExitEventMessage,
  writeBinaryDataFrame,
  writeStreamEvent,
  writeStreamOpenError,
  writeStreamOpenOk,
  writeStreamReset,
  writeStreamWindow,
} from "./messages.js";
import { PtySession, PtySessionOutputClosedError, startPtySession } from "./pty-session.js";
import { StreamSendWindow } from "./stream-window.js";

async function handlePtyControlMessage(input: {
  signal: AbortSignal;
  tunnelSocket: WebSocket;
  session: PtySession;
  primaryStreamId: number;
  attachedStreamIds: Set<number>;
  sendWindowsByStreamId: Map<number, StreamSendWindow>;
  payload: string;
}): Promise<"continue" | "detach-stream" | "close-session"> {
  const messageType = parseControlMessageType(input.payload);

  switch (messageType) {
    case "stream.open": {
      const connectRequest = parsePtyConnectRequest(input.payload);
      if (connectRequest.channel.kind !== "pty") {
        throw new Error("pty stream.open request channel.kind must be 'pty'");
      }
      if (connectRequest.channel.session === "create") {
        await writeStreamOpenError(input.tunnelSocket, {
          type: "stream.open.error",
          streamId: connectRequest.streamId,
          code: CONNECT_ERROR_CODE_PTY_SESSION_EXISTS,
          message: "pty session already exists",
        });
        return "continue";
      }

      input.attachedStreamIds.add(connectRequest.streamId);
      input.sendWindowsByStreamId.set(connectRequest.streamId, new StreamSendWindow());
      await writeStreamOpenOk(input.tunnelSocket, {
        type: "stream.open.ok",
        streamId: connectRequest.streamId,
      });
      return "continue";
    }
    case "stream.signal": {
      const signalMessage = parsePtyResizeSignal(input.payload);
      if (!input.attachedStreamIds.has(signalMessage.streamId)) {
        await writeStreamReset(input.tunnelSocket, {
          type: "stream.reset",
          streamId: signalMessage.streamId,
          code: STREAM_RESET_CODE_INVALID_STREAM_SIGNAL,
          message: `stream signal streamId ${String(signalMessage.streamId)} is not attached to the active PTY session`,
        });
        return "close-session";
      }

      input.session.resize(signalMessage.signal.cols, signalMessage.signal.rows);
      return "continue";
    }
    case "stream.close": {
      const closeMessage = parseStreamCloseMessage(input.payload);
      if (!input.attachedStreamIds.has(closeMessage.streamId)) {
        await writeStreamReset(input.tunnelSocket, {
          type: "stream.reset",
          streamId: closeMessage.streamId,
          code: STREAM_RESET_CODE_INVALID_STREAM_CLOSE,
          message: `stream close streamId ${String(closeMessage.streamId)} is not attached to the active PTY session`,
        });
        return "close-session";
      }
      if (closeMessage.streamId !== input.primaryStreamId) {
        input.attachedStreamIds.delete(closeMessage.streamId);
        input.sendWindowsByStreamId.delete(closeMessage.streamId);
        return "detach-stream";
      }

      let exitCode: number;
      try {
        exitCode = await input.session.terminate();
      } catch (error) {
        await writeStreamReset(input.tunnelSocket, {
          type: "stream.reset",
          streamId: input.primaryStreamId,
          code: STREAM_RESET_CODE_STREAM_CLOSE_FAILED,
          message: error instanceof Error ? error.message : String(error),
        });
        return "close-session";
      }

      for (const attachedStreamId of input.attachedStreamIds) {
        await writeStreamEvent(
          input.tunnelSocket,
          createPtyExitEventMessage(attachedStreamId, exitCode),
        );
      }
      return "close-session";
    }
    default:
      throw new Error(`unsupported pty control message type '${messageType}'`);
  }
}

async function relayPtySession(input: {
  signal: AbortSignal;
  tunnelSocket: WebSocket;
  session: PtySession;
  primaryStreamId: number;
  messages: AsyncQueue<TunnelSocketMessage>;
}): Promise<PtySession | undefined> {
  const attachedStreamIds = new Set<number>([input.primaryStreamId]);
  const sendWindowsByStreamId = new Map<number, StreamSendWindow>([
    [input.primaryStreamId, new StreamSendWindow()],
  ]);
  const exitPromise = input.session.waitForExit();
  let pendingExitCode: number | undefined;

  while (!input.signal.aborted) {
    const nextMessageAbortController = new AbortController();
    const nextOutputAbortController = new AbortController();
    const abortRace = createAbortRace(input.signal);
    const nextExit =
      pendingExitCode === undefined
        ? exitPromise.then((exitCode) => ({
            source: "exit" as const,
            exitCode,
          }))
        : new Promise<never>(() => undefined);

    let event:
      | {
          source: "message";
          message: TunnelSocketMessage;
        }
      | {
          source: "output";
          output: Uint8Array;
        }
      | {
          source: "output-closed";
        }
      | {
          source: "exit";
          exitCode: number;
        };

    try {
      const nextMessage = ignorePromiseRejectionAfterAbort(
        input.messages.next(nextMessageAbortController.signal).then((message) => ({
          source: "message" as const,
          message,
        })),
        nextMessageAbortController.signal,
      );
      const nextOutput = ignorePromiseRejectionAfterAbort(
        input.session
          .nextOutput(nextOutputAbortController.signal)
          .then((output) => ({
            source: "output" as const,
            output,
          }))
          .catch((error: unknown) => {
            if (error instanceof PtySessionOutputClosedError) {
              return {
                source: "output-closed" as const,
              };
            }

            throw error;
          }),
        nextOutputAbortController.signal,
      );

      event = await Promise.race([nextMessage, nextOutput, nextExit, abortRace.promise]);
    } finally {
      abortRace.dispose();
      nextMessageAbortController.abort();
      nextOutputAbortController.abort();
    }

    if (event.source === "output") {
      for (const attachedStreamId of attachedStreamIds) {
        const sendWindow = sendWindowsByStreamId.get(attachedStreamId);
        if (sendWindow === undefined) {
          continue;
        }
        if (!sendWindow.tryConsume(event.output.length)) {
          await writeStreamReset(input.tunnelSocket, {
            type: "stream.reset",
            streamId: attachedStreamId,
            code: STREAM_RESET_CODE_STREAM_WINDOW_EXHAUSTED,
            message: "pty stream send window is exhausted",
          });
          attachedStreamIds.delete(attachedStreamId);
          sendWindowsByStreamId.delete(attachedStreamId);
          if (attachedStreamId === input.primaryStreamId) {
            await input.session.terminate().catch(() => undefined);
            return undefined;
          }
          continue;
        }

        await writeBinaryDataFrame(input.tunnelSocket, {
          streamId: attachedStreamId,
          payloadKind: PayloadKindRawBytes,
          payload: event.output,
        });
      }
      continue;
    }

    if (event.source === "output-closed") {
      const exitCode = pendingExitCode ?? (await exitPromise);
      for (const attachedStreamId of attachedStreamIds) {
        await writeStreamEvent(
          input.tunnelSocket,
          createPtyExitEventMessage(attachedStreamId, exitCode),
        );
      }
      return undefined;
    }

    if (event.source === "exit") {
      pendingExitCode = event.exitCode;
      continue;
    }

    const message = event.message;
    if (message.kind === "binary") {
      let dataFrame;
      try {
        dataFrame = decodeDataFrame(message.payload);
      } catch (error) {
        await writeStreamReset(input.tunnelSocket, {
          type: "stream.reset",
          streamId: input.primaryStreamId,
          code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
          message: error instanceof Error ? error.message : String(error),
        });
        return input.session;
      }

      if (!attachedStreamIds.has(dataFrame.streamId)) {
        await writeStreamReset(input.tunnelSocket, {
          type: "stream.reset",
          streamId: dataFrame.streamId,
          code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
          message: `stream data frame streamId ${String(dataFrame.streamId)} is not attached to the active PTY session`,
        });
        return input.session;
      }
      if (dataFrame.payloadKind !== PayloadKindRawBytes) {
        await writeStreamReset(input.tunnelSocket, {
          type: "stream.reset",
          streamId: input.primaryStreamId,
          code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
          message: `pty stream payloadKind ${String(dataFrame.payloadKind)} is not supported`,
        });
        return input.session;
      }

      input.session.write(dataFrame.payload);
      await writeStreamWindow(input.tunnelSocket, {
        type: "stream.window",
        streamId: dataFrame.streamId,
        bytes: dataFrame.payload.length,
      });
      continue;
    }

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
      const sendWindow = sendWindowsByStreamId.get(streamId);
      if (sendWindow === undefined) {
        await writeStreamReset(input.tunnelSocket, {
          type: "stream.reset",
          streamId,
          code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
          message: `stream.window streamId ${String(streamId)} is not attached to the active PTY session`,
        });
        return input.session;
      }
      try {
        sendWindow.add(bytes);
      } catch (error) {
        await writeStreamReset(input.tunnelSocket, {
          type: "stream.reset",
          streamId,
          code: STREAM_RESET_CODE_INVALID_STREAM_WINDOW,
          message: error instanceof Error ? error.message : String(error),
        });
        if (streamId !== input.primaryStreamId) {
          attachedStreamIds.delete(streamId);
          sendWindowsByStreamId.delete(streamId);
          continue;
        }
        return input.session;
      }
      continue;
    }

    const controlAction = await handlePtyControlMessage({
      signal: input.signal,
      tunnelSocket: input.tunnelSocket,
      session: input.session,
      primaryStreamId: input.primaryStreamId,
      attachedStreamIds,
      sendWindowsByStreamId,
      payload: message.payload,
    });
    if (controlAction === "close-session") {
      return input.session.isExited() ? undefined : input.session;
    }
  }

  return input.session;
}

export async function handlePtyConnectRequest(input: {
  signal: AbortSignal;
  tunnelSocket: WebSocket;
  rawPayload: string;
  streamId: number;
  activePtySession: PtySession | undefined;
  relayResultQueue: AsyncQueue<ActiveTunnelStreamRelayResult>;
}): Promise<{
  ptySession?: PtySession;
  relay?: ActiveTunnelStreamRelay;
}> {
  let connectRequest: StreamOpen;
  try {
    connectRequest = parsePtyConnectRequest(input.rawPayload);
  } catch (error) {
    await writeStreamOpenError(input.tunnelSocket, {
      type: "stream.open.error",
      streamId: input.streamId,
      code: CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST,
      message: error instanceof Error ? error.message : String(error),
    });
    if (input.activePtySession === undefined) {
      return {};
    }

    return { ptySession: input.activePtySession };
  }

  if (connectRequest.channel.kind !== "pty") {
    throw new Error("pty stream.open request channel.kind must be 'pty'");
  }

  let activePtySession = input.activePtySession;
  if (connectRequest.channel.session === "create") {
    if (activePtySession !== undefined && !activePtySession.isExited()) {
      await writeStreamOpenError(input.tunnelSocket, {
        type: "stream.open.error",
        streamId: input.streamId,
        code: CONNECT_ERROR_CODE_PTY_SESSION_EXISTS,
        message: "pty session already exists",
      });
      if (activePtySession === undefined) {
        return {};
      }

      return { ptySession: activePtySession };
    }

    try {
      activePtySession = startPtySession(connectRequest);
    } catch (error) {
      await writeStreamOpenError(input.tunnelSocket, {
        type: "stream.open.error",
        streamId: input.streamId,
        code: CONNECT_ERROR_CODE_PTY_SESSION_CREATE_FAILED,
        message: error instanceof Error ? error.message : String(error),
      });
      if (input.activePtySession === undefined) {
        return {};
      }

      return { ptySession: input.activePtySession };
    }
  }

  if (activePtySession === undefined || activePtySession.isExited()) {
    await writeStreamOpenError(input.tunnelSocket, {
      type: "stream.open.error",
      streamId: input.streamId,
      code: CONNECT_ERROR_CODE_PTY_SESSION_UNAVAILABLE,
      message: "pty session is not available",
    });
    if (activePtySession === undefined) {
      return {};
    }

    return { ptySession: activePtySession };
  }

  await writeStreamOpenOk(input.tunnelSocket, {
    type: "stream.open.ok",
    streamId: input.streamId,
  });

  const relay: ActiveTunnelStreamRelay = {
    primaryStreamId: input.streamId,
    channelKind: "pty",
    messages: new AsyncQueue<TunnelSocketMessage>(),
  };

  void relayPtySession({
    signal: input.signal,
    tunnelSocket: input.tunnelSocket,
    session: activePtySession,
    primaryStreamId: input.streamId,
    messages: relay.messages,
  })
    .then((ptySession) => {
      input.relayResultQueue.push({
        relay,
        ptySession,
        updatesPtySession: true,
      });
    })
    .catch((error: unknown) => {
      input.relayResultQueue.push({
        relay,
        error: error instanceof Error ? error : new Error(String(error)),
        ptySession: activePtySession,
        updatesPtySession: true,
      });
    });

  if (activePtySession === undefined) {
    return { relay };
  }

  return {
    ptySession: activePtySession,
    relay,
  };
}
