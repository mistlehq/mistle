import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  decodeDataFrame,
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
  streamId: number;
  threadId: string;
  tunnelSocket: WebSocket;
}): Promise<void> {
  assertUploadMetadata(input);

  const extension = resolveImageExtension(input.mimeType);
  const attachmentId = `att_${randomUUID()}`;
  const threadDirectoryPath = join(input.attachmentRootPath, input.threadId);
  await mkdir(threadDirectoryPath, { recursive: true });

  const baseFilename = randomUUID();
  const tempPath = join(threadDirectoryPath, `.upload-${baseFilename}.part`);
  const finalPath = join(threadDirectoryPath, `${baseFilename}.${extension}`);
  if (
    !isPathWithinRoot({
      candidatePath: finalPath,
      rootPath: input.attachmentRootPath,
    })
  ) {
    throw new Error("Final upload path escaped the attachment root.");
  }

  const fileHandle = await open(tempPath, "w");
  let receivedBytes = 0;
  let didPersistFinalFile = false;

  try {
    await writeStreamOpenOk(input.tunnelSocket, {
      type: "stream.open.ok",
      streamId: input.streamId,
    });

    while (true) {
      const message = await input.messages.next();

      if (message.kind === "binary") {
        const dataFrame = decodeDataFrame(message.payload);
        if (dataFrame.streamId !== input.streamId) {
          await writeStreamReset(input.tunnelSocket, {
            type: "stream.reset",
            streamId: input.streamId,
            code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
            message: `stream data frame streamId ${String(dataFrame.streamId)} does not match active upload stream ${String(input.streamId)}`,
          });
          return;
        }
        if (dataFrame.payloadKind !== PayloadKindRawBytes) {
          await writeStreamReset(input.tunnelSocket, {
            type: "stream.reset",
            streamId: input.streamId,
            code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
            message: "file upload stream only accepts raw byte payloads",
          });
          return;
        }

        receivedBytes += dataFrame.payload.byteLength;
        if (receivedBytes > input.sizeBytes) {
          await writeStreamReset(input.tunnelSocket, {
            type: "stream.reset",
            streamId: input.streamId,
            code: "byte_count_exceeded",
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
        await writeStreamReset(input.tunnelSocket, {
          type: "stream.reset",
          streamId: input.streamId,
          code: STREAM_RESET_CODE_INVALID_STREAM_DATA,
          message: "file upload stream only accepts stream.close after open",
        });
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
        return;
      }

      if (receivedBytes !== input.sizeBytes) {
        await writeStreamReset(input.tunnelSocket, {
          type: "stream.reset",
          streamId: input.streamId,
          code: "byte_count_mismatch",
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
        await writeStreamReset(input.tunnelSocket, {
          type: "stream.reset",
          streamId: input.streamId,
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
      return;
    }
  } finally {
    await fileHandle.close().catch(() => undefined);
    if (!didPersistFinalFile) {
      await rm(tempPath, { force: true }).catch(() => undefined);
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
