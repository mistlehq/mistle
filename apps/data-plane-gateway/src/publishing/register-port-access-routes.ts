import type {
  PortAccessBootstrapTokenConfig,
  PortAccessHostConfig,
} from "@mistle/port-access-auth";
import {
  PortAccessHostError,
  PortAccessHostErrorCode,
  parsePortAccessHost,
} from "@mistle/port-access-auth";
import type { Clock } from "@mistle/time";

import { BootstrapTunnelNotConnectedError } from "../tunnel/bootstrap-tunnel-not-connected-error.js";
import type { DataPlaneGatewayApp } from "../types.js";
import {
  PortAccessSessionCookieName,
  type PortAccessSessionConfig,
  PortAccessSessionError,
  verifyPortAccessSession,
} from "./auth/port-access-session.js";
import { bootstrapPortAccess } from "./port-access-bootstrap.js";
import {
  buildPortAccessRequestHeaders,
  type PortAccessHttpRequestHandle,
  PortAccessTransportBootstrapDisconnectedError,
  PortAccessTransportService,
  PortAccessTransportStreamError,
  toPortAccessResponseHeaders,
} from "./port-access-transport.js";
import type { PortsTargetAuthorizeService } from "./ports-target-authorize-service.js";

const PortAccessBootstrapPath = "/_mistle/access/bootstrap";

function readCookieValue(input: {
  cookieHeader: string | undefined;
  cookieName: string;
}): string | undefined {
  if (input.cookieHeader === undefined) {
    return undefined;
  }

  for (const segment of input.cookieHeader.split(";")) {
    const trimmedSegment = segment.trim();
    if (!trimmedSegment.startsWith(`${input.cookieName}=`)) {
      continue;
    }

    return trimmedSegment.slice(input.cookieName.length + 1);
  }

  return undefined;
}

function resolveBrowserEdgeProto(input: {
  forwardedProto: string | undefined;
  requestUrl: string;
}): "http" | "https" {
  if (input.forwardedProto === "https") {
    return "https";
  }

  return new URL(input.requestUrl).protocol === "https:" ? "https" : "http";
}

function resolveBrowserEdgePort(input: {
  browserEdgeProto: "http" | "https";
  requestHost: string;
  requestUrl: string;
}): string {
  const requestUrl = new URL(input.requestUrl);
  const requestHost = input.requestHost.trim();
  const bracketedIpv6End = requestHost.indexOf("]");
  if (bracketedIpv6End !== -1) {
    const suffix = requestHost.slice(bracketedIpv6End + 1);
    if (suffix.startsWith(":") && suffix.length > 1) {
      return suffix.slice(1);
    }
  }

  const lastColon = requestHost.lastIndexOf(":");
  if (lastColon !== -1 && requestHost.indexOf(":") === lastColon) {
    const maybePort = requestHost.slice(lastColon + 1);
    if (/^\d+$/u.test(maybePort)) {
      return maybePort;
    }
  }

  if (requestUrl.port.length > 0) {
    return requestUrl.port;
  }

  return input.browserEdgeProto === "https" ? "443" : "80";
}

async function pipeBrowserRequestBody(input: {
  requestBody: ReadableStream<Uint8Array> | null;
  sendChunk: (chunk: Uint8Array) => Promise<void>;
  sendEnd: () => Promise<void>;
}): Promise<void> {
  if (input.requestBody === null) {
    await input.sendEnd();
    return;
  }

  const reader = input.requestBody.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        await input.sendEnd();
        return;
      }

      await input.sendChunk(result.value);
    }
  } finally {
    reader.releaseLock();
  }
}

function wrapPortAccessResponseBody(input: {
  close: () => Promise<void>;
  responseBody: ReadableStream<Uint8Array>;
}): ReadableStream<Uint8Array> {
  const reader = input.responseBody.getReader();

  return new ReadableStream<Uint8Array>({
    async cancel() {
      await input.close();
      await reader.cancel();
    },
    async pull(controller) {
      const result = await reader.read();
      if (result.done) {
        controller.close();
        return;
      }

      controller.enqueue(result.value);
    },
  });
}

