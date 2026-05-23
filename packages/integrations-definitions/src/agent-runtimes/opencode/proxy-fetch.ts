import type { AgentConversationIdempotencyMetadata } from "@mistle/integrations-core";
import type {
  SandboxSessionStream,
  SandboxSessionStreamEvent,
  SandboxSessionTransport,
} from "@mistle/sandbox-session-client";
import { PayloadKindWebSocketText, type StreamDataFrame } from "@mistle/sandbox-session-protocol";

export const OpenCodeProxyIdempotencyHeader = "x-mistle-idempotency";

type OpenCodeProxyRequest = {
  id: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
  idempotency?: AgentConversationIdempotencyMetadata;
};

type OpenCodeProxyResponseFrame = {
  id: string;
  type: "response";
  status: number;
  headers: Record<string, string>;
  body: string;
};

type OpenCodeProxySseFrame = {
  id: string;
  type: "sse";
  event?: string;
  data: string;
};

type OpenCodeProxyCompleteFrame = {
  id: string;
  type: "complete";
};

type OpenCodeProxyFrame =
  | OpenCodeProxyCompleteFrame
  | OpenCodeProxyResponseFrame
  | OpenCodeProxySseFrame;

export type OpenCodeProxyFetchInput = {
  transport: SandboxSessionTransport;
};

type OpenCodeProxyFetchRequestState = {
  cleanup: () => void;
  requestId: string;
  requestSignal: AbortSignal | null;
  stream: SandboxSessionStream;
};

let nextRequestId = 0;

function createRequestId(): string {
  nextRequestId += 1;
  return `opencode_proxy_request_${String(nextRequestId)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProxyFrame(input: { payload: Uint8Array; requestId: string }): OpenCodeProxyFrame {
  const payloadText = new TextDecoder().decode(input.payload);
  const parsedPayload: unknown = JSON.parse(payloadText);
  if (!isRecord(parsedPayload)) {
    throw new Error("OpenCode proxy frame must be a JSON object.");
  }
  if (parsedPayload.id !== input.requestId) {
    throw new Error(
      `OpenCode proxy frame id '${String(parsedPayload.id)}' did not match request id '${input.requestId}'.`,
    );
  }
  if (parsedPayload.type === "response") {
    if (typeof parsedPayload.status !== "number") {
      throw new Error("OpenCode proxy response frame must include numeric status.");
    }
    if (!isRecord(parsedPayload.headers)) {
      throw new Error("OpenCode proxy response frame must include object headers.");
    }
    if (typeof parsedPayload.body !== "string") {
      throw new Error("OpenCode proxy response frame must include string body.");
    }
    return {
      id: input.requestId,
      type: "response",
      status: parsedPayload.status,
      headers: Object.fromEntries(
        Object.entries(parsedPayload.headers).map(([key, value]) => [key, String(value)]),
      ),
      body: parsedPayload.body,
    };
  }
  if (parsedPayload.type === "sse") {
    if (typeof parsedPayload.data !== "string") {
      throw new Error("OpenCode proxy SSE frame must include string data.");
    }
    return {
      id: input.requestId,
      type: "sse",
      data: parsedPayload.data,
      ...("event" in parsedPayload && typeof parsedPayload.event === "string"
        ? { event: parsedPayload.event }
        : {}),
    };
  }
  if (parsedPayload.type === "complete") {
    return {
      id: input.requestId,
      type: "complete",
    };
  }

  throw new Error(`OpenCode proxy frame type '${String(parsedPayload.type)}' is not supported.`);
}

function getRequestPath(request: Request): string {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

function readIdempotencyMetadata(value: string): AgentConversationIdempotencyMetadata {
  const parsedValue: unknown = JSON.parse(value);
  if (!isRecord(parsedValue)) {
    throw new Error("OpenCode proxy idempotency metadata must be a JSON object.");
  }
  if (typeof parsedValue.key !== "string") {
    throw new Error("OpenCode proxy idempotency metadata must include string key.");
  }
  if (parsedValue.operation !== "createConversation" && parsedValue.operation !== "submitPayload") {
    throw new Error(
      "OpenCode proxy idempotency metadata operation must be createConversation or submitPayload.",
    );
  }
  if (typeof parsedValue.requestFingerprint !== "string") {
    throw new Error("OpenCode proxy idempotency metadata must include string requestFingerprint.");
  }
  return {
    key: parsedValue.key,
    operation: parsedValue.operation,
    requestFingerprint: parsedValue.requestFingerprint,
  };
}

function getRequestIdempotency(request: Request): AgentConversationIdempotencyMetadata | undefined {
  const headerValue = request.headers.get(OpenCodeProxyIdempotencyHeader);
  return headerValue === null ? undefined : readIdempotencyMetadata(headerValue);
}

function getRequestHeaders(request: Request): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (key.toLowerCase() === OpenCodeProxyIdempotencyHeader) {
      return;
    }
    headers[key] = value;
  });
  return Object.keys(headers).length === 0 ? undefined : headers;
}

async function getRequestBody(request: Request): Promise<unknown> {
  const bodyText = await request.text();
  if (bodyText.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(bodyText);
  } catch (error) {
    throw new Error(
      `OpenCode proxy fetch only supports JSON request bodies. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function createProxyRequest(input: {
  body: unknown;
  request: Request;
  requestId: string;
}): OpenCodeProxyRequest {
  const headers = getRequestHeaders(input.request);
  const proxyRequest: OpenCodeProxyRequest = {
    id: input.requestId,
    method: input.request.method,
    path: getRequestPath(input.request),
  };
  if (headers !== undefined) {
    proxyRequest.headers = headers;
  }
  const idempotency = getRequestIdempotency(input.request);
  if (idempotency !== undefined) {
    proxyRequest.idempotency = idempotency;
  }
  if (input.body !== undefined) {
    proxyRequest.body = input.body;
  }
  return proxyRequest;
}

function isEventStreamResponse(frame: OpenCodeProxyResponseFrame): boolean {
  for (const [key, value] of Object.entries(frame.headers)) {
    if (key.toLowerCase() === "content-type" && value.toLowerCase().includes("text/event-stream")) {
      return true;
    }
  }
  return false;
}

function encodeSseFrame(frame: OpenCodeProxySseFrame): Uint8Array {
  const lines: string[] = [];
  if (frame.event !== undefined) {
    lines.push(`event: ${frame.event}`);
  }
  for (const line of frame.data.split("\n")) {
    lines.push(`data: ${line}`);
  }
  lines.push("");
  lines.push("");
  return new TextEncoder().encode(lines.join("\n"));
}

async function closeStream(stream: SandboxSessionStream): Promise<void> {
  try {
    if (stream.state === "open") {
      await stream.sendControl({
        type: "stream.close",
      });
    }
  } catch {
    // The request has already been resolved or rejected by the caller. Disposal
    // is still required so the local listener set is released.
  } finally {
    stream.dispose();
  }
}

function createAbortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("OpenCode proxy fetch aborted.", "AbortError");
  }
  const error = new Error("OpenCode proxy fetch aborted.");
  error.name = "AbortError";
  return error;
}

