import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { Duplex as NodeDuplex } from "node:stream";

import type {
  PortAccessBootstrapTokenConfig,
  PortAccessHostConfig,
} from "@mistle/port-access-auth";
import type { Clock } from "@mistle/time";

import { BootstrapTunnelNotConnectedError } from "../tunnel/bootstrap-tunnel-not-connected-error.js";
import {
  PortAccessSessionCookieName,
  type PortAccessSessionConfig,
} from "./auth/port-access-session.js";
import { bootstrapPortAccess } from "./port-access-bootstrap.js";
import {
  PortAccessTcpStreamLimitExceededError,
  PortAccessTcpStreamTimeoutError,
  PortAccessTransportBootstrapDisconnectedError,
  PortAccessTransportService,
  PortAccessTransportStreamError,
} from "./port-access-transport.js";
import type { PortsTargetAuthorizeService } from "./ports-target-authorize-service.js";
import { readCookieValue, resolvePortAccessRequest } from "./register-port-access-routes.js";

export const PortAccessBootstrapPath = "/_mistle/access/bootstrap";

type PortAccessNodeEntrypointInput = {
  bootstrapTokenConfig: PortAccessBootstrapTokenConfig;
  clock: Clock;
  hostConfig: PortAccessHostConfig;
  portAccessTransportService: PortAccessTransportService;
  portsTargetAuthorizeService: PortsTargetAuthorizeService;
  sessionConfig: PortAccessSessionConfig;
};

export type PortAccessNodeEntrypoint = {
  handleRequest: (request: IncomingMessage, response: ServerResponse) => Promise<boolean>;
  handleUpgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => Promise<boolean>;
};

type ResolvedPortAccessRequest = Exclude<
  Awaited<ReturnType<typeof resolvePortAccessRequest>>,
  { kind: "not-port-access-host" } | { kind: "failure" }
>;

type RawClientSource = IncomingMessage | Duplex;
type RequestBodyEncoding = "identity" | "chunked";
type RawHeader = {
  name: string;
  value: string;
};

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

class PortAccessNodeClientDuplex extends NodeDuplex {
  readonly #source: RawClientSource;
  readonly #socket: Duplex;
  readonly #requestBodyEncoding: RequestBodyEncoding;
  #destroyClosesSocket = false;
  #sourceEnded = false;

  public constructor(input: {
    requestBodyEncoding?: RequestBodyEncoding;
    socket: Duplex;
    source: RawClientSource;
  }) {
    super();
    this.#requestBodyEncoding = input.requestBodyEncoding ?? "identity";
    this.#source = input.source;
    this.#socket = input.socket;

    this.#source.on("data", this.#onSourceData);
    this.#source.once("end", this.#onSourceEnd);
    this.#source.once("close", this.#onSourceClose);
    this.#source.once("error", this.#onSourceError);
    if ("aborted" in this.#source) {
      this.#source.once("aborted", this.#onSourceAborted);
    }
  }

  public markConnected(): void {
    this.#destroyClosesSocket = true;
  }

  public override _read(): void {
    this.#source.resume();
  }

  public override _write(
    chunk: Buffer,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.#socket.write(chunk, encoding, callback);
  }

  public override _final(callback: (error?: Error | null) => void): void {
    this.#socket.end(callback);
  }

  public override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.#detachSource();
    if (this.#destroyClosesSocket) {
      if (error === null) {
        this.#socket.destroy();
      } else {
        this.#socket.destroy(error);
      }
    }
    callback(error);
  }

  readonly #onSourceData = (chunk: Buffer): void => {
    const forwardedChunk =
      this.#requestBodyEncoding === "chunked"
        ? Buffer.concat([
            Buffer.from(`${chunk.byteLength.toString(16)}\r\n`, "ascii"),
            chunk,
            Buffer.from("\r\n", "ascii"),
          ])
        : chunk;
    if (!this.push(forwardedChunk)) {
      this.#source.pause();
    }
  };

  readonly #onSourceEnd = (): void => {
    this.#sourceEnded = true;
    if (this.#requestBodyEncoding === "chunked") {
      this.push(Buffer.from("0\r\n\r\n", "ascii"));
    }
    this.push(null);
  };

  readonly #onSourceClose = (): void => {
    if (!this.#sourceEnded) {
      this.destroy(new Error("Port Access client socket closed before request body completed."));
    }
  };

  readonly #onSourceAborted = (): void => {
    this.destroy(new Error("Port Access client request aborted before request body completed."));
  };

  readonly #onSourceError = (error: Error): void => {
    this.destroy(error);
  };

  #detachSource(): void {
    this.#source.off("data", this.#onSourceData);
    this.#source.off("end", this.#onSourceEnd);
    this.#source.off("close", this.#onSourceClose);
    this.#source.off("error", this.#onSourceError);
    if ("aborted" in this.#source) {
      this.#source.off("aborted", this.#onSourceAborted);
    }
  }
}

