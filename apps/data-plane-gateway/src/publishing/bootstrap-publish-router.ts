import type { WSContext } from "hono/ws";
import type WebSocket from "ws";

import type { TunnelRelayCoordinator } from "../tunnel/relay-coordinator.js";
import type { TunnelSessionRegistry } from "../tunnel/tunnel-session/index.js";
import { type RelayPayload } from "../tunnel/types.js";

const PublishHttpChunkSizeBytes = 32 * 1024;
const MaxBufferedPublishBytesPerStream = 512 * 1024;

const HopByHopHeaderNames = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const PublishedTargetSessionCookieName = "mistle_published_target_session";

type HeaderMap = Record<string, string[]>;

type ResponseStart = {
  headers: HeaderMap;
  status: number;
};

type PendingResponseEvent =
  | {
      kind: "chunk";
      bytes: Uint8Array;
    }
  | {
      kind: "end";
    };

type PendingWebSocketEvent =
  | {
      kind: "close";
      code?: number;
      reason?: string;
      abrupt: boolean;
    }
  | {
      kind: "frame";
      bytes: Uint8Array;
      opcode: "binary" | "text";
    };

class AsyncQueue<T> {
  readonly #items: T[] = [];
  readonly #waiters: Array<{
    reject: (error: unknown) => void;
    resolve: (value: T) => void;
  }> = [];
  #closedError: unknown;

  public push(item: T): void {
    if (this.#closedError !== undefined) {
      return;
    }

    const waiter = this.#waiters.shift();
    if (waiter !== undefined) {
      waiter.resolve(item);
      return;
    }

    this.#items.push(item);
  }

  public fail(error: unknown): void {
    if (this.#closedError !== undefined) {
      return;
    }

    this.#closedError = error;
    while (this.#waiters.length > 0) {
      this.#waiters.shift()?.reject(error);
    }
  }

  public async next(): Promise<T> {
    if (this.#items.length > 0) {
      const item = this.#items.shift();
      if (item === undefined) {
        throw new Error("queue item is required");
      }

      return item;
    }

    if (this.#closedError !== undefined) {
      throw this.#closedError;
    }

    return new Promise<T>((resolve, reject) => {
      this.#waiters.push({
        reject,
        resolve,
      });
    });
  }
}

export class PublishedHttpRequestError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PublishedHttpRequestError";
  }
}

function encodeBodyChunk(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function decodeBodyChunk(bytes: string): Uint8Array {
  return new Uint8Array(Buffer.from(bytes, "base64"));
}

function createPayload(message: object): RelayPayload {
  return JSON.stringify(message);
}

function readHeaderMap(value: unknown): HeaderMap | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const headerMap: HeaderMap = {};
  for (const [name, entryValue] of Object.entries(value)) {
    if (!Array.isArray(entryValue) || entryValue.some((item) => typeof item !== "string")) {
      return undefined;
    }

    headerMap[name] = entryValue;
  }

  return headerMap;
}

function createEmptyResponseBodyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

function isBodyAllowedForMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

function inferForwardedPort(url: URL): string {
  if (url.port.length > 0) {
    return url.port;
  }

  return url.protocol === "https:" ? "443" : "80";
}

function createForwardedCookieHeader(cookieHeader: string | null): string | undefined {
  if (cookieHeader === null) {
    return undefined;
  }

  const filteredSegments = cookieHeader
    .split(";")
    .map((segment) => segment.trim())
    .filter((segment) => {
      if (segment.length === 0) {
        return false;
      }

      const separatorIndex = segment.indexOf("=");
      if (separatorIndex <= 0) {
        return false;
      }

      return segment.slice(0, separatorIndex).trim() !== PublishedTargetSessionCookieName;
    });

  if (filteredSegments.length === 0) {
    return undefined;
  }

  return filteredSegments.join("; ");
}

function appendHeaderValue(headers: HeaderMap, name: string, value: string): void {
  const normalizedName = name.toLowerCase();
  const existingValues = headers[normalizedName];
  if (existingValues === undefined) {
    headers[normalizedName] = [value];
    return;
  }

  existingValues.push(value);
}

function buildForwardHeaders(input: {
  host: string;
  request: Request;
  targetPort: number;
}): HeaderMap {
  const headers: HeaderMap = {};
  for (const [name, value] of input.request.headers.entries()) {
    const normalizedName = name.toLowerCase();
    if (HopByHopHeaderNames.has(normalizedName) || normalizedName === "host") {
      continue;
    }
    if (normalizedName === "cookie") {
      const forwardedCookieHeader = createForwardedCookieHeader(value);
      if (forwardedCookieHeader !== undefined) {
        appendHeaderValue(headers, normalizedName, forwardedCookieHeader);
      }
      continue;
    }

    appendHeaderValue(headers, normalizedName, value);
  }

  const requestUrl = new URL(input.request.url);
  headers.host = [`localhost:${String(input.targetPort)}`];
  headers["x-forwarded-host"] = [input.host];
  headers["x-forwarded-proto"] = [requestUrl.protocol.slice(0, -1)];
  headers["x-forwarded-port"] = [inferForwardedPort(requestUrl)];

  return headers;
}