function createStateError(event: Extract<SandboxSessionStreamEvent, { type: "state_changed" }>) {
  return new Error(
    `OpenCode proxy stream entered state '${event.state}'${
      event.errorMessage === null ? "" : `: ${event.errorMessage}`
    }`,
  );
}

async function sendProxyRequest(input: {
  proxyRequest: OpenCodeProxyRequest;
  stream: SandboxSessionStream;
}): Promise<void> {
  await input.stream.sendDataFrame({
    payloadKind: PayloadKindWebSocketText,
    payload: new TextEncoder().encode(JSON.stringify(input.proxyRequest)),
  });
}

function createSseResponse(input: {
  frame: OpenCodeProxyResponseFrame;
  state: OpenCodeProxyFetchRequestState;
}): Response {
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  let didClose = false;
  let didReceiveCompleteBeforeStart = false;
  const queuedChunks: Uint8Array[] = [];
  let unsubscribeSseEvents = (): void => {};

  const cleanup = (): void => {
    if (didClose) {
      return;
    }
    didClose = true;
    input.state.cleanup();
    void closeStream(input.state.stream);
  };

  const abortHandler = (): void => {
    controllerRef?.error(createAbortError());
    cleanup();
  };

  input.state.requestSignal?.addEventListener("abort", abortHandler, {
    once: true,
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      for (const chunk of queuedChunks) {
        controller.enqueue(chunk);
      }
      queuedChunks.length = 0;
      if (didReceiveCompleteBeforeStart) {
        controller.close();
        cleanup();
      }
    },
    cancel() {
      input.state.requestSignal?.removeEventListener("abort", abortHandler);
      cleanup();
    },
  });

  const previousCleanup = input.state.cleanup;
  input.state.cleanup = (): void => {
    input.state.requestSignal?.removeEventListener("abort", abortHandler);
    unsubscribeSseEvents();
    previousCleanup();
  };

  unsubscribeSseEvents = input.state.stream.onEvent((event) => {
    if (didClose) {
      return;
    }
    if (event.type === "data") {
      const frame = parseProxyDataFrame({
        frame: event.frame,
        requestId: input.state.requestId,
      });
      if (frame.type === "sse") {
        const encodedFrame = encodeSseFrame(frame);
        if (controllerRef === null) {
          queuedChunks.push(encodedFrame);
          return;
        }
        controllerRef.enqueue(encodedFrame);
        return;
      }
      if (frame.type === "complete") {
        if (controllerRef === null) {
          didReceiveCompleteBeforeStart = true;
          return;
        }
        controllerRef.close();
        cleanup();
        return;
      }
      return;
    }
    if (
      event.type === "state_changed" &&
      (event.state === "closed" || event.state === "reset" || event.state === "transport_closed")
    ) {
      if (controllerRef === null) {
        return;
      }
      controllerRef.error(createStateError(event));
      cleanup();
    }
  });

  return new Response(stream, {
    status: input.frame.status,
    headers: input.frame.headers,
  });
}

