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

type ProxyPublishedHttpRequestInput = {
  host: string;
  request: Request;
  sandboxInstanceId: string;
  targetPort: number;
};

export class BootstrapPublishRouter {
  readonly #nextStreamIdBySandbox = new Map<string, number>();
  readonly #pendingHttpStreamsBySandbox = new Map<string, Map<number, PendingHttpPublishStream>>();

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
      case "publish.stream.error":
        return this.#handleStreamError(input.sandboxInstanceId, parsedPayload);
      case "publish.stream.close":
        return this.#handleStreamClose(input.sandboxInstanceId, parsedPayload);
      default:
        return false;
    }
  }

  public releaseSandboxStreams(input: { sandboxInstanceId: string }): void {
    const pendingStreams = this.#pendingHttpStreamsBySandbox.get(input.sandboxInstanceId);
    if (pendingStreams === undefined) {
      return;
    }

    this.#pendingHttpStreamsBySandbox.delete(input.sandboxInstanceId);
    this.#nextStreamIdBySandbox.delete(input.sandboxInstanceId);
    for (const pendingStream of pendingStreams.values()) {
      pendingStream.fail(
        new PublishedHttpRequestError(
          503,
          `Sandbox bootstrap tunnel disconnected while streaming published target '${input.sandboxInstanceId}'.`,
        ),
      );
      pendingStream.release();
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

  #findPendingHttpStream(input: {
    sandboxInstanceId: string;
    streamId: number;
  }): PendingHttpPublishStream | undefined {
    return this.#pendingHttpStreamsBySandbox.get(input.sandboxInstanceId)?.get(input.streamId);
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
