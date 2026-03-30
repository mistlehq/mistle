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
  createFileUploadObservabilityContext,
  logFileUploadTerminalEvent,
} from "./file-upload-observability.js";
import {
  CONNECT_ERROR_CODE_INVALID_CONNECT_REQUEST,
  writeStreamComplete,
  STREAM_RESET_CODE_INVALID_STREAM_DATA,
  writeStreamEvent,
  writeStreamOpenError,
  writeStreamOpenOk,
  writeStreamReset,
  writeStreamWindow,
} from "./messages.js";
import { resolveImageExtension } from "./resolve-image-extension.js";
import { assertSafeUploadThreadId, deriveUploadThreadDirectoryPath } from "./upload-thread-path.js";
import { validateUploadedImage } from "./validate-uploaded-image.js";

const MaxUploadSizeBytes = 10 * 1024 * 1024;

function assertUploadMetadata(input: { mimeType: string; sizeBytes: number }): void {
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
  const baseLogContext = createFileUploadObservabilityContext({
    declaredMimeType: input.mimeType,
    declaredSizeBytes: input.sizeBytes,
    receivedBytes: 0,
    streamId: input.streamId,
    threadId: input.threadId,
  });
  let fileHandle: Awaited<ReturnType<typeof open>> | undefined;
  let tempPath: string | undefined;
  let receivedBytes = 0;
  let didPersistFinalFile = false;
  let didLogTerminalOutcome = false;

  const createLogContext = () => ({
    ...baseLogContext,
    receivedBytes,
  });
  const logTerminalOutcome: typeof logFileUploadTerminalEvent = (terminalInput) => {
    logFileUploadTerminalEvent(terminalInput);
    didLogTerminalOutcome = true;
  };
  const rejectUpload = async (reset: { code: string; message: string }): Promise<void> => {
    await writeStreamReset(input.tunnelSocket, {
      type: "stream.reset",
      streamId: input.streamId,
      code: reset.code,
      message: reset.message,
    });
    logTerminalOutcome({
      context: createLogContext(),
      outcome: {
        kind: "rejected",
        code: reset.code,
      },
    });
  };
  const interruptUpload = (reason: string): void => {
    logTerminalOutcome({
      context: createLogContext(),
      outcome: {
        kind: "interrupted",
        reason,
      },
    });
  };
  const failUpload = (errorMessage: string): void => {
    logTerminalOutcome({
      context: createLogContext(),
      outcome: {
        kind: "failed",
        errorMessage,
        failureClass: classifyUploadMetadataError(errorMessage),
      },
    });
  };

  try {
    assertUploadMetadata(input);
    const safeThreadId = assertSafeUploadThreadId(input.threadId);

    const extension = resolveImageExtension(input.mimeType);
    const threadDirectoryPath = deriveUploadThreadDirectoryPath({
      attachmentRootPath: input.attachmentRootPath,
      threadId: safeThreadId,
    });

    const baseFilename = randomUUID();
    tempPath = join(threadDirectoryPath, `.upload-${baseFilename}.part`);
    const finalPath = join(threadDirectoryPath, `${baseFilename}.${extension}`);
    if (
      !isPathWithinRoot({
        candidatePath: threadDirectoryPath,
        rootPath: input.attachmentRootPath,
      })
    ) {
      throw new Error("Upload thread directory escaped the attachment root.");
    }
    if (
      !isPathWithinRoot({
        candidatePath: finalPath,
        rootPath: input.attachmentRootPath,
      })
    ) {
      throw new Error("Final upload path escaped the attachment root.");
    }
    await mkdir(threadDirectoryPath, { recursive: true });

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
          await rejectUpload({
            code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
            message: `stream data frame streamId ${String(dataFrame.streamId)} does not match active upload stream ${String(input.streamId)}`,
          });
          return;
        }
        if (dataFrame.payloadKind !== PayloadKindRawBytes) {
          await rejectUpload({
            code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
            message: "file upload stream only accepts raw byte payloads",
          });
          return;
        }

        receivedBytes += dataFrame.payload.byteLength;
        if (receivedBytes > input.sizeBytes) {
          await rejectUpload({
            code: FileUploadResetCodes.BYTE_COUNT_EXCEEDED,
            message: "Received more bytes than declared by the upload metadata.",
          });
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
        await rejectUpload({
          code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
          message: "file upload stream only accepts stream.close after open",
        });
        return;
      }

      const closeMessage = parseStreamCloseMessage(message.payload);
      if (closeMessage.streamId !== input.streamId) {
        await rejectUpload({
          code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
          message: `stream.close streamId ${String(closeMessage.streamId)} does not match active upload stream ${String(input.streamId)}`,
        });
        return;
      }

      if (receivedBytes !== input.sizeBytes) {
        await rejectUpload({
          code: FileUploadResetCodes.BYTE_COUNT_MISMATCH,
          message: "Uploaded byte count did not match declared size.",
        });
        return;
      }

      await fileHandle.close();
      const validationResult = await validateUploadedImage({
        declaredMimeType: input.mimeType,
        tempPath,
      });
      if (!validationResult.ok) {
        await rejectUpload({
          code: validationResult.code,
          message: validationResult.message,
        });
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
      await writeStreamComplete(input.tunnelSocket, {
        type: "stream.complete",
        streamId: input.streamId,
      });
      logTerminalOutcome({
        context: createLogContext(),
        outcome: {
          kind: "completed",
          attachmentId,
        },
      });
      return;
    }
    interruptUpload("upload signal aborted before stream completion");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    failUpload(errorMessage);
    throw error;
  } finally {
    await fileHandle?.close().catch(() => undefined);
    if (!didPersistFinalFile) {
      await rm(tempPath ?? "", { force: true }).catch(() => undefined);
    }
    if (!didLogTerminalOutcome && input.signal.aborted) {
      interruptUpload("upload signal aborted during cleanup");
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

  const logContext = createFileUploadObservabilityContext({
    declaredMimeType: connectRequest.channel.mimeType,
    declaredSizeBytes: connectRequest.channel.sizeBytes,
    receivedBytes: 0,
    streamId: input.streamId,
    threadId: connectRequest.channel.threadId,
  });
  const rejectUploadOpen = async (errorMessage: string): Promise<void> => {
    logFileUploadTerminalEvent({
      context: logContext,
      outcome: {
        kind: "rejected",
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
  };

  try {
    assertUploadMetadata({
      mimeType: connectRequest.channel.mimeType,
      sizeBytes: connectRequest.channel.sizeBytes,
    });
    assertSafeUploadThreadId(connectRequest.channel.threadId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await rejectUploadOpen(errorMessage);
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
