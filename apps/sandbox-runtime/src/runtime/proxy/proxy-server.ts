import {
  createServer as createHttpServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { Socket } from "node:net";
import { TLSSocket, type SecureContext } from "node:tls";

import type { CompiledRuntimePlan } from "@mistle/integrations-core";
import { Agent as UndiciAgent, type Dispatcher } from "undici";

import type { CertificateAuthority } from "./certificate-authority.js";
import {
  copyHeadersWithoutHopByHop,
  fetchHeadersFromOutgoingHeaders,
  headerBagFromHeaders,
  headerBagFromIncomingHeaders,
  headerBagToFetchHeaders,
  headerBagToOutgoingHeaders,
  restoreUpgradeHeaders,
} from "./headers.js";
import { createProxyMediator, type ProxyRequestClassification } from "./proxy-mediator.js";

type UpstreamRequestTarget = {
  url: URL;
  method: string;
  headers: Headers;
  body: ReadableStream<Uint8Array> | undefined;
};

export type ProxyServer = {
  handleHttpRequest: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  handleConnect: (request: IncomingMessage, socket: Socket, head: Buffer) => void;
  close: () => Promise<void>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeForwardPath(path: string): string {
  if (path.length === 0) {
    return "/";
  }

  return path.startsWith("/") ? path : `/${path}`;
}

function normalizeTargetHost(targetHost: string): string {
  const trimmedTargetHost = targetHost.trim().toLowerCase();
  if (trimmedTargetHost.length === 0) {
    return "";
  }

  if (trimmedTargetHost.startsWith("[")) {
    const endBracketIndex = trimmedTargetHost.indexOf("]");
    if (endBracketIndex >= 0) {
      return trimmedTargetHost.slice(1, endBracketIndex);
    }
  }

  const separatorIndex = trimmedTargetHost.lastIndexOf(":");
  if (separatorIndex > 0) {
    const host = trimmedTargetHost.slice(0, separatorIndex);
    const port = trimmedTargetHost.slice(separatorIndex + 1);
    if (port.length > 0 && Number.isInteger(Number(port))) {
      return host;
    }
  }

  return trimmedTargetHost;
}

function normalizeConnectTarget(connectTarget: string): string {
  return connectTarget.includes(":") ? connectTarget : `${connectTarget}:443`;
}

function bodyStreamFromIncomingMessage(request: IncomingMessage): ReadableStream<Uint8Array> {
  const iterator = request[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const iteratorResult = await iterator.next();
      if (iteratorResult.done) {
        controller.close();
        return;
      }

      const chunk = iteratorResult.value;
      controller.enqueue(chunk instanceof Uint8Array ? chunk : Buffer.from(chunk));
    },
    cancel() {
      request.destroy();
    },
  });
}

function writeConnectFailure(socket: Socket): void {
  socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
  socket.destroy();
}

function buildPlainHttpTarget(request: IncomingMessage): {
  classification: ProxyRequestClassification;
  target: UpstreamRequestTarget;
} {
  if (request.url === undefined) {
    throw new Error("proxy requests must use an absolute URL");
  }

  let upstreamUrl: URL;
  try {
    upstreamUrl = new URL(request.url);
  } catch {
    throw new Error("proxy requests must use an absolute URL");
  }

  if (upstreamUrl.protocol !== "http:") {
    throw new Error("https proxy requests must use CONNECT");
  }

  const headers = copyHeadersWithoutHopByHop(headerBagFromIncomingHeaders(request.headers), true);

  return {
    classification: {
      host: normalizeTargetHost(upstreamUrl.host),
      method: request.method ?? "GET",
      path: normalizeForwardPath(upstreamUrl.pathname),
    },
    target: {
      url: upstreamUrl,
      method: request.method ?? "GET",
      headers: headerBagToFetchHeaders(headers),
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : bodyStreamFromIncomingMessage(request),
    },
  };
}

