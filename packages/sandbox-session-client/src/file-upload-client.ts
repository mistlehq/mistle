import {
  FileUploadResetCodes,
  PayloadKindRawBytes,
  type FileUploadCompletedEvent,
  type StreamControlMessage,
} from "@mistle/sandbox-session-protocol";
import { systemScheduler } from "@mistle/time";

import { SandboxSessionSocketReadyStates } from "./runtime.js";
import {
  type SandboxSessionStream,
  type SandboxSessionStreamEvent,
  type SandboxSessionTransport,
} from "./transport.js";

const UploadIdleTimeoutMs = 15_000;
const UploadChunkSizeBytes = 64 * 1024;

export type UploadStreamClientInput = {
  idleTimeoutMs?: number;
  transport: SandboxSessionTransport;
};

const DefaultBrowserFileMimeType = "application/octet-stream";

export type UploadFileInput = {
  file: File;
  threadId: string;
};

export type UploadedSandboxFile = {
  attachmentId: string;
  kind: FileUploadCompletedEvent["kind"];
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

const UploadTimeoutRuntime = {
  scheduleTimeout(callback: () => void, delayMs: number): { cancel: () => void } {
    const handle = systemScheduler.schedule(callback, delayMs);
    return {
      cancel: () => {
        systemScheduler.cancel(handle);
      },
    };
  },
};

function normalizeCompletionEvent(event: FileUploadCompletedEvent): UploadedSandboxFile {
  return {
    attachmentId: event.attachmentId,
    kind: event.kind,
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

function isFileUploadCompletedEvent(message: StreamControlMessage): message is Extract<
  StreamControlMessage,
  { type: "stream.event" }
> & {
  event: FileUploadCompletedEvent;
} {
  return message.type === "stream.event" && message.event.type === "fileUpload.completed";
}

function normalizeBrowserFileMimeType(mimeType: string): string {
  return mimeType.trim() === "" ? DefaultBrowserFileMimeType : mimeType;
}

function getStreamMessagePump(stream: SandboxSessionStream): {
  pump: ControlMessagePump;
  unsubscribe: () => void;
} {
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
        return waiter.predicate(queued.message);
      });
      if (waiterIndex < 0) {
        queueIndex += 1;
        continue;
      }

      const [waiter] = waiters.splice(waiterIndex, 1);
      queue.splice(queueIndex, 1);
      waiter?.resolve(queued.message);
    }
  }

  const unsubscribe = stream.onEvent((event: SandboxSessionStreamEvent) => {
    if (event.type === "control") {
      queue.push({
        kind: "message",
        message: event.message,
      });
      drain();
      return;
    }

    if (event.type !== "state_changed") {
      return;
    }

    if (event.state === "transport_closed") {
      queue.push({
        kind: "error",
        error: new Error(event.errorMessage ?? "Sandbox websocket connection closed unexpectedly."),
      });
      drain();
      return;
    }

    if (event.state === "reset") {
      queue.push({
        kind: "error",
        error: new Error(event.errorMessage ?? "Sandbox upload stream reset unexpectedly."),
      });
      drain();
    }
  });

  return {
    pump: {
      queue,
      waiters,
    },
    unsubscribe,
  };
}

async function waitForControlMessage(input: {
  pump: ControlMessagePump;
  predicate: (message: StreamControlMessage) => boolean;
  runtime: {
    scheduleTimeout: (callback: () => void, delayMs: number) => { cancel: () => void };
  };
  timeoutMs: number;
  timeoutMessage: string;
}): Promise<StreamControlMessage> {
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

  const queuedError = input.pump.queue.find((queued): queued is { kind: "error"; error: Error } => {
    return queued.kind === "error";
  });
  if (queuedError !== undefined) {
    throw queuedError.error;
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

export class UploadStreamClient {
  readonly #idleTimeoutMs: number;
  readonly #transport: SandboxSessionTransport;

  constructor(input: UploadStreamClientInput) {
    this.#transport = input.transport;
    this.#idleTimeoutMs = input.idleTimeoutMs ?? UploadIdleTimeoutMs;
  }

  async uploadFile(input: UploadFileInput): Promise<UploadedSandboxFile> {
    if (this.#transport.readyState !== SandboxSessionSocketReadyStates.OPEN) {
      throw new Error("Sandbox session socket is not open.");
    }

    const stream = await this.#transport.openStream({
      channel: {
        kind: "fileUpload",
        mimeType: normalizeBrowserFileMimeType(input.file.type),
        originalFilename: input.file.name,
        sizeBytes: input.file.size,
        threadId: input.threadId,
      },
    });
    const { pump, unsubscribe } = getStreamMessagePump(stream);
    let completedUpload: UploadedSandboxFile | null = null;

    try {
      let offset = 0;
      while (offset < input.file.size) {
        const nextOffset = Math.min(input.file.size, offset + UploadChunkSizeBytes);
        const chunkBytes = new Uint8Array(await input.file.slice(offset, nextOffset).arrayBuffer());
        await stream.sendDataFrame({
          payloadKind: PayloadKindRawBytes,
          payload: chunkBytes,
        });
        offset = nextOffset;
      }

      await stream.sendControl({
        type: "stream.close",
      });

      while (true) {
        const uploadResultMessage = await waitForControlMessage({
          pump,
          predicate: (message) => {
            return (
              message.streamId === stream.streamId &&
              (isFileUploadCompletedEvent(message) ||
                message.type === "stream.complete" ||
                message.type === "stream.reset")
            );
          },
          runtime: UploadTimeoutRuntime,
          timeoutMs: this.#idleTimeoutMs,
          timeoutMessage: "Timed out while waiting for upload completion.",
        });
        if (uploadResultMessage.type === "stream.reset") {
          throw toFileUploadError({
            code: uploadResultMessage.code,
            message: uploadResultMessage.message,
          });
        }
        if (uploadResultMessage.type === "stream.complete") {
          if (completedUpload === null) {
            throw new Error("Received stream.complete before file upload completion event.");
          }

          return completedUpload;
        }
        if (!isFileUploadCompletedEvent(uploadResultMessage)) {
          throw new Error("Expected file upload completion event before stream completion.");
        }

        completedUpload = normalizeCompletionEvent(uploadResultMessage.event);
      }
    } finally {
      unsubscribe();
      stream.dispose();
    }
  }

  async uploadImage(input: UploadFileInput): Promise<UploadedSandboxFile> {
    return await this.uploadFile(input);
  }
}