function buildForwardWebSocketHeaders(input: {
  host: string;
  request: Request;
  targetPort: number;
}): HeaderMap {
  const headers: HeaderMap = {};
  for (const [name, value] of input.request.headers.entries()) {
    const normalizedName = name.toLowerCase();
    if (
      HopByHopHeaderNames.has(normalizedName) ||
      normalizedName === "host" ||
      normalizedName === "origin" ||
      normalizedName === "sec-websocket-accept" ||
      normalizedName === "sec-websocket-extensions" ||
      normalizedName === "sec-websocket-key" ||
      normalizedName === "sec-websocket-version"
    ) {
      continue;
    }

    if (normalizedName === "cookie") {
      const forwardedCookieHeader = createForwardedCookieHeader(value);
      if (forwardedCookieHeader !== undefined) {
        appendHeaderValue(headers, normalizedName, forwardedCookieHeader);
      }
      continue;
    }

    appendHeaderValue(headers, normalizedName, value);
  }

  const requestUrl = new URL(input.request.url);
  headers.host = [`localhost:${String(input.targetPort)}`];
  headers.origin = [`${requestUrl.protocol}//localhost:${String(input.targetPort)}`];
  headers["x-forwarded-host"] = [input.host];
  headers["x-forwarded-proto"] = [requestUrl.protocol.slice(0, -1)];
  headers["x-forwarded-port"] = [inferForwardedPort(requestUrl)];

  return headers;
}

function toResponseHeaders(headerMap: HeaderMap): Headers {
  const headers = new Headers();
  for (const [name, values] of Object.entries(headerMap)) {
    for (const value of values) {
      headers.append(name, value);
    }
  }

  return headers;
}

function chunkBytes(bytes: Uint8Array): Uint8Array[] {
  if (bytes.byteLength <= PublishHttpChunkSizeBytes) {
    return [bytes];
  }

  const chunks: Uint8Array[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    const endOffset = Math.min(offset + PublishHttpChunkSizeBytes, bytes.byteLength);
    chunks.push(bytes.subarray(offset, endOffset));
    offset = endOffset;
  }

  return chunks;
}

function isSendableWebSocketCloseCode(code: number): boolean {
  return (
    code === 1000 ||
    code === 1001 ||
    code === 1002 ||
    code === 1003 ||
    code === 1007 ||
    code === 1008 ||
    code === 1009 ||
    code === 1010 ||
    code === 1011 ||
    code === 1012 ||
    code === 1013 ||
    code === 1014 ||
    (code >= 3000 && code <= 4999)
  );
}

function decodeTextFrame(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("utf8");
}

function encodeBodyFrame(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function decodeBodyFrame(bytes: string): Uint8Array {
  return new Uint8Array(Buffer.from(bytes, "base64"));
}

function normalizeCloseReason(reason: string | undefined): string | undefined {
  if (reason === undefined || reason.length === 0) {
    return undefined;
  }

  const normalizedReason = Buffer.from(reason, "utf8").subarray(0, 123).toString("utf8");
  return normalizedReason.length === 0 ? undefined : normalizedReason;
}

class PendingHttpPublishStream {
  readonly #responseEvents = new AsyncQueue<PendingResponseEvent>();
  readonly #responseStart: Promise<ResponseStart>;
  #bufferedResponseBytes = 0;
  #ended = false;
  #released = false;
  #rejectResponseStart!: (reason: unknown) => void;
  #resolveResponseStart!: (value: ResponseStart) => void;
  #responseStarted = false;

  public constructor(
    public readonly sandboxInstanceId: string,
    public readonly streamId: number,
  ) {
    this.#responseStart = new Promise<ResponseStart>((resolve, reject) => {
      this.#resolveResponseStart = resolve;
      this.#rejectResponseStart = reject;
    });
  }

  public awaitResponseStart(): Promise<ResponseStart> {
    return this.#responseStart;
  }

  public release(): void {
    this.#released = true;
  }

  public pushResponseStart(input: ResponseStart): void {
    if (this.#released || this.#responseStarted) {
      return;
    }

    this.#responseStarted = true;
    this.#resolveResponseStart(input);
  }

  public pushResponseChunk(bytes: Uint8Array): boolean {
    if (this.#released || this.#ended) {
      return true;
    }

    if (this.#bufferedResponseBytes + bytes.byteLength > MaxBufferedPublishBytesPerStream) {
      return false;
    }

    this.#bufferedResponseBytes += bytes.byteLength;
    this.#responseEvents.push({
      kind: "chunk",
      bytes,
    });

    return true;
  }

  public pushResponseEnd(): void {
    if (this.#released || this.#ended) {
      return;
    }

    this.#ended = true;
    this.#responseEvents.push({
      kind: "end",
    });
  }

  public hasEnded(): boolean {
    return this.#ended;
  }

  public fail(error: unknown): void {
    if (this.#released) {
      return;
    }

    if (!this.#responseStarted) {
      this.#rejectResponseStart(error);
    }

    this.#responseEvents.fail(error);
  }

  public createResponseBodyStream(input: {
    onCancel: () => Promise<void>;
  }): ReadableStream<Uint8Array> {
    if (this.#ended && this.#bufferedResponseBytes === 0) {
      return createEmptyResponseBodyStream();
    }

    return new ReadableStream<Uint8Array>({
      cancel: async () => {
        await input.onCancel();
      },
      pull: async (controller) => {
        const nextEvent = await this.#responseEvents.next();
        if (nextEvent.kind === "end") {
          controller.close();
          return;
        }

        this.#bufferedResponseBytes -= nextEvent.bytes.byteLength;
        controller.enqueue(nextEvent.bytes);
      },
    });
  }
}