function neverSettlingPromise<T>(): Promise<T> {
  return new Promise(() => undefined);
}
export function registerPortAccessRoutes(input: {
  app: DataPlaneGatewayApp;
  bootstrapTokenConfig: PortAccessBootstrapTokenConfig;
  hostConfig: PortAccessHostConfig;
  portAccessTransportService: PortAccessTransportService;
  sessionConfig: PortAccessSessionConfig;
  portsTargetAuthorizeService: PortsTargetAuthorizeService;
  clock: Clock;
}): void {
  input.app.get(PortAccessBootstrapPath, async (ctx) => {
    const result = await bootstrapPortAccess({
      bootstrapTokenConfig: input.bootstrapTokenConfig,
      hostConfig: input.hostConfig,
      sessionConfig: input.sessionConfig,
      portsTargetAuthorizeService: input.portsTargetAuthorizeService,
      clock: input.clock,
      requestUrl: ctx.req.url,
      requestHost: ctx.req.header("host"),
      token: ctx.req.query("token"),
      forwardedProto: ctx.req.header("x-forwarded-proto"),
    });

    if (result.kind === "failure") {
      return new Response(result.message, {
        status: result.status,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }

    const response = ctx.redirect(result.location, 302);
    response.headers.append("set-cookie", result.setCookieHeader);
    return response;
  });

  input.app.all("*", async (ctx, next) => {
    if (new URL(ctx.req.url).pathname === PortAccessBootstrapPath) {
      return next();
    }

    const requestHost = ctx.req.header("host");
    if (requestHost === undefined) {
      return next();
    }

    let parsedHost;
    try {
      parsedHost = parsePortAccessHost({
        config: input.hostConfig,
        host: requestHost,
      });
    } catch (error) {
      if (error instanceof PortAccessHostError) {
        if (error.code === PortAccessHostErrorCode.BASE_DOMAIN_REQUIRED) {
          throw error;
        }

        return next();
      }

      throw error;
    }

    const cookie = readCookieValue({
      cookieHeader: ctx.req.header("cookie"),
      cookieName: PortAccessSessionCookieName,
    });
    try {
      const verifiedSession = await verifyPortAccessSession({
        config: input.sessionConfig,
        clock: input.clock,
        cookie: cookie ?? "",
      });
      if (
        verifiedSession.host !== parsedHost.host ||
        verifiedSession.sandboxInstanceId !== parsedHost.sandboxInstanceId ||
        verifiedSession.port !== parsedHost.port
      ) {
        return new Response("Invalid or expired Port Access session.", {
          status: 401,
          headers: {
            "content-type": "text/plain; charset=utf-8",
          },
        });
      }

      const browserEdgeProto = resolveBrowserEdgeProto({
        forwardedProto: ctx.req.header("x-forwarded-proto"),
        requestUrl: ctx.req.url,
      });
      const requestUrl = new URL(ctx.req.url);
      const browserEdgePort = resolveBrowserEdgePort({
        browserEdgeProto,
        requestHost,
        requestUrl: ctx.req.url,
      });
      const requestHandle = await input.portAccessTransportService.openHttpStream({
        sandboxInstanceId: verifiedSession.sandboxInstanceId,
        target: {
          kind: "port",
          port: verifiedSession.port,
        },
        upstreamProtocol: verifiedSession.upstreamProtocol,
        request: {
          method: ctx.req.method,
          path: requestUrl.pathname,
          query: requestUrl.search.length > 1 ? requestUrl.search.slice(1) : undefined,
          headers: buildPortAccessRequestHeaders({
            browserEdgePort,
            browserEdgeProto,
            browserVisibleHost: parsedHost.host,
            requestHeaders: ctx.req.raw.headers,
            targetPort: verifiedSession.port,
            upstreamProtocol: verifiedSession.upstreamProtocol,
          }),
        },
      });

      const requestBodyFailureSignal = pipeBrowserRequestBody({
        requestBody: ctx.req.raw.body,
        sendChunk: requestHandle.sendRequestBodyChunk,
        sendEnd: requestHandle.finishRequestBody,
      }).then(
        () => neverSettlingPromise<Awaited<PortAccessHttpRequestHandle["responseStart"]>>(),
        async (error: unknown) => {
          await requestHandle.close();
          if (error instanceof Error) {
            throw error;
          }

          throw new Error(String(error));
        },
      );
      void requestBodyFailureSignal.catch(() => undefined);

      try {
        const responseStart = await Promise.race([
          requestHandle.responseStart,
          requestBodyFailureSignal,
        ]);
        return new Response(
          wrapPortAccessResponseBody({
            close: requestHandle.close,
            responseBody: requestHandle.responseBody,
          }),
          {
            status: responseStart.status,
            headers: toPortAccessResponseHeaders(responseStart.headers),
          },
        );
      } catch (error) {
        if (
          error instanceof BootstrapTunnelNotConnectedError ||
          error instanceof PortAccessTransportBootstrapDisconnectedError ||
          error instanceof PortAccessTransportStreamError
        ) {
          return new Response("Port Access upstream request failed.", {
            status: 502,
            headers: {
              "content-type": "text/plain; charset=utf-8",
            },
          });
        }

        throw error;
      }
    } catch (error) {
      if (error instanceof PortAccessSessionError) {
        return new Response("Invalid or expired Port Access session.", {
          status: 401,
          headers: {
            "content-type": "text/plain; charset=utf-8",
          },
        });
      }

      throw error;
    }
  });
}
