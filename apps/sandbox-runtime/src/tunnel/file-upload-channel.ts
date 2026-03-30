import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  decodeDataFrame,
  FileUploadResetCodes,
  PayloadKindRawBytes,
  type StreamEventMessage,
} from "@mistle/sandbox-session-protocol";
import type WebSocket from "ws";

import type { ActiveTunnelStreamRelay, ActiveTunnelStreamRelayResult } from "./active-relay.js";
import { AsyncQueue } from "./async-queue.js";
import {
  parseControlMessageType,
  parseFileUploadConnectRequest,
  parseStreamCloseMessage,
  type TunnelSocketMessage,
} from "./connect-request.js";
import {
  classifyUploadMetadataError,
  logFileUploadTerminalEvent,
} from "./file-upload-observability.js";
import {
  CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST,
  STREAM_RESET_CODE_INVALID_STREAM_DATA,
  writeStreamEvent,
  writeStreamOpenError,
  writeStreamOpenOk,
  writeStreamReset,
  writeStreamWindow,
} from "./messages.js";
import { resolveImageExtension } from "./resolve-image-extension.js";
import { validateUploadedImage } from "./validate-uploaded-image.js";

const MaxUploadSizeBytes = 10 * 1024 * 1024;

function assertUploadMetadata(input: {
  mimeType: string;
  sizeBytes: number;
  threadId: string;
}): void {
  if (input.threadId.trim().length === 0) {
    throw new Error("threadId is required.");
  }
  if (input.sizeBytes <= 0) {
    throw new Error("sizeBytes must be greater than 0.");
  }
  if (input.sizeBytes > MaxUploadSizeBytes) {
    throw new Error("sizeBytes exceeds the configured upload limit.");
  }
  resolveImageExtension(input.mimeType);
}

function isPathWithinRoot(input: { candidatePath: string; rootPath: string }): boolean {
  const normalizedRootPath = resolve(input.rootPath);
  const normalizedCandidatePath = resolve(input.candidatePath);
  return (
    normalizedCandidatePath === normalizedRootPath ||
    normalizedCandidatePath.startsWith(`${normalizedRootPath}/`)
  );
}