class PendingWebSocketPublishStream {
  readonly #pendingEvents: PendingWebSocketEvent[] = [];
  readonly #acceptPromise: Promise<void>;
  #accepted = false;
  #browserSocket: WSContext<WebSocket> | undefined;
  #released = false;
  #rejectAccept!: (reason: unknown) => void;
  #resolveAccept!: () => void;
  #terminalEvent: PendingWebSocketEvent | undefined;

  public constructor(
    public readonly sandboxInstanceId: string,
    public readonly streamId: number,
  ) {
    this.#acceptPromise = new Promise<void>((resolve, reject) => {
      this.#resolveAccept = resolve;
      this.#rejectAccept = reject;
    });
  }

  public awaitAccept(): Promise<void> {
    return this.#acceptPromise;
  }

  public accept(): void {
    if (this.#released || this.#accepted) {
      return;
    }

    this.#accepted = true;
    this.#resolveAccept();
  }

  public bindBrowserSocket(socket: WSContext<WebSocket>): void {
    if (this.#released) {
      socket.raw?.terminate();
      return;
    }

    this.#browserSocket = socket;
    while (this.#pendingEvents.length > 0) {
      const nextEvent = this.#pendingEvents.shift();
      if (nextEvent === undefined) {
        throw new Error("Pending websocket event is required.");
      }

      this.#deliverEvent(nextEvent);
      if (nextEvent.kind === "close") {
        break;
      }
    }
  }

  public hasAccepted(): boolean {
    return this.#accepted;
  }

  public hasBoundBrowserSocket(): boolean {
    return this.#browserSocket !== undefined;
  }

  public pushResponseFrame(input: { bytes: Uint8Array; opcode: "binary" | "text" }): void {
    if (this.#released || this.#terminalEvent !== undefined) {
      return;
    }

    const event: PendingWebSocketEvent = {
      kind: "frame",
      bytes: input.bytes,
      opcode: input.opcode,
    };
    if (this.#browserSocket === undefined) {
      this.#pendingEvents.push(event);
      return;
    }

    this.#deliverEvent(event);
  }

  public pushResponseClose(input: { abrupt: boolean; code?: number; reason?: string }): void {
    if (this.#released || this.#terminalEvent !== undefined) {
      return;
    }

    const event: PendingWebSocketEvent = {
      abrupt: input.abrupt,
      kind: "close",
      ...(input.code === undefined ? {} : { code: input.code }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    };
    this.#terminalEvent = event;

    if (this.#browserSocket === undefined) {
      this.#pendingEvents.push(event);
      return;
    }

    this.#deliverEvent(event);
  }

  public fail(error: unknown): void {
    if (this.#released) {
      return;
    }

    if (!this.#accepted) {
      this.#rejectAccept(error);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    const normalizedReason = normalizeCloseReason(message);
    this.pushResponseClose({
      abrupt: false,
      code: 1011,
      ...(normalizedReason === undefined
        ? {}
        : {
            reason: normalizedReason,
          }),
    });
  }

  public release(): void {
    this.#released = true;
    this.#pendingEvents.length = 0;
    this.#browserSocket = undefined;
  }

  #deliverEvent(event: PendingWebSocketEvent): void {
    if (this.#browserSocket === undefined) {
      return;
    }

    if (event.kind === "frame") {
      if (event.opcode === "text") {
        this.#browserSocket.send(decodeTextFrame(event.bytes));
        return;
      }

      this.#browserSocket.send(Buffer.from(event.bytes));
      return;
    }

    if (event.abrupt) {
      this.#browserSocket.raw?.terminate();
      return;
    }

    this.#browserSocket.close(event.code, event.reason);
  }
}