function buildInterceptedHttpsTarget(
  connectTarget: string,
  request: IncomingMessage,
): { classification: ProxyRequestClassification; target: UpstreamRequestTarget } {
  const requestUrl = request.url;
  if (requestUrl === undefined) {
    throw new Error("https proxy request url is required");
  }

  if (requestUrl.startsWith("http://") || requestUrl.startsWith("https://")) {
    throw new Error("https proxy request must use origin-form paths");
  }

  const normalizedConnectTarget = normalizeTargetHost(connectTarget);
  const normalizedRequestHost = normalizeTargetHost(request.headers.host ?? "");
  if (normalizedRequestHost.length > 0 && normalizedRequestHost !== normalizedConnectTarget) {
    throw new Error(
      `https proxy request host "${request.headers.host}" does not match connect target "${connectTarget}"`,
    );
  }

  const upstreamUrl = new URL(`https://${normalizeConnectTarget(connectTarget)}${requestUrl}`);
  const headers = copyHeadersWithoutHopByHop(headerBagFromIncomingHeaders(request.headers), true);

  return {
    classification: {
      host: normalizedConnectTarget,
      method: request.method ?? "GET",
      path: normalizeForwardPath(upstreamUrl.pathname),
    },
    target: {
      url: upstreamUrl,
      method: request.method ?? "GET",
      headers: headerBagToFetchHeaders(headers),
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : bodyStreamFromIncomingMessage(request),
    },
  };
}

type ProxyFetchRequestInit = RequestInit & {
  dispatcher?: Dispatcher;
  duplex?: "half";
};

async function sendFetchRequest(
  target: UpstreamRequestTarget,
  dispatcher?: Dispatcher,
): Promise<Response> {
  const requestInit: ProxyFetchRequestInit = {
    method: target.method,
    headers: target.headers,
    redirect: "manual",
    ...(dispatcher === undefined ? {} : { dispatcher }),
  };

  if (target.body !== undefined && target.method !== "GET" && target.method !== "HEAD") {
    requestInit.body = target.body;
    requestInit.duplex = "half";
  }

  return fetch(target.url, requestInit);
}

function writeFetchResponse(response: ServerResponse, upstreamResponse: Response): Promise<void> {
  const filteredHeaders = copyHeadersWithoutHopByHop(
    headerBagFromHeaders(upstreamResponse.headers),
    false,
  );
  if (upstreamResponse.headers.has("content-encoding")) {
    filteredHeaders.delete("content-encoding");
    filteredHeaders.delete("content-length");
  }

  response.writeHead(upstreamResponse.status, headerBagToOutgoingHeaders(filteredHeaders));

  if (upstreamResponse.body === null) {
    response.end();
    return Promise.resolve();
  }

  return upstreamResponse.body.pipeTo(
    new WritableStream<Uint8Array>({
      write(chunk) {
        response.write(chunk);
      },
      close() {
        response.end();
      },
      abort(error) {
        response.destroy(error instanceof Error ? error : new Error(String(error)));
      },
    }),
  );
}

function writeRawResponse(socket: TLSSocket, response: IncomingMessage): Promise<void> {
  const filteredHeaders = copyHeadersWithoutHopByHop(
    headerBagFromIncomingHeaders(response.headers),
    false,
  );
  restoreUpgradeHeaders(filteredHeaders, headerBagFromIncomingHeaders(response.headers));

  return new Promise<void>((resolve, reject) => {
    socket.write(
      `HTTP/${response.httpVersion} ${response.statusCode ?? 502} ${response.statusMessage ?? ""}\r\n`,
    );
    for (const [headerName, headerValue] of Object.entries(
      headerBagToOutgoingHeaders(filteredHeaders),
    )) {
      if (headerValue === undefined) {
        continue;
      }

      if (Array.isArray(headerValue)) {
        for (const value of headerValue) {
          socket.write(`${headerName}: ${value}\r\n`);
        }
        continue;
      }

      socket.write(`${headerName}: ${headerValue}\r\n`);
    }
    socket.write("\r\n");

    response.on("error", reject);
    response.on("end", () => {
      resolve();
    });
    response.pipe(socket, { end: false });
  });
}

function restoreUpgradeFetchHeaders(headers: Headers, source: IncomingHttpHeaders): Headers {
  const restoredHeaders = headerBagFromHeaders(headers);
  restoreUpgradeHeaders(restoredHeaders, headerBagFromIncomingHeaders(source));
  return headerBagToFetchHeaders(restoredHeaders);
}

