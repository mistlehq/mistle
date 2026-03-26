import {
  DefaultStreamWindowBytes,
  encodeDataFrame,
  FileUploadResetCodes,
  parseStreamControlMessage,
  PayloadKindRawBytes,
  type FileUploadCompletedEvent,
  type StreamControlMessage,
  type StreamOpen,
} from "@mistle/sandbox-session-protocol";

import {
  SandboxSessionSocketReadyStates,
  type SandboxSessionRuntime,
  type SandboxSessionSocket,
} from "./runtime.js";

const UploadIdleTimeoutMs = 15_000;
const UploadChunkSizeBytes = 64 * 1024;

export type UploadSandboxImageInput = {
  connectionUrl: string;
  file: File;
  runtime: SandboxSessionRuntime;
  threadId: string;
};

export type UploadedSandboxImage = {
  attachmentId: string;
  threadId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  path: string;
};

export { FileUploadResetCodes };

export class FileUploadRejectedError extends Error {
  readonly code: string;

  constructor(input: { code: string; message: string }) {
    super(input.message);
    this.code = input.code;
    this.name = "FileUploadRejectedError";
  }
}

type QueuedControlMessage =
  | {
      kind: "message";
      message: StreamControlMessage;
    }
  | {
      kind: "error";
      error: Error;
    };

type PendingControlMessageWaiter = {
  resolve: (message: StreamControlMessage) => void;
  reject: (error: Error) => void;
  predicate: (message: StreamControlMessage) => boolean;
};

type ControlMessagePump = {
  queue: QueuedControlMessage[];
  waiters: PendingControlMessageWaiter[];
};

function readMessageEventPayload(event: unknown): unknown {
  if (typeof event === "object" && event !== null && "data" in event) {
    return event.data;
  }

  return event;
}