type ProxyPublishedHttpRequestInput = {
  host: string;
  request: Request;
  sandboxInstanceId: string;
  targetPort: number;
};

type OpenPublishedWebSocketInput = {
  host: string;
  request: Request;
  sandboxInstanceId: string;
  targetPort: number;
};

export class BootstrapPublishRouter {
  readonly #nextStreamIdBySandbox = new Map<string, number>();
  readonly #pendingHttpStreamsBySandbox = new Map<string, Map<number, PendingHttpPublishStream>>();
  readonly #pendingWebSocketStreamsBySandbox = new Map<
    string,
    Map<number, PendingWebSocketPublishStream>
  >();

  public constructor(
    private readonly relayCoordinator: TunnelRelayCoordinator,
    private readonly tunnelSessionRegistry: TunnelSessionRegistry,
  ) {}

  public async proxyPublishedHttpRequest(input: ProxyPublishedHttpRequestInput): Promise<Response> {
    const bootstrapTarget = this.tunnelSessionRegistry.getBootstrapTarget({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (bootstrapTarget === undefined) {
      throw new PublishedHttpRequestError(
        503,
        `Sandbox bootstrap tunnel is not connected for '${input.sandboxInstanceId}'.`,
      );
    }

    const pendingStream = this.#createPendingHttpStream({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    const requestUrl = new URL(input.request.url);
    const requestHeaders = buildForwardHeaders({
      host: input.host,
      request: input.request,
      targetPort: input.targetPort,
    });
    const closeStream = async (): Promise<void> => {
      if (this.#releasePendingHttpStream(pendingStream) === undefined) {
        return;
      }

      await this.#forwardPublishMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        payload: createPayload({
          type: "publish.stream.close",
          streamId: pendingStream.streamId,
        }),
      }).catch(() => undefined);
    };

    await this.#forwardPublishMessage({
      sandboxInstanceId: input.sandboxInstanceId,
      payload: createPayload({
        type: "publish.http.open",
        request: {
          headers: requestHeaders,
          method: input.request.method,
          path: requestUrl.pathname,
          ...(requestUrl.search.length <= 1
            ? {}
            : {
                query: requestUrl.search.slice(1),
              }),
        },
        streamId: pendingStream.streamId,
        target: {
          kind: "port",
          port: input.targetPort,
        },
      }),
    }).catch((error) => {
      this.#releasePendingHttpStream(pendingStream);
      throw error;
    });

    const requestBodyPump = this.#pumpRequestBody({
      method: input.request.method,
      request: input.request,
      sandboxInstanceId: input.sandboxInstanceId,
      streamId: pendingStream.streamId,
    }).catch(async (error: unknown) => {
      pendingStream.fail(error);
      await closeStream();
    });

    const responseStart = await pendingStream.awaitResponseStart().catch((error: unknown) => {
      this.#releasePendingHttpStream(pendingStream);
      throw error;
    });
    void requestBodyPump;

    return new Response(
      responseStart.status === 204 || input.request.method === "HEAD"
        ? null
        : pendingStream.createResponseBodyStream({
            onCancel: closeStream,
          }),
      {
        headers: toResponseHeaders(responseStart.headers),
        status: responseStart.status,
      },
    );
  }

  public async openPublishedWebSocket(input: OpenPublishedWebSocketInput): Promise<number> {
    const bootstrapTarget = this.tunnelSessionRegistry.getBootstrapTarget({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (bootstrapTarget === undefined) {
      throw new PublishedHttpRequestError(
        503,
        `Sandbox bootstrap tunnel is not connected for '${input.sandboxInstanceId}'.`,
      );
    }

    const pendingStream = this.#createPendingWebSocketStream({
      sandboxInstanceId: input.sandboxInstanceId,
    });
    const requestUrl = new URL(input.request.url);

    await this.#forwardPublishMessage({
      sandboxInstanceId: input.sandboxInstanceId,
      payload: createPayload({
        type: "publish.ws.open",
        request: {
          headers: buildForwardWebSocketHeaders({
            host: input.host,
            request: input.request,
            targetPort: input.targetPort,
          }),
          path: requestUrl.pathname,
          ...(requestUrl.search.length <= 1
            ? {}
            : {
                query: requestUrl.search.slice(1),
              }),
        },
        streamId: pendingStream.streamId,
        target: {
          kind: "port",
          port: input.targetPort,
        },
      }),
    }).catch((error) => {
      this.#releasePendingWebSocketStream(pendingStream);
      throw error;
    });

    await pendingStream.awaitAccept().catch((error: unknown) => {
      this.#releasePendingWebSocketStream(pendingStream);
      throw error;
    });

    return pendingStream.streamId;
  }

  public bindPublishedWebSocket(input: {
    browserSocket: WSContext<WebSocket>;
    sandboxInstanceId: string;
    streamId: number;
  }): void {
    this.#findPendingWebSocketStream(input)?.bindBrowserSocket(input.browserSocket);
  }

  public async forwardBrowserWebSocketFrame(input: {
    data: ArrayBufferLike | ArrayBufferView | Blob | string;
    sandboxInstanceId: string;
    streamId: number;
  }): Promise<void> {
    const pendingStream = this.#findPendingWebSocketStream(input);
    if (pendingStream === undefined) {
      return;
    }

    let bytes: Uint8Array;
    let opcode: "binary" | "text";
    if (typeof input.data === "string") {
      opcode = "text";
      bytes = new Uint8Array(Buffer.from(input.data, "utf8"));
    } else if (input.data instanceof Blob) {
      opcode = "binary";
      bytes = new Uint8Array(await input.data.arrayBuffer());
    } else if (ArrayBuffer.isView(input.data)) {
      opcode = "binary";
      bytes = new Uint8Array(input.data.buffer, input.data.byteOffset, input.data.byteLength);
    } else {
      opcode = "binary";
      bytes = new Uint8Array(input.data);
    }

    await this.#forwardPublishMessage({
      sandboxInstanceId: input.sandboxInstanceId,
      payload: createPayload({
        type: "publish.ws.frame",
        bytes: encodeBodyFrame(bytes),
        direction: "request",
        encoding: "base64",
        opcode,
        streamId: input.streamId,
      }),
    }).catch((error: unknown) => {
      pendingStream.fail(error);
    });
  }

  public async closePublishedWebSocket(input: {
    code: number;
    reason?: string;
    sandboxInstanceId: string;
    streamId: number;
  }): Promise<void> {
    const pendingStream = this.#findPendingWebSocketStream(input);
    if (pendingStream === undefined) {
      return;
    }

    this.#releasePendingWebSocketStream(pendingStream);
    if (isSendableWebSocketCloseCode(input.code)) {
      const normalizedReason = normalizeCloseReason(input.reason);
      await this.#forwardPublishMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        payload: createPayload({
          type: "publish.ws.close",
          code: input.code,
          direction: "request",
          ...(normalizedReason === undefined
            ? {}
            : {
                reason: normalizedReason,
              }),
          streamId: input.streamId,
        }),
      }).catch(() => undefined);
      return;
    }

    await this.#forwardPublishMessage({
      sandboxInstanceId: input.sandboxInstanceId,
      payload: createPayload({
        type: "publish.stream.close",
        streamId: input.streamId,
      }),
    }).catch(() => undefined);
  }

  public async failPublishedWebSocket(input: {
    sandboxInstanceId: string;
    streamId: number;
  }): Promise<void> {
    const pendingStream = this.#findPendingWebSocketStream(input);
    if (pendingStream === undefined) {
      return;
    }

    this.#releasePendingWebSocketStream(pendingStream);
    await this.#forwardPublishMessage({
      sandboxInstanceId: input.sandboxInstanceId,
      payload: createPayload({
        type: "publish.stream.close",
        streamId: input.streamId,
      }),
    }).catch(() => undefined);
  }

  public handleBootstrapMessage(input: { payload: string; sandboxInstanceId: string }): boolean {
    let parsedPayload: unknown;
    try {
      parsedPayload = JSON.parse(input.payload);
    } catch {
      return false;
    }

    if (typeof parsedPayload !== "object" || parsedPayload === null) {
      return false;
    }

    const type = Reflect.get(parsedPayload, "type");
    if (typeof type !== "string") {
      return false;
    }

    switch (type) {
      case "publish.http.response.start":
        return this.#handleResponseStart(input.sandboxInstanceId, parsedPayload);
      case "publish.http.body.chunk":
        return this.#handleResponseChunk(input.sandboxInstanceId, parsedPayload);
      case "publish.http.body.end":
        return this.#handleResponseEnd(input.sandboxInstanceId, parsedPayload);
      case "publish.ws.accept":
        return this.#handleWebSocketAccept(input.sandboxInstanceId, parsedPayload);
      case "publish.ws.frame":
        return this.#handleWebSocketFrame(input.sandboxInstanceId, parsedPayload);
      case "publish.ws.close":
        return this.#handleWebSocketClose(input.sandboxInstanceId, parsedPayload);
      case "publish.stream.error":
        return this.#handleStreamError(input.sandboxInstanceId, parsedPayload);
      case "publish.stream.close":
        return this.#handleStreamClose(input.sandboxInstanceId, parsedPayload);
      default:
        return false;
    }
  }

  public releaseSandboxStreams(input: { sandboxInstanceId: string }): void {
    const pendingHttpStreams = this.#pendingHttpStreamsBySandbox.get(input.sandboxInstanceId);
    const pendingWebSocketStreams = this.#pendingWebSocketStreamsBySandbox.get(
      input.sandboxInstanceId,
    );
    this.#pendingHttpStreamsBySandbox.delete(input.sandboxInstanceId);
    this.#pendingWebSocketStreamsBySandbox.delete(input.sandboxInstanceId);
    this.#nextStreamIdBySandbox.delete(input.sandboxInstanceId);
    if (pendingHttpStreams !== undefined) {
      for (const pendingStream of pendingHttpStreams.values()) {
        pendingStream.fail(
          new PublishedHttpRequestError(
            503,
            `Sandbox bootstrap tunnel disconnected while streaming published target '${input.sandboxInstanceId}'.`,
          ),
        );
        pendingStream.release();
      }
    }
    if (pendingWebSocketStreams !== undefined) {
      for (const pendingStream of pendingWebSocketStreams.values()) {
        pendingStream.fail(
          new PublishedHttpRequestError(
            503,
            `Sandbox bootstrap tunnel disconnected while streaming published target '${input.sandboxInstanceId}'.`,
          ),
        );
        pendingStream.release();
      }
    }
  }

  #createPendingHttpStream(input: { sandboxInstanceId: string }): PendingHttpPublishStream {
    const nextStreamId = (this.#nextStreamIdBySandbox.get(input.sandboxInstanceId) ?? 0) + 1;
    this.#nextStreamIdBySandbox.set(input.sandboxInstanceId, nextStreamId);

    const pendingStream = new PendingHttpPublishStream(input.sandboxInstanceId, nextStreamId);
    let sandboxStreams = this.#pendingHttpStreamsBySandbox.get(input.sandboxInstanceId);
    if (sandboxStreams === undefined) {
      sandboxStreams = new Map<number, PendingHttpPublishStream>();
      this.#pendingHttpStreamsBySandbox.set(input.sandboxInstanceId, sandboxStreams);
    }
    sandboxStreams.set(nextStreamId, pendingStream);

    return pendingStream;
  }

  #createPendingWebSocketStream(input: {
    sandboxInstanceId: string;
  }): PendingWebSocketPublishStream {
    const nextStreamId = (this.#nextStreamIdBySandbox.get(input.sandboxInstanceId) ?? 0) + 1;
    this.#nextStreamIdBySandbox.set(input.sandboxInstanceId, nextStreamId);

    const pendingStream = new PendingWebSocketPublishStream(input.sandboxInstanceId, nextStreamId);
    let sandboxStreams = this.#pendingWebSocketStreamsBySandbox.get(input.sandboxInstanceId);
    if (sandboxStreams === undefined) {
      sandboxStreams = new Map<number, PendingWebSocketPublishStream>();
      this.#pendingWebSocketStreamsBySandbox.set(input.sandboxInstanceId, sandboxStreams);
    }
    sandboxStreams.set(nextStreamId, pendingStream);

    return pendingStream;
  }

  #findPendingHttpStream(input: {
    sandboxInstanceId: string;
    streamId: number;
  }): PendingHttpPublishStream | undefined {
    return this.#pendingHttpStreamsBySandbox.get(input.sandboxInstanceId)?.get(input.streamId);
  }

  #findPendingWebSocketStream(input: {
    sandboxInstanceId: string;
    streamId: number;
  }): PendingWebSocketPublishStream | undefined {
    return this.#pendingWebSocketStreamsBySandbox.get(input.sandboxInstanceId)?.get(input.streamId);
  }

  #releasePendingHttpStream(input: PendingHttpPublishStream): PendingHttpPublishStream | undefined {
    const sandboxStreams = this.#pendingHttpStreamsBySandbox.get(input.sandboxInstanceId);
    if (sandboxStreams?.delete(input.streamId) !== true) {
      return undefined;
    }

    input.release();
    if (sandboxStreams.size === 0) {
      this.#pendingHttpStreamsBySandbox.delete(input.sandboxInstanceId);
    }

    return input;
  }

  #releasePendingWebSocketStream(
    input: PendingWebSocketPublishStream,
  ): PendingWebSocketPublishStream | undefined {
    const sandboxStreams = this.#pendingWebSocketStreamsBySandbox.get(input.sandboxInstanceId);
    if (sandboxStreams?.delete(input.streamId) !== true) {
      return undefined;
    }

    input.release();
    if (sandboxStreams.size === 0) {
      this.#pendingWebSocketStreamsBySandbox.delete(input.sandboxInstanceId);
    }

    return input;
  }

  async #forwardPublishMessage(input: {
    sandboxInstanceId: string;
    payload: RelayPayload;
  }): Promise<void> {
    if (
      this.tunnelSessionRegistry.getBootstrapTarget({
        sandboxInstanceId: input.sandboxInstanceId,
      }) === undefined
    ) {
      throw new PublishedHttpRequestError(
        503,
        `Sandbox bootstrap tunnel is not connected for '${input.sandboxInstanceId}'.`,
      );
    }

    await this.relayCoordinator.forwardPeerMessage({
      fromSide: "connection",
      payload: input.payload,
      sandboxInstanceId: input.sandboxInstanceId,
    });
  }

  async #pumpRequestBody(input: {
    method: string;
    request: Request;
    sandboxInstanceId: string;
    streamId: number;
  }): Promise<void> {
    const body = input.request.body;
    if (!isBodyAllowedForMethod(input.method) || body === null) {
      await this.#forwardPublishMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        payload: createPayload({
          type: "publish.http.body.end",
          direction: "request",
          streamId: input.streamId,
        }),
      });
      return;
    }

    const reader = body.getReader();
    try {
      while (true) {
        const nextChunk = await reader.read();
        if (nextChunk.done) {
          break;
        }

        for (const chunk of chunkBytes(nextChunk.value)) {
          await this.#forwardPublishMessage({
            sandboxInstanceId: input.sandboxInstanceId,
            payload: createPayload({
              type: "publish.http.body.chunk",
              bytes: encodeBodyChunk(chunk),
              direction: "request",
              encoding: "base64",
              streamId: input.streamId,
            }),
          });
        }
      }

      await this.#forwardPublishMessage({
        sandboxInstanceId: input.sandboxInstanceId,
        payload: createPayload({
          type: "publish.http.body.end",
          direction: "request",
          streamId: input.streamId,
        }),
      });
    } finally {
      reader.releaseLock();
    }
  }

  #handleResponseStart(sandboxInstanceId: string, payload: object): boolean {
    const streamId = Reflect.get(payload, "streamId");
    const status = Reflect.get(payload, "status");
    const headers = readHeaderMap(Reflect.get(payload, "headers"));
    if (
      typeof streamId !== "number" ||
      !Number.isInteger(streamId) ||
      typeof status !== "number" ||
      !Number.isInteger(status) ||
      headers === undefined
    ) {
      return false;
    }

    const pendingStream = this.#findPendingHttpStream({
      sandboxInstanceId,
      streamId,
    });
    if (pendingStream === undefined) {
      return true;
    }

    pendingStream.pushResponseStart({
      headers,
      status,
    });
    return true;
  }

  #handleResponseChunk(sandboxInstanceId: string, payload: object): boolean {
    const streamId = Reflect.get(payload, "streamId");
    const direction = Reflect.get(payload, "direction");
    const bytes = Reflect.get(payload, "bytes");
    const encoding = Reflect.get(payload, "encoding");
    if (
      typeof streamId !== "number" ||
      !Number.isInteger(streamId) ||
      direction !== "response" ||
      typeof bytes !== "string" ||
      encoding !== "base64"
    ) {
      return false;
    }

    const pendingStream = this.#findPendingHttpStream({
      sandboxInstanceId,
      streamId,
    });
    if (pendingStream === undefined) {
      return true;
    }

    const chunk = decodeBodyChunk(bytes);
    const accepted = pendingStream.pushResponseChunk(chunk);
    if (!accepted) {
      pendingStream.fail(
        new PublishedHttpRequestError(
          502,
          `Published HTTP response exceeded ${String(MaxBufferedPublishBytesPerStream)} buffered bytes.`,
        ),
      );
      void this.#forwardPublishMessage({
        sandboxInstanceId,
        payload: createPayload({
          type: "publish.stream.close",
          streamId,
        }),
      }).catch(() => undefined);
      this.#releasePendingHttpStream(pendingStream);
    }

    return true;
  }

  #handleResponseEnd(sandboxInstanceId: string, payload: object): boolean {
    const streamId = Reflect.get(payload, "streamId");
    const direction = Reflect.get(payload, "direction");
    if (typeof streamId !== "number" || !Number.isInteger(streamId) || direction !== "response") {
      return false;
    }

    const pendingStream = this.#findPendingHttpStream({
      sandboxInstanceId,
      streamId,
    });
    if (pendingStream === undefined) {
      return true;
    }

    pendingStream.pushResponseEnd();
    return true;
  }

  #handleWebSocketAccept(sandboxInstanceId: string, payload: object): boolean {
    const streamId = Reflect.get(payload, "streamId");
    if (typeof streamId !== "number" || !Number.isInteger(streamId)) {
      return false;
    }

    this.#findPendingWebSocketStream({
      sandboxInstanceId,
      streamId,
    })?.accept();
    return true;
  }

  #handleWebSocketFrame(sandboxInstanceId: string, payload: object): boolean {
    const streamId = Reflect.get(payload, "streamId");
    const direction = Reflect.get(payload, "direction");
    const opcode = Reflect.get(payload, "opcode");
    const bytes = Reflect.get(payload, "bytes");
    const encoding = Reflect.get(payload, "encoding");
    if (
      typeof streamId !== "number" ||
      !Number.isInteger(streamId) ||
      direction !== "response" ||
      (opcode !== "binary" && opcode !== "text") ||
      typeof bytes !== "string" ||
      encoding !== "base64"
    ) {
      return false;
    }

    this.#findPendingWebSocketStream({
      sandboxInstanceId,
      streamId,
    })?.pushResponseFrame({
      bytes: decodeBodyFrame(bytes),
      opcode,
    });
    return true;
  }

  #handleWebSocketClose(sandboxInstanceId: string, payload: object): boolean {
    const streamId = Reflect.get(payload, "streamId");
    const direction = Reflect.get(payload, "direction");
    const code = Reflect.get(payload, "code");
    const reason = Reflect.get(payload, "reason");
    if (
      typeof streamId !== "number" ||
      !Number.isInteger(streamId) ||
      direction !== "response" ||
      typeof code !== "number" ||
      !Number.isInteger(code) ||
      (reason !== undefined && typeof reason !== "string")
    ) {
      return false;
    }

    const pendingStream = this.#findPendingWebSocketStream({
      sandboxInstanceId,
      streamId,
    });
    if (pendingStream === undefined) {
      return true;
    }

    const normalizedReason = normalizeCloseReason(reason);
    pendingStream.pushResponseClose({
      abrupt: false,
      ...(isSendableWebSocketCloseCode(code)
        ? {
            code,
          }
        : {}),
      ...(normalizedReason === undefined
        ? {}
        : {
            reason: normalizedReason,
          }),
    });
    if (pendingStream.hasBoundBrowserSocket()) {
      this.#releasePendingWebSocketStream(pendingStream);
    }

    return true;
  }

  #handleStreamError(sandboxInstanceId: string, payload: object): boolean {
    const streamId = Reflect.get(payload, "streamId");
    const code = Reflect.get(payload, "code");
    const message = Reflect.get(payload, "message");
    if (
      typeof streamId !== "number" ||
      !Number.isInteger(streamId) ||
      typeof code !== "string" ||
      typeof message !== "string"
    ) {
      return false;
    }

    const pendingStream = this.#findPendingHttpStream({
      sandboxInstanceId,
      streamId,
    });
    if (pendingStream === undefined) {
      const pendingWebSocketStream = this.#findPendingWebSocketStream({
        sandboxInstanceId,
        streamId,
      });
      if (pendingWebSocketStream === undefined) {
        return true;
      }

      pendingWebSocketStream.fail(
        new PublishedHttpRequestError(this.#statusForStreamErrorCode(code), message),
      );
      if (pendingWebSocketStream.hasBoundBrowserSocket()) {
        this.#releasePendingWebSocketStream(pendingWebSocketStream);
      }
      return true;
    }

    pendingStream.fail(
      new PublishedHttpRequestError(this.#statusForStreamErrorCode(code), message),
    );
    this.#releasePendingHttpStream(pendingStream);
    return true;
  }

  #handleStreamClose(sandboxInstanceId: string, payload: object): boolean {
    const streamId = Reflect.get(payload, "streamId");
    if (typeof streamId !== "number" || !Number.isInteger(streamId)) {
      return false;
    }

    const pendingStream = this.#findPendingHttpStream({
      sandboxInstanceId,
      streamId,
    });
    if (pendingStream === undefined) {
      const pendingWebSocketStream = this.#findPendingWebSocketStream({
        sandboxInstanceId,
        streamId,
      });
      if (pendingWebSocketStream === undefined) {
        return true;
      }

      pendingWebSocketStream.pushResponseClose({
        abrupt: true,
      });
      if (pendingWebSocketStream.hasBoundBrowserSocket()) {
        this.#releasePendingWebSocketStream(pendingWebSocketStream);
      }
      return true;
    }

    if (pendingStream.hasEnded()) {
      this.#releasePendingHttpStream(pendingStream);
      return true;
    }

    pendingStream.fail(
      new PublishedHttpRequestError(
        502,
        "Published HTTP stream closed before the response completed.",
      ),
    );
    this.#releasePendingHttpStream(pendingStream);
    return true;
  }

  #statusForStreamErrorCode(code: string): number {
    switch (code) {
      case "target_internal":
        return 403;
      case "target_not_found":
        return 404;
      case "target_not_live":
        return 409;
      case "bootstrap_disconnected":
        return 503;
      default:
        return 502;
    }
  }
}
