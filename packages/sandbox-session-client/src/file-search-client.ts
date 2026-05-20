import {
  parseFileSearchStreamMessage,
  PayloadKindWebSocketText,
  type FileSearchError,
  type FileSearchQuery,
  type FileSearchResultItem,
  type FileSearchResults,
  type FileSearchSelect,
  type StreamDataFrame,
} from "@mistle/sandbox-session-protocol";

import { SandboxSessionSocketReadyStates } from "./runtime.js";
import { type SandboxSessionStream, type SandboxSessionTransport } from "./transport.js";

export type FileSearchStreamClientInput = {
  transport: SandboxSessionTransport;
};

export type FileSearchStreamSessionInput = {
  cwd: string;
};

export type FileSearchQueryInput = {
  query: string;
  limit?: number;
};

export type FileSearchSelectInput = {
  path: string;
  query: string;
};

export type FileSearchStreamSessionEvent =
  | {
      type: "results";
      results: FileSearchResults;
    }
  | {
      type: "error";
      error: FileSearchError;
    }
  | {
      type: "closed";
      message: string | null;
    };

type FileSearchStreamSessionListener = (event: FileSearchStreamSessionEvent) => void;

const TextDecoderInstance = new TextDecoder();
const TextEncoderInstance = new TextEncoder();

export class FileSearchStreamSession {
  readonly #listeners = new Set<FileSearchStreamSessionListener>();
  readonly #stream: SandboxSessionStream;
  readonly #unsubscribeStreamEvents: () => void;
  #nextRequestNumber = 1;

  constructor(input: { stream: SandboxSessionStream }) {
    this.#stream = input.stream;
    this.#unsubscribeStreamEvents = input.stream.onEvent((event) => {
      if (event.type === "data") {
        this.#handleDataFrame(event.frame);
        return;
      }

      if (event.type !== "state_changed") {
        return;
      }

      if (
        event.state === "closed" ||
        event.state === "reset" ||
        event.state === "transport_closed"
      ) {
        this.#emit({
          type: "closed",
          message: event.errorMessage,
        });
      }
    });
  }

  onEvent(listener: FileSearchStreamSessionListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async query(input: FileSearchQueryInput): Promise<string> {
    const requestId = `file-search-${String(this.#nextRequestNumber)}`;
    this.#nextRequestNumber += 1;

    await this.#sendJson({
      type: "fileSearch.query",
      requestId,
      query: input.query,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });

    return requestId;
  }

  async select(input: FileSearchSelectInput): Promise<void> {
    await this.#sendJson({
      type: "fileSearch.select",
      query: input.query,
      path: input.path,
    });
  }

  dispose(): void {
    if (this.#stream.state === "open") {
      void this.#stream.sendControl({ type: "stream.close" }).catch(() => {
        return;
      });
    }
    this.#unsubscribeStreamEvents();
    this.#listeners.clear();
    this.#stream.dispose();
  }

  async #sendJson(payload: FileSearchQuery | FileSearchSelect): Promise<void> {
    await this.#stream.sendDataFrame({
      payload: TextEncoderInstance.encode(JSON.stringify(payload)),
      payloadKind: PayloadKindWebSocketText,
    });
  }

  #handleDataFrame(frame: StreamDataFrame): void {
    if (frame.payloadKind !== PayloadKindWebSocketText) {
      return;
    }

    const message = parseFileSearchStreamMessage(TextDecoderInstance.decode(frame.payload));
    if (message === undefined) {
      return;
    }

    if (message.type === "fileSearch.results") {
      this.#emit({
        type: "results",
        results: message,
      });
      return;
    }

    if (message.type === "fileSearch.error") {
      this.#emit({
        type: "error",
        error: message,
      });
    }
  }

  #emit(event: FileSearchStreamSessionEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }
}

export class FileSearchStreamClient {
  readonly #transport: SandboxSessionTransport;

  constructor(input: FileSearchStreamClientInput) {
    this.#transport = input.transport;
  }

  async openSession(input: FileSearchStreamSessionInput): Promise<FileSearchStreamSession> {
    if (this.#transport.readyState !== SandboxSessionSocketReadyStates.OPEN) {
      throw new Error("Sandbox session socket is not open.");
    }

    const stream = await this.#transport.openStream({
      channel: {
        kind: "fileSearch",
        cwd: input.cwd,
      },
    });

    return new FileSearchStreamSession({ stream });
  }
}

export type { FileSearchResultItem };