function parseProxyDataFrame(input: {
  frame: StreamDataFrame;
  requestId: string;
}): OpenCodeProxyFrame {
  if (input.frame.payloadKind !== PayloadKindWebSocketText) {
    throw new Error(
      `OpenCode proxy frame payload kind '${String(input.frame.payloadKind)}' is not supported.`,
    );
  }
  return parseProxyFrame({
    payload: input.frame.payload,
    requestId: input.requestId,
  });
}

async function waitForInitialResponse(input: {
  requestSignal: AbortSignal | null;
  requestId: string;
  stream: SandboxSessionStream;
}): Promise<Response> {
  return await new Promise<Response>((resolve, reject) => {
    let settled = false;
    let unsubscribe = (): void => {};

    const settle = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      input.requestSignal?.removeEventListener("abort", abortHandler);
      callback();
    };

    const cleanup = (): void => {
      unsubscribe();
    };

    const state: OpenCodeProxyFetchRequestState = {
      cleanup,
      requestId: input.requestId,
      requestSignal: input.requestSignal,
      stream: input.stream,
    };

    const abortHandler = (): void => {
      settle(() => {
        cleanup();
        void closeStream(input.stream);
        reject(createAbortError());
      });
    };

    input.requestSignal?.addEventListener("abort", abortHandler, {
      once: true,
    });

    unsubscribe = input.stream.onEvent((event) => {
      if (event.type === "data") {
        try {
          const frame = parseProxyDataFrame({
            frame: event.frame,
            requestId: input.requestId,
          });
          if (frame.type !== "response") {
            throw new Error(
              `OpenCode proxy expected initial response frame, received '${frame.type}'.`,
            );
          }

          if (isEventStreamResponse(frame)) {
            settle(() => {
              cleanup();
              state.cleanup = (): void => {};
              resolve(
                createSseResponse({
                  frame,
                  state,
                }),
              );
            });
            return;
          }

          settle(() => {
            cleanup();
            void closeStream(input.stream);
            resolve(
              new Response(frame.status === 204 ? null : frame.body, {
                status: frame.status,
                headers: frame.headers,
              }),
            );
          });
        } catch (error) {
          settle(() => {
            cleanup();
            void closeStream(input.stream);
            reject(error);
          });
        }
        return;
      }

      if (
        event.type === "state_changed" &&
        (event.state === "closed" || event.state === "reset" || event.state === "transport_closed")
      ) {
        settle(() => {
          cleanup();
          void closeStream(input.stream);
          reject(createStateError(event));
        });
      }
    });

    if (input.requestSignal?.aborted === true) {
      abortHandler();
    }
  });
}

export function createOpenCodeProxyFetch(input: OpenCodeProxyFetchInput): typeof fetch {
  return async (requestInfo, requestInit) => {
    const request = new Request(requestInfo, requestInit);
    const requestId = createRequestId();
    const body = await getRequestBody(request.clone());
    const proxyRequest = createProxyRequest({
      body,
      request,
      requestId,
    });
    const stream = await input.transport.openStream({
      channel: {
        kind: "agent",
      },
    });

    await sendProxyRequest({
      proxyRequest,
      stream,
    });

    return await waitForInitialResponse({
      requestId,
      requestSignal: request.signal,
      stream,
    });
  };
}