function connectTunnel(left: Socket | TLSSocket, right: Socket, head: Buffer): void {
  if (head.length > 0) {
    right.write(head);
  }

  left.pipe(right);
  right.pipe(left);

  left.once("close", () => {
    right.destroy();
  });
  right.once("close", () => {
    left.destroy();
  });
}

function upstreamRequestFunction(protocol: string): typeof httpRequest {
  return protocol === "https:" ? httpsRequest : httpRequest;
}

function sendUpgradeRequest(
  target: UpstreamRequestTarget,
  responseSocket: TLSSocket,
  head: Buffer,
  httpsAgent?: HttpsAgent,
): void {
  const upstreamRequest = upstreamRequestFunction(target.url.protocol)(target.url, {
    method: target.method,
    ...(httpsAgent === undefined || target.url.protocol !== "https:" ? {} : { agent: httpsAgent }),
    headers: Object.fromEntries(target.headers.entries()),
  });

  upstreamRequest.once("response", async (upstreamResponse) => {
    try {
      await writeRawResponse(responseSocket, upstreamResponse);
    } catch {
      responseSocket.destroy();
      upstreamResponse.destroy();
      return;
    }

    responseSocket.end();
  });

  upstreamRequest.once("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
    const filteredHeaders = copyHeadersWithoutHopByHop(
      headerBagFromIncomingHeaders(upstreamResponse.headers),
      false,
    );
    restoreUpgradeHeaders(filteredHeaders, headerBagFromIncomingHeaders(upstreamResponse.headers));

    responseSocket.write(
      `HTTP/${upstreamResponse.httpVersion} ${upstreamResponse.statusCode ?? 101} ${upstreamResponse.statusMessage ?? ""}\r\n`,
    );
    for (const [headerName, headerValue] of Object.entries(
      headerBagToOutgoingHeaders(filteredHeaders),
    )) {
      if (headerValue === undefined) {
        continue;
      }

      if (Array.isArray(headerValue)) {
        for (const value of headerValue) {
          responseSocket.write(`${headerName}: ${value}\r\n`);
        }
        continue;
      }

      responseSocket.write(`${headerName}: ${headerValue}\r\n`);
    }
    responseSocket.write("\r\n");
    connectTunnel(responseSocket, upstreamSocket, upstreamHead);
    if (head.length > 0) {
      upstreamSocket.write(head);
    }
  });

  upstreamRequest.once("error", () => {
    responseSocket.destroy();
  });
  upstreamRequest.end();
}