export async function handleFileUploadStream(input: {
  attachmentRootPath: string;
  messages: AsyncQueue<TunnelSocketMessage>;
  mimeType: string;
  originalFilename: string;
  sizeBytes: number;
  signal: AbortSignal;
  streamId: number;
  threadId: string;
  tunnelSocket: WebSocket;
}): Promise<void> {
  const logContext = {
    declaredMimeType: input.mimeType,
    declaredSizeBytes: input.sizeBytes,
    receivedBytes: 0,
    streamId: input.streamId,
    threadId: input.threadId,
  };
  let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
  let tempPath: string | undefined;
  let receivedBytes = 0;
  let didPersistFinalFile = false;
  let didLogTerminalOutcome = false;

  try {
    assertUploadMetadata(input);

    const extension = resolveImageExtension(input.mimeType);
    const threadDirectoryPath = join(input.attachmentRootPath, input.threadId);
    await mkdir(threadDirectoryPath, { recursive: true });

    const baseFilename = randomUUID();
    tempPath = join(threadDirectoryPath, `.upload-${baseFilename}.part`);
    const finalPath = join(threadDirectoryPath, `${baseFilename}.${extension}`);
    if (
      !isPathWithinRoot({
        candidatePath: finalPath,
        rootPath: input.attachmentRootPath,
      })
    ) {
      throw new Error("Final upload path escaped the attachment root.");
    }

    fileHandle = await open(tempPath, "w");
    const attachmentId = `att_${randomUUID()}`;

    await writeStreamOpenOk(input.tunnelSocket, {
      type: "stream.open.ok",
      streamId: input.streamId,
    });

    while (!input.signal.aborted) {
      let message: TunnelSocketMessage;
      try {
        message = await input.messages.next(input.signal);
      } catch (error) {
        if (input.signal.aborted) {
          return;
        }

        throw error;
      }

      if (message.kind === "binary") {
        const dataFrame = decodeDataFrame(message.payload);
        if (dataFrame.streamId !== input.streamId) {
          await writeStreamReset(input.tunnelSocket, {
            type: "stream.reset",
            streamId: input.streamId,
            code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
            message: `stream data frame streamId ${String(dataFrame.streamId)} does not match active upload stream ${String(input.streamId)}`,
          });
          logFileUploadTerminalEvent({
            context: {
              ...logContext,
              receivedBytes,
            },
            outcome: {
              kind: "rejected",
              code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
            },
          });
          didLogTerminalOutcome = true;
          return;
        }
        if (dataFrame.payloadKind !== PayloadKindRawBytes) {
          await writeStreamReset(input.tunnelSocket, {
            type: "stream.reset",
            streamId: input.streamId,
            code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
            message: "file upload stream only accepts raw byte payloads",
          });
          logFileUploadTerminalEvent({
            context: {
              ...logContext,
              receivedBytes,
            },
            outcome: {
              kind: "rejected",
              code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
            },
          });
          didLogTerminalOutcome = true;
          return;
        }

        receivedBytes += dataFrame.payload.byteLength;
        if (receivedBytes > input.sizeBytes) {
          await writeStreamReset(input.tunnelSocket, {
            type: "stream.reset",
            streamId: input.streamId,
            code: FileUploadResetCodes.BYTE_COUNT_EXCEEDED,
            message: "Received more bytes than declared by the upload metadata.",
          });
          logFileUploadTerminalEvent({
            context: {
              ...logContext,
              receivedBytes,
            },
            outcome: {
              kind: "rejected",
              code: FileUploadResetCodes.BYTE_COUNT_EXCEEDED,
            },
          });
          didLogTerminalOutcome = true;
          return;
        }

        await fileHandle.write(dataFrame.payload);
        await writeStreamWindow(input.tunnelSocket, {
          type: "stream.window",
          streamId: input.streamId,
          bytes: dataFrame.payload.byteLength,
        });
        continue;
      }

      const controlMessageType = parseControlMessageType(message.payload);
      if (controlMessageType !== "stream.close") {
        await writeStreamReset(input.tunnelSocket, {
          type: "stream.reset",
          streamId: input.streamId,
          code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
          message: "file upload stream only accepts stream.close after open",
        });
        logFileUploadTerminalEvent({
          context: {
            ...logContext,
            receivedBytes,
          },
          outcome: {
            kind: "rejected",
            code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
          },
        });
        didLogTerminalOutcome = true;
        return;
      }

      const closeMessage = parseStreamCloseMessage(message.payload);
      if (closeMessage.streamId !== input.streamId) {
        await writeStreamReset(input.tunnelSocket, {
          type: "stream.reset",
          streamId: input.streamId,
          code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
          message: `stream.close streamId ${String(closeMessage.streamId)} does not match active upload stream ${String(input.streamId)}`,
        });
        logFileUploadTerminalEvent({
          context: {
            ...logContext,
            receivedBytes,
          },
          outcome: {
            kind: "rejected",
            code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
          },
        });
        didLogTerminalOutcome = true;
        return;
      }

      if (receivedBytes !== input.sizeBytes) {
        await writeStreamReset(input.tunnelSocket, {
          type: "stream.reset",
          streamId: input.streamId,
          code: FileUploadResetCodes.BYTE_COUNT_MISMATCH,
          message: "Uploaded byte count did not match declared size.",
        });
        logFileUploadTerminalEvent({
          context: {
            ...logContext,
            receivedBytes,
          },
          outcome: {
            kind: "rejected",
            code: FileUploadResetCodes.BYTE_COUNT_MISMATCH,
          },
        });
        didLogTerminalOutcome = true;
        return;
      }

      await fileHandle.close();
      const validationResult = await validateUploadedImage({
        declaredMimeType: input.mimeType,
        tempPath,
      });
      if (!validationResult.ok) {
        await writeStreamReset(input.tunnelSocket, {
          type: "stream.reset",
          streamId: input.streamId,
          code: validationResult.code,
          message: validationResult.message,
        });
        logFileUploadTerminalEvent({
          context: {
            ...logContext,
            receivedBytes,
          },
          outcome: {
            kind: "rejected",
            code: validationResult.code,
          },
        });
        didLogTerminalOutcome = true;
        return;
      }

      await rename(tempPath, finalPath);
      didPersistFinalFile = true;

      const completionEvent: StreamEventMessage = {
        type: "stream.event",
        streamId: input.streamId,
        event: {
          type: "fileUpload.completed",
          attachmentId,
          mimeType: input.mimeType,
          originalFilename: input.originalFilename,
          path: finalPath,
          sizeBytes: input.sizeBytes,
          threadId: input.threadId,
        },
      };
      await writeStreamEvent(input.tunnelSocket, completionEvent);
      logFileUploadTerminalEvent({
        context: {
          ...logContext,
          receivedBytes,
        },
        outcome: {
          kind: "completed",
          attachmentId,
        },
      });
      didLogTerminalOutcome = true;
      return;
    }
    logFileUploadTerminalEvent({
      context: {
        ...logContext,
        receivedBytes,
      },
      outcome: {
        kind: "interrupted",
        reason: "upload signal aborted before stream completion",
      },
    });
    didLogTerminalOutcome = true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logFileUploadTerminalEvent({
      context: {
        ...logContext,
        receivedBytes,
      },
      outcome: {
        kind: "failed",
        errorMessage,
        failureClass: classifyUploadMetadataError(errorMessage),
      },
    });
    didLogTerminalOutcome = true;
    throw error;
  } finally {
    await fileHandle?.close().catch(() => undefined);
    if (!didPersistFinalFile) {
      await rm(tempPath ?? "", { force: true }).catch(() => undefined);
    }
    if (!didLogTerminalOutcome && input.signal.aborted) {
      logFileUploadTerminalEvent({
        context: {
          ...logContext,
          receivedBytes,
        },
        outcome: {
          kind: "interrupted",
          reason: "upload signal aborted during cleanup",
        },
      });
    }
  }
}