function readTextPayload(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function createUploadOpenMessage(input: {
  file: File;
  streamId: number;
  threadId: string;
}): StreamOpen {
  return {
    type: "stream.open",
    streamId: input.streamId,
    channel: {
      kind: "fileUpload",
      mimeType: input.file.type,
      originalFilename: input.file.name,
      sizeBytes: input.file.size,
      threadId: input.threadId,
    },
  };
}

function normalizeCompletionEvent(event: FileUploadCompletedEvent): UploadedSandboxImage {
  return {
    attachmentId: event.attachmentId,
    threadId: event.threadId,
    originalFilename: event.originalFilename,
    mimeType: event.mimeType,
    sizeBytes: event.sizeBytes,
    path: event.path,
  };
}

function toFileUploadError(input: { code: string; message: string }): Error {
  return new FileUploadRejectedError(input);
}

function getMessagePump(socket: SandboxSessionSocket): ControlMessagePump {
  const queue: QueuedControlMessage[] = [];
  const waiters: PendingControlMessageWaiter[] = [];

  function drain(): void {
    let queueIndex = 0;
    while (queueIndex < queue.length && waiters.length > 0) {
      const queued = queue[queueIndex];
      if (queued === undefined) {
        return;
      }

      if (queued.kind === "error") {
        queue.splice(queueIndex, 1);
        const waiter = waiters.shift();
        waiter?.reject(queued.error);
        continue;
      }

      const waiterIndex = waiters.findIndex((waiter) => {
        return queued.message !== undefined && waiter.predicate(queued.message);
      });
      if (waiterIndex < 0) {
        queueIndex += 1;
        continue;
      }

      const [waiter] = waiters.splice(waiterIndex, 1);
      queue.splice(queueIndex, 1);
      if (waiter !== undefined && queued.message !== undefined) {
        waiter.resolve(queued.message);
      }
    }
  }

  socket.addEventListener("message", (event) => {
    const payload = readTextPayload(readMessageEventPayload(event));
    if (payload === null) {
      return;
    }

    const controlMessage = parseStreamControlMessage(payload);
    if (controlMessage === undefined) {
      return;
    }

    queue.push({
      kind: "message",
      message: controlMessage,
    });
    drain();
  });
  socket.addEventListener("error", () => {
    queue.push({
      kind: "error",
      error: new Error("Sandbox websocket connection failed."),
    });
    drain();
  });
  socket.addEventListener("close", () => {
    queue.push({
      kind: "error",
      error: new Error("Sandbox websocket connection closed unexpectedly."),
    });
    drain();
  });

  return {
    queue,
    waiters,
  };
}

async function waitForControlMessage(input: {
  pump: ControlMessagePump;
  predicate: (message: StreamControlMessage) => boolean;
  runtime: SandboxSessionRuntime;
  timeoutMs: number;
  timeoutMessage: string;
}): Promise<StreamControlMessage> {
  const queuedError = input.pump.queue.find((queued): queued is { kind: "error"; error: Error } => {
    return queued.kind === "error";
  });
  if (queuedError !== undefined) {
    throw queuedError.error;
  }

  const queuedMessage = input.pump.queue.find(
    (
      queued,
    ): queued is {
      kind: "message";
      message: StreamControlMessage;
    } => {
      return queued.kind === "message" && input.predicate(queued.message);
    },
  );
  if (queuedMessage !== undefined) {
    input.pump.queue.splice(input.pump.queue.indexOf(queuedMessage), 1);
    return queuedMessage.message;
  }

  return await new Promise((resolve, reject) => {
    const timeoutTask = input.runtime.scheduleTimeout(() => {
      const waiterIndex = input.pump.waiters.indexOf(waiter);
      if (waiterIndex >= 0) {
        input.pump.waiters.splice(waiterIndex, 1);
      }
      reject(new Error(input.timeoutMessage));
    }, input.timeoutMs);

    const waiter: PendingControlMessageWaiter = {
      predicate: input.predicate,
      reject: (error) => {
        timeoutTask.cancel();
        reject(error);
      },
      resolve: (message) => {
        timeoutTask.cancel();
        resolve(message);
      },
    };

    input.pump.waiters.push(waiter);
  });
}

export async function uploadSandboxImage(
  input: UploadSandboxImageInput,
): Promise<UploadedSandboxImage> {
  const socket = input.runtime.createSocket(input.connectionUrl);
  const messagePump = getMessagePump(socket);
  const streamId = input.runtime.createStreamId();
  let availableWindowBytes = 0;
  let completedUpload: UploadedSandboxImage | null = null;

  try {
    await new Promise<void>((resolve, reject) => {
      const handleOpen = (): void => {
        cleanup();
        resolve();
      };
      const handleError = (): void => {
        cleanup();
        reject(new Error("Sandbox websocket connection failed."));
      };
      const handleClose = (): void => {
        cleanup();
        reject(new Error("Sandbox websocket connection closed before upload stream was ready."));
      };
      const cleanup = (): void => {
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
        socket.removeEventListener("close", handleClose);
      };

      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);
      socket.addEventListener("close", handleClose);
    });

    await socket.send(JSON.stringify(createUploadOpenMessage({ ...input, streamId })));

    const openResponse = await waitForControlMessage({
      pump: messagePump,
      predicate: (message) => {
        return (
          message.streamId === streamId &&
          (message.type === "stream.open.ok" || message.type === "stream.open.error")
        );
      },
      runtime: input.runtime,
      timeoutMs: UploadIdleTimeoutMs,
      timeoutMessage: "Timed out while waiting for upload stream to open.",
    });
    if (openResponse.type === "stream.open.error") {
      throw new Error(openResponse.message);
    }

    availableWindowBytes = DefaultStreamWindowBytes;

    let offset = 0;
    while (offset < input.file.size) {
      if (socket.readyState !== SandboxSessionSocketReadyStates.OPEN) {
        throw new Error("Sandbox session socket is not open.");
      }
      if (availableWindowBytes === 0) {
        const nextControlMessage = await waitForControlMessage({
          pump: messagePump,
          predicate: (message) => {
            return (
              message.streamId === streamId &&
              (message.type === "stream.window" ||
                message.type === "stream.reset" ||
                (message.type === "stream.event" && message.event.type === "fileUpload.completed"))
            );
          },
          runtime: input.runtime,
          timeoutMs: UploadIdleTimeoutMs,
          timeoutMessage: "Timed out while waiting for upload progress.",
        });
        if (nextControlMessage.type === "stream.window") {
          availableWindowBytes += nextControlMessage.bytes;
        } else if (nextControlMessage.type === "stream.reset") {
          throw toFileUploadError({
            code: nextControlMessage.code,
            message: nextControlMessage.message,
          });
        } else if (
          nextControlMessage.type === "stream.event" &&
          nextControlMessage.event.type === "fileUpload.completed"
        ) {
          completedUpload = normalizeCompletionEvent(nextControlMessage.event);
        }
      }

      const nextOffset = Math.min(
        input.file.size,
        offset + Math.min(UploadChunkSizeBytes, availableWindowBytes),
      );
      const chunkBytes = new Uint8Array(await input.file.slice(offset, nextOffset).arrayBuffer());
      availableWindowBytes -= chunkBytes.byteLength;
      await socket.send(
        encodeDataFrame({
          streamId,
          payloadKind: PayloadKindRawBytes,
          payload: chunkBytes,
        }),
      );
      offset = nextOffset;
    }

    await socket.send(
      JSON.stringify({
        type: "stream.close",
        streamId,
      }),
    );

    if (completedUpload !== null) {
      socket.close(1000, "Upload completed.");
      return completedUpload;
    }

    const uploadResultMessage = await waitForControlMessage({
      pump: messagePump,
      predicate: (message) => {
        return (
          message.streamId === streamId &&
          ((message.type === "stream.event" && message.event.type === "fileUpload.completed") ||
            message.type === "stream.reset")
        );
      },
      runtime: input.runtime,
      timeoutMs: UploadIdleTimeoutMs,
      timeoutMessage: "Timed out while waiting for upload completion.",
    });
    if (uploadResultMessage.type === "stream.reset") {
      throw toFileUploadError({
        code: uploadResultMessage.code,
        message: uploadResultMessage.message,
      });
    }
    if (
      uploadResultMessage.type !== "stream.event" ||
      uploadResultMessage.event.type !== "fileUpload.completed"
    ) {
      throw new Error("Expected file upload completion event after closing upload stream.");
    }

    const uploadResult = normalizeCompletionEvent(uploadResultMessage.event);

    socket.close(1000, "Upload completed.");
    return uploadResult;
  } catch (error) {
    socket.close(1000, "Upload aborted.");
    throw error;
  }
}