export function createProxyServer(input: {
  runtimePlan: CompiledRuntimePlan;
  tokenizerProxyEgressBaseUrl: string;
  egressGrantByRuleId: Record<string, string>;
  certificateAuthority?: CertificateAuthority;
  trustedCaCertificatesPem?: string[];
}): ProxyServer {
  const proxyMediator = createProxyMediator({
    runtimePlan: input.runtimePlan,
    tokenizerProxyEgressBaseUrl: input.tokenizerProxyEgressBaseUrl,
    egressGrantByRuleId: input.egressGrantByRuleId,
  });
  const trustedCaBundle =
    input.trustedCaCertificatesPem === undefined || input.trustedCaCertificatesPem.length === 0
      ? undefined
      : input.trustedCaCertificatesPem.join("\n");
  const fetchDispatcher =
    trustedCaBundle === undefined
      ? undefined
      : new UndiciAgent({
          connect: {
            ca: trustedCaBundle,
          },
        });
  const httpsAgent =
    trustedCaBundle === undefined
      ? undefined
      : new HttpsAgent({
          ca: trustedCaBundle,
        });

  return {
    async handleHttpRequest(request, response) {
      let target: UpstreamRequestTarget;
      let classification: ProxyRequestClassification;

      try {
        ({ classification, target } = buildPlainHttpTarget(request));

        const routingDecision = proxyMediator.resolve(classification, {
          headers: request.headers,
          body: target.body,
          rawQuery: target.url.search.startsWith("?")
            ? target.url.search.slice(1)
            : target.url.search,
        });
        if (routingDecision.kind === "mediated") {
          target = {
            url: routingDecision.match.request.url,
            method: routingDecision.match.request.method,
            headers: fetchHeadersFromOutgoingHeaders(routingDecision.match.request.headers),
            body: routingDecision.match.request.body,
          };
        }
      } catch (error) {
        const message = errorMessage(error);
        if (
          message === "proxy requests must use an absolute URL" ||
          message === "https proxy requests must use CONNECT"
        ) {
          response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
          response.end(message);
          return;
        }

        response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        response.end(`failed to mediate integration proxy request: ${message}`);
        return;
      }

      try {
        const upstreamResponse = await sendFetchRequest(target, fetchDispatcher);
        await writeFetchResponse(response, upstreamResponse);
      } catch (error) {
        response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        response.end(`failed to forward proxy request: ${errorMessage(error)}`);
      }
    },

    handleConnect(request, socket, head) {
      if (input.certificateAuthority === undefined) {
        writeConnectFailure(socket);
        return;
      }

      const requestHost = request.url;
      if (requestHost === undefined || requestHost.trim().length === 0) {
        writeConnectFailure(socket);
        return;
      }

      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) {
        socket.unshift(head);
      }

      const secureContext: SecureContext = input.certificateAuthority.secureContextForTarget(
        normalizeConnectTarget(requestHost),
      );
      const tlsSocket = new TLSSocket(socket, {
        isServer: true,
        secureContext,
      });

      tlsSocket.once("error", () => {
        tlsSocket.destroy();
      });

      const interceptedServer = createHttpServer(
        async (interceptedRequest, interceptedResponse) => {
          let target: UpstreamRequestTarget;
          let classification: ProxyRequestClassification;

          try {
            ({ classification, target } = buildInterceptedHttpsTarget(
              requestHost,
              interceptedRequest,
            ));
            const routingDecision = proxyMediator.resolve(classification, {
              headers: interceptedRequest.headers,
              body: target.body,
              rawQuery: target.url.search.startsWith("?")
                ? target.url.search.slice(1)
                : target.url.search,
            });
            if (routingDecision.kind === "mediated") {
              target = {
                url: routingDecision.match.request.url,
                method: routingDecision.match.request.method,
                headers: fetchHeadersFromOutgoingHeaders(routingDecision.match.request.headers),
                body: routingDecision.match.request.body,
              };
            }
          } catch (error) {
            interceptedResponse.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
            interceptedResponse.end(
              `failed to forward https proxy request: ${errorMessage(error)}`,
            );
            return;
          }

          try {
            const upstreamResponse = await sendFetchRequest(target, fetchDispatcher);
            await writeFetchResponse(interceptedResponse, upstreamResponse);
          } catch (error) {
            interceptedResponse.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
            interceptedResponse.end(
              `failed to forward https proxy request: ${errorMessage(error)}`,
            );
          }
        },
      );

      interceptedServer.on("upgrade", (interceptedRequest, interceptedSocket, interceptedHead) => {
        if (!(interceptedSocket instanceof TLSSocket)) {
          interceptedSocket.destroy();
          return;
        }

        let target: UpstreamRequestTarget;
        let classification: ProxyRequestClassification;
        try {
          ({ classification, target } = buildInterceptedHttpsTarget(
            requestHost,
            interceptedRequest,
          ));
          const routingDecision = proxyMediator.resolve(classification, {
            headers: interceptedRequest.headers,
            body: undefined,
            rawQuery: target.url.search.startsWith("?")
              ? target.url.search.slice(1)
              : target.url.search,
          });
          if (routingDecision.kind === "mediated") {
            target = {
              url: routingDecision.match.request.url,
              method: routingDecision.match.request.method,
              headers: fetchHeadersFromOutgoingHeaders(routingDecision.match.request.headers),
              body: undefined,
            };
          }
          target = {
            ...target,
            headers: restoreUpgradeFetchHeaders(target.headers, interceptedRequest.headers),
          };
        } catch {
          interceptedSocket.destroy();
          return;
        }

        sendUpgradeRequest(target, interceptedSocket, interceptedHead, httpsAgent);
      });

      tlsSocket.once("secure", () => {
        interceptedServer.emit("connection", tlsSocket);
      });
    },

    async close() {
      await fetchDispatcher?.close();
      httpsAgent?.destroy();
    },
  };
}