export async function handleFileUploadConnectRequest(input: {
  signal: AbortSignal;
  tunnelSocket: WebSocket;
  rawPayload: string;
  streamId: number;
  relayResultQueue: AsyncQueue<ActiveTunnelStreamRelayResult>;
  attachmentRootPath?: string;
}): Promise<ActiveTunnelStreamRelay | undefined> {
  let connectRequest;
  try {
    connectRequest = parseFileUploadConnectRequest(input.rawPayload);
  } catch (error) {
    await writeStreamOpenError(input.tunnelSocket, {
      type: "stream.open.error",
      streamId: input.streamId,
      code: CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST,
      message: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }

  if (connectRequest.channel.kind !== "fileUpload") {
    throw new Error("file upload stream.open request channel.kind must be 'fileUpload'");
  }

  try {
    assertUploadMetadata({
      mimeType: connectRequest.channel.mimeType,
      sizeBytes: connectRequest.channel.sizeBytes,
      threadId: connectRequest.channel.threadId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logFileUploadTerminalEvent({
      context: {
        declaredMimeType: connectRequest.channel.mimeType,
        declaredSizeBytes: connectRequest.channel.sizeBytes,
        receivedBytes: 0,
        streamId: input.streamId,
        threadId: connectRequest.channel.threadId,
      },
      outcome: {
        kind: "failed",
        errorMessage,
        failureClass: classifyUploadMetadataError(errorMessage),
      },
    });
    await writeStreamOpenError(input.tunnelSocket, {
      type: "stream.open.error",
      streamId: input.streamId,
      code: CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST,
      message: errorMessage,
    });
    return undefined;
  }

  const relay: ActiveTunnelStreamRelay = {
    primaryStreamId: input.streamId,
    channelKind: "fileUpload",
    messages: new AsyncQueue<TunnelSocketMessage>(),
  };

  void handleFileUploadStream({
    attachmentRootPath: input.attachmentRootPath ?? "/tmp/attachments",
    messages: relay.messages,
    mimeType: connectRequest.channel.mimeType,
    originalFilename: connectRequest.channel.originalFilename,
    sizeBytes: connectRequest.channel.sizeBytes,
    signal: input.signal,
    streamId: input.streamId,
    threadId: connectRequest.channel.threadId,
    tunnelSocket: input.tunnelSocket,
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