function getSingleHeaderValue(input: {
  headers: IncomingHttpHeaders;
  name: string;
}): string | undefined {
  const value = input.headers[input.name];
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function createRequestUrl(input: { host: string; requestTarget: string | undefined }): string {
  return new URL(input.requestTarget ?? "/", `http://${input.host}`).toString();
}

function toRawHeaders(rawHeaders: string[]): RawHeader[] {
  const headers: RawHeader[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const headerName = rawHeaders[index];
    const headerValue = rawHeaders[index + 1];
    if (headerName === undefined || headerValue === undefined) {
      throw new Error("Expected Node rawHeaders to contain header name/value pairs.");
    }

    headers.push({
      name: headerName,
      value: headerValue,
    });
  }

  return headers;
}

function serializeRequestHead(input: {
  headers: RawHeader[];
  method: string;
  requestTarget: string;
  version: string;
}): Uint8Array {
  const lines = [`${input.method} ${input.requestTarget} HTTP/${input.version}`];
  for (const header of input.headers) {
    lines.push(`${header.name}: ${header.value}`);
  }

  lines.push("", "");
  return Buffer.from(lines.join("\r\n"), "utf8");
}

function toLowercaseHeaderNameSet(values: string[]): Set<string> {
  const headerNames = new Set<string>();
  for (const value of values) {
    for (const token of value.split(",")) {
      const headerName = token.trim().toLowerCase();
      if (headerName.length > 0) {
        headerNames.add(headerName);
      }
    }
  }

  return headerNames;
}

function sanitizeCookieHeader(cookieHeader: string): string | undefined {
  const remainingSegments = cookieHeader
    .split(";")
    .map((segment) => segment.trim())
    .filter(
      (segment) => segment.length > 0 && !segment.startsWith(`${PortAccessSessionCookieName}=`),
    );
  if (remainingSegments.length === 0) {
    return undefined;
  }

  return remainingSegments.join("; ");
}

function isChunkedRequest(headers: RawHeader[]): boolean {
  return headers.some(
    (header) =>
      header.name.toLowerCase() === "transfer-encoding" &&
      header.value
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .includes("chunked"),
  );
}

function buildHttpRequestHeaders(input: {
  browserEdgePort: string;
  browserEdgeProto: "http" | "https";
  browserVisibleHost: string;
  rawHeaders: RawHeader[];
  targetPort: number;
  upstreamProtocol: "http" | "https";
}): RawHeader[] {
  const rewrittenHeaders: RawHeader[] = [];
  const connectionHeaderValues = input.rawHeaders
    .filter((header) => header.name.toLowerCase() === "connection")
    .map((header) => header.value);
  const connectionHeaderNames = toLowercaseHeaderNameSet(connectionHeaderValues);
  const chunkedRequestBody = isChunkedRequest(input.rawHeaders);

  for (const header of input.rawHeaders) {
    const normalizedHeaderName = header.name.toLowerCase();
    if (normalizedHeaderName === "host") {
      continue;
    }
    if (connectionHeaderNames.has(normalizedHeaderName)) {
      continue;
    }
    if (
      HopByHopHeaderNames.has(normalizedHeaderName) &&
      !(chunkedRequestBody && normalizedHeaderName === "transfer-encoding")
    ) {
      continue;
    }
    if (normalizedHeaderName === "cookie") {
      const sanitizedCookie = sanitizeCookieHeader(header.value);
      if (sanitizedCookie !== undefined) {
        rewrittenHeaders.push({
          name: header.name,
          value: sanitizedCookie,
        });
      }
      continue;
    }
    if (normalizedHeaderName === "origin") {
      rewrittenHeaders.push({
        name: header.name,
        value: `${input.upstreamProtocol}://127.0.0.1:${String(input.targetPort)}`,
      });
      continue;
    }

    rewrittenHeaders.push(header);
  }

  return [
    ...rewrittenHeaders,
    {
      name: "Host",
      value: `127.0.0.1:${String(input.targetPort)}`,
    },
    {
      name: "X-Forwarded-Host",
      value: input.browserVisibleHost,
    },
    {
      name: "X-Forwarded-Proto",
      value: input.browserEdgeProto,
    },
    {
      name: "X-Forwarded-Port",
      value: input.browserEdgePort,
    },
  ];
}

function buildUpgradeRequestHeaders(input: {
  browserEdgePort: string;
  browserEdgeProto: "http" | "https";
  browserVisibleHost: string;
  rawHeaders: RawHeader[];
  targetPort: number;
  upstreamProtocol: "http" | "https";
}): RawHeader[] {
  const rewrittenHeaders: RawHeader[] = [];

  for (const header of input.rawHeaders) {
    const normalizedHeaderName = header.name.toLowerCase();
    if (normalizedHeaderName === "host") {
      continue;
    }
    if (normalizedHeaderName === "cookie") {
      const sanitizedCookie = sanitizeCookieHeader(header.value);
      if (sanitizedCookie !== undefined) {
        rewrittenHeaders.push({
          name: header.name,
          value: sanitizedCookie,
        });
      }
      continue;
    }
    if (normalizedHeaderName === "origin") {
      rewrittenHeaders.push({
        name: header.name,
        value: `${input.browserEdgeProto}://${input.browserVisibleHost}`,
      });
      continue;
    }
    if (
      HopByHopHeaderNames.has(normalizedHeaderName) &&
      normalizedHeaderName !== "connection" &&
      normalizedHeaderName !== "upgrade"
    ) {
      continue;
    }

    rewrittenHeaders.push(header);
  }

  return [
    ...rewrittenHeaders,
    {
      name: "Host",
      value: `127.0.0.1:${String(input.targetPort)}`,
    },
    {
      name: "X-Forwarded-Host",
      value: input.browserVisibleHost,
    },
    {
      name: "X-Forwarded-Proto",
      value: input.browserEdgeProto,
    },
    {
      name: "X-Forwarded-Port",
      value: input.browserEdgePort,
    },
  ];
}

function getRequestBodyEncoding(input: {
  headers: RawHeader[];
  method: string | undefined;
}): RequestBodyEncoding {
  if (input.method === "GET" || input.method === "HEAD") {
    return "identity";
  }
  if (isChunkedRequest(input.headers)) {
    return "chunked";
  }

  return "identity";
}

function writeWebResponse(input: { response: ServerResponse; webResponse: Response }): void {
  input.response.statusCode = input.webResponse.status;
  for (const [headerName, headerValue] of input.webResponse.headers.entries()) {
    input.response.setHeader(headerName, headerValue);
  }
  input.webResponse.text().then(
    (body) => {
      input.response.end(body);
    },
    (error: unknown) => {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      input.response.destroy(normalizedError);
    },
  );
}

function writePlainResponse(input: {
  body: string;
  response: ServerResponse;
  status: number;
}): void {
  input.response.statusCode = input.status;
  input.response.setHeader("content-type", "text/plain; charset=utf-8");
  input.response.end(input.body);
}

function writeRawSocketResponse(input: { body: string; socket: Duplex; status: number }): void {
  const reason = input.status === 401 ? "Unauthorized" : "Bad Gateway";
  const bodyBytes = Buffer.from(input.body, "utf8");
  input.socket.write(
    [
      `HTTP/1.1 ${String(input.status)} ${reason}`,
      "Connection: close",
      "Content-Type: text/plain; charset=utf-8",
      `Content-Length: ${String(bodyBytes.byteLength)}`,
      "",
      "",
    ].join("\r\n"),
  );
  input.socket.end(bodyBytes);
}

function isClientVisiblePortAccessFailure(error: unknown): boolean {
  return (
    error instanceof BootstrapTunnelNotConnectedError ||
    error instanceof PortAccessTransportBootstrapDisconnectedError ||
    error instanceof PortAccessTransportStreamError ||
    error instanceof PortAccessTcpStreamLimitExceededError ||
    error instanceof PortAccessTcpStreamTimeoutError
  );
}

async function resolveNodePortAccessRequest(input: {
  clock: Clock;
  hostConfig: PortAccessHostConfig;
  request: IncomingMessage;
  sessionConfig: PortAccessSessionConfig;
}): Promise<Awaited<ReturnType<typeof resolvePortAccessRequest>>> {
  const requestHost = getSingleHeaderValue({
    headers: input.request.headers,
    name: "host",
  });
  if (requestHost === undefined) {
    return { kind: "not-port-access-host" };
  }

  return resolvePortAccessRequest({
    clock: input.clock,
    cookieHeader: getSingleHeaderValue({
      headers: input.request.headers,
      name: "cookie",
    }),
    forwardedProto: getSingleHeaderValue({
      headers: input.request.headers,
      name: "x-forwarded-proto",
    }),
    hostConfig: input.hostConfig,
    requestHost,
    requestUrl: createRequestUrl({
      host: requestHost,
      requestTarget: input.request.url,
    }),
    sessionConfig: input.sessionConfig,
  });
}

function buildHttpInitialBytes(input: {
  request: IncomingMessage;
  resolvedRequest: ResolvedPortAccessRequest;
}): Uint8Array {
  const rawHeaders = toRawHeaders(input.request.rawHeaders);
  const requestTarget = input.request.url ?? "/";

  return serializeRequestHead({
    headers: buildHttpRequestHeaders({
      browserEdgePort: input.resolvedRequest.browserEdgePort,
      browserEdgeProto: input.resolvedRequest.browserEdgeProto,
      browserVisibleHost: input.resolvedRequest.parsedHost.host,
      rawHeaders,
      targetPort: input.resolvedRequest.verifiedSession.port,
      upstreamProtocol: input.resolvedRequest.verifiedSession.upstreamProtocol,
    }),
    method: input.request.method ?? "GET",
    requestTarget,
    version: input.request.httpVersion,
  });
}

function buildUpgradeInitialBytes(input: {
  head: Buffer;
  request: IncomingMessage;
  resolvedRequest: ResolvedPortAccessRequest;
}): Uint8Array {
  const rawHeaders = toRawHeaders(input.request.rawHeaders);
  const requestTarget = input.request.url ?? "/";
  const requestHead = serializeRequestHead({
    headers: buildUpgradeRequestHeaders({
      browserEdgePort: input.resolvedRequest.browserEdgePort,
      browserEdgeProto: input.resolvedRequest.browserEdgeProto,
      browserVisibleHost: input.resolvedRequest.parsedHost.host,
      rawHeaders,
      targetPort: input.resolvedRequest.verifiedSession.port,
      upstreamProtocol: input.resolvedRequest.verifiedSession.upstreamProtocol,
    }),
    method: input.request.method ?? "GET",
    requestTarget,
    version: input.request.httpVersion,
  });

  return Buffer.concat([Buffer.from(requestHead), input.head]);
}

async function waitForTcpConnected(input: {
  client: PortAccessNodeClientDuplex;
  initialBytes: Uint8Array;
  portAccessTransportService: PortAccessTransportService;
  resolvedRequest: ResolvedPortAccessRequest;
}): Promise<void> {
  const tcpStream = await input.portAccessTransportService.openTcpStream({
    client: input.client,
    initialBytes: input.initialBytes,
    portAccessSessionId: input.resolvedRequest.portAccessSessionId,
    sandboxInstanceId: input.resolvedRequest.verifiedSession.sandboxInstanceId,
    target: {
      kind: "port",
      port: input.resolvedRequest.verifiedSession.port,
    },
    upstreamProtocol: input.resolvedRequest.verifiedSession.upstreamProtocol,
  });
  await tcpStream.connected;
  input.client.markConnected();
}

export function createPortAccessNodeEntrypoint(
  input: PortAccessNodeEntrypointInput,
): PortAccessNodeEntrypoint {
  return {
    handleRequest: async (request, response) => {
      const requestUrl = new URL(
        request.url ?? "/",
        `http://${getSingleHeaderValue({ headers: request.headers, name: "host" }) ?? "localhost"}`,
      );
      if (requestUrl.pathname === PortAccessBootstrapPath) {
        return false;
      }

      const resolvedRequest = await resolveNodePortAccessRequest({
        clock: input.clock,
        hostConfig: input.hostConfig,
        request,
        sessionConfig: input.sessionConfig,
      });
      if (resolvedRequest.kind === "not-port-access-host") {
        return false;
      }
      if (resolvedRequest.kind === "failure") {
        writeWebResponse({
          response,
          webResponse: resolvedRequest.response,
        });
        return true;
      }

      const rawHeaders = toRawHeaders(request.rawHeaders);
      const client = new PortAccessNodeClientDuplex({
        requestBodyEncoding: getRequestBodyEncoding({
          headers: rawHeaders,
          method: request.method,
        }),
        socket: request.socket,
        source: request,
      });

      try {
        await waitForTcpConnected({
          client,
          initialBytes: buildHttpInitialBytes({
            request,
            resolvedRequest,
          }),
          portAccessTransportService: input.portAccessTransportService,
          resolvedRequest,
        });
      } catch (error) {
        client.destroy();
        if (isClientVisiblePortAccessFailure(error)) {
          writePlainResponse({
            body: "Port Access upstream request failed.",
            response,
            status: 502,
          });
          return true;
        }

        throw error;
      }

      return true;
    },
    handleUpgrade: async (request, socket, head) => {
      const resolvedRequest = await resolveNodePortAccessRequest({
        clock: input.clock,
        hostConfig: input.hostConfig,
        request,
        sessionConfig: input.sessionConfig,
      });
      if (resolvedRequest.kind === "not-port-access-host") {
        return false;
      }
      if (resolvedRequest.kind === "failure") {
        writeRawSocketResponse({
          body: "Invalid or expired Port Access session.",
          socket,
          status: 401,
        });
        return true;
      }

      const client = new PortAccessNodeClientDuplex({
        socket,
        source: socket,
      });

      try {
        await waitForTcpConnected({
          client,
          initialBytes: buildUpgradeInitialBytes({
            head,
            request,
            resolvedRequest,
          }),
          portAccessTransportService: input.portAccessTransportService,
          resolvedRequest,
        });
      } catch (error) {
        client.destroy();
        if (isClientVisiblePortAccessFailure(error)) {
          writeRawSocketResponse({
            body: "Port Access upstream request failed.",
            socket,
            status: 502,
          });
          return true;
        }

        throw error;
      }

      return true;
    },
  };
}

export async function handlePortAccessBootstrapRequest(input: {
  bootstrapTokenConfig: PortAccessBootstrapTokenConfig;
  clock: Clock;
  hostConfig: PortAccessHostConfig;
  portsTargetAuthorizeService: PortsTargetAuthorizeService;
  request: IncomingMessage;
  response: ServerResponse;
  sessionConfig: PortAccessSessionConfig;
}): Promise<boolean> {
  const requestHost = getSingleHeaderValue({
    headers: input.request.headers,
    name: "host",
  });
  const requestUrl = createRequestUrl({
    host: requestHost ?? "localhost",
    requestTarget: input.request.url,
  });
  if (new URL(requestUrl).pathname !== PortAccessBootstrapPath) {
    return false;
  }

  const result = await bootstrapPortAccess({
    bootstrapTokenConfig: input.bootstrapTokenConfig,
    clock: input.clock,
    forwardedProto: getSingleHeaderValue({
      headers: input.request.headers,
      name: "x-forwarded-proto",
    }),
    hostConfig: input.hostConfig,
    portsTargetAuthorizeService: input.portsTargetAuthorizeService,
    requestHost,
    requestUrl,
    sessionConfig: input.sessionConfig,
    token: new URL(requestUrl).searchParams.get("token") ?? undefined,
  });

  if (result.kind === "failure") {
    writePlainResponse({
      body: result.message,
      response: input.response,
      status: result.status,
    });
    return true;
  }

  input.response.statusCode = 302;
  input.response.setHeader("location", result.location);
  input.response.setHeader("set-cookie", result.setCookieHeader);
  input.response.end();
  return true;
}

export function readPortAccessSessionIdFromRequest(request: IncomingMessage): string | undefined {
  return readCookieValue({
    cookieHeader: getSingleHeaderValue({
      headers: request.headers,
      name: "cookie",
    }),
    cookieName: PortAccessSessionCookieName,
  });
}
