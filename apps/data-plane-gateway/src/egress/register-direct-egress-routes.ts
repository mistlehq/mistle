import type { NodeWebSocket } from "@hono/node-ws";
import { systemSleeper } from "@mistle/time";
import type { WSContext, WSMessageReceive } from "hono/ws";
import WebSocket, { type RawData } from "ws";

import { createGatewayDrainingAdmissionResponse } from "../runtime/gateway-drain-admission.js";
import type { GatewayDrainRegistry } from "../runtime/gateway-drain-registry.js";
import type { GatewayLifecycle } from "../runtime/gateway-lifecycle.js";
import type { DataPlaneGatewayApp } from "../types.js";
import {
  DirectEgressHttpRoutePath,
  DirectEgressProxyError,
  DirectEgressTokenHeaderName,
  type DirectEgressAdmission,
  type DirectEgressProxyService,
  DirectEgressWebSocketRoutePath,
  logDirectEgressFailure,
  logDirectEgressWebSocketEvent,
} from "./direct-egress-proxy-service.js";
import { buildDirectEgressTrustedCaCertificates } from "./direct-egress-trust-store.js";
import {
  normalizeForwardedDirectEgressWebSocketCloseCode,
  normalizeForwardedDirectEgressWebSocketCloseReason,
} from "./direct-egress-websocket-close.js";
import { resolveOpenDirectEgressWebSocketUpstream } from "./direct-egress-websocket-upstream-resolution.js";

type RegisterDirectEgressRoutesInput = {
  app: DataPlaneGatewayApp;
  directEgressProxyService: DirectEgressProxyService;
  drainRegistry: GatewayDrainRegistry;
  lifecycle: GatewayLifecycle;
  trustedUpstreamCaCertificates: readonly string[] | undefined;
  upgradeWebSocket: NodeWebSocket["upgradeWebSocket"];
  webSocketUpstreamResolutionDelayMs?: number;
};

const WebSocketCloseCodes = {
  POLICY_VIOLATION: 1008,
  INTERNAL_ERROR: 1011,
};

export function registerDirectEgressRoutes(input: RegisterDirectEgressRoutesInput): void {
  input.app.all(DirectEgressHttpRoutePath, async (ctx) => {
    const drainRejection = createGatewayDrainingAdmissionResponse({
      lifecycle: input.lifecycle,
      responseKind: "json",
    });
    if (drainRejection !== undefined) {
      return drainRejection;
    }

    const target = new URL(ctx.req.url).searchParams.get("target");
    let admission: DirectEgressAdmission | undefined;
    try {
      admission = await input.directEgressProxyService.authorize({
        authorizationHeader: ctx.req.header(DirectEgressTokenHeaderName),
        db: ctx.get("db"),
        headers: ctx.req.raw.headers,
        method: ctx.req.method,
        tables: ctx.get("tables"),
        target,
        ...(ctx.get("testEnvironmentId") === undefined
          ? {}
          : { testEnvironmentId: ctx.get("testEnvironmentId") }),
        transport: "http",
      });
      const body = await readRequestBody(ctx.req.raw);
      return await input.directEgressProxyService.proxyHttp({
        admission,
        body,
        ...(ctx.get("testEnvironmentId") === undefined
          ? {}
          : { testEnvironmentId: ctx.get("testEnvironmentId") }),
      });
    } catch (error) {
      if (error instanceof DirectEgressProxyError) {
        logDirectEgressFailure({
          admission,
          error,
          target,
          transport: "http",
        });
        return new Response(error.message, { status: error.status });
      }

      throw error;
    }
  });

  input.app.get(
    DirectEgressWebSocketRoutePath,
    async (ctx, next) => {
      if (ctx.req.header("upgrade")?.toLowerCase() !== "websocket") {
        return ctx.text("Direct websocket egress endpoint requires websocket upgrade.", 400);
      }
      const drainRejection = createGatewayDrainingAdmissionResponse({
        lifecycle: input.lifecycle,
        responseKind: "text",
      });
      if (drainRejection !== undefined) {
        return drainRejection;
      }
      const target = new URL(ctx.req.url).searchParams.get("target");
      let admission: DirectEgressAdmission | undefined;
      try {
        admission = await input.directEgressProxyService.authorize({
          authorizationHeader: ctx.req.header(DirectEgressTokenHeaderName),
          db: ctx.get("db"),
          headers: ctx.req.raw.headers,
          method: "GET",
          tables: ctx.get("tables"),
          target: normalizeWebSocketTarget(target),
          ...(ctx.get("testEnvironmentId") === undefined
            ? {}
            : { testEnvironmentId: ctx.get("testEnvironmentId") }),
          transport: "websocket",
        });
        ctx.set("directEgressAdmission", admission);
        await next();
      } catch (error) {
        if (error instanceof DirectEgressProxyError) {
          logDirectEgressFailure({
            admission,
            error,
            target,
            transport: "websocket",
          });
          return new Response(error.message, { status: error.status });
        }

        throw error;
      }
    },
    input.upgradeWebSocket((ctx) => {
      const admission = ctx.get("directEgressAdmission");
      if (admission === undefined) {
        throw new Error("Expected direct egress websocket request admission.");
      }
      let upstreamSocket: WebSocket | undefined;
      const pendingClientMessages: WSMessageReceive[] = [];
      const startedAtMs = Date.now();
      let unregisterDrainHandle: (() => void) | undefined;

      return {
        onOpen: (_event, ws) => {
          if (ws.raw === undefined) {
            throw new Error("Expected direct egress websocket to expose the raw Node websocket.");
          }
          unregisterDrainHandle = input.drainRegistry.registerGatewayWebSocket({
            category: "direct_egress",
            socket: ws.raw,
          });
          logDirectEgressWebSocketEvent({
            admission,
            event: "gateway_direct_egress_websocket_client_opened",
            startedAtMs,
          });
          resolveOpenDirectEgressWebSocketUpstream({
            ...(input.webSocketUpstreamResolutionDelayMs === undefined
              ? {}
              : {
                  delayAfterResolutionMs: input.webSocketUpstreamResolutionDelayMs,
                  sleeper: systemSleeper,
                }),
            isClientOpen: () => ws.readyState === WebSocket.OPEN,
            upstream: input.directEgressProxyService.resolveWebSocketUpstream({
              admission,
              ...(ctx.get("testEnvironmentId") === undefined
                ? {}
                : { testEnvironmentId: ctx.get("testEnvironmentId") }),
            }),
          })
            .then((upstream) => {
              if (upstream === undefined) {
                return;
              }
              logDirectEgressWebSocketEvent({
                admission,
                event: "gateway_direct_egress_websocket_upstream_connect_started",
                pendingClientMessageCount: pendingClientMessages.length,
                startedAtMs,
                upstreamUrl: upstream.url,
              });
              upstreamSocket = connectUpstreamWebSocket({
                admission,
                client: ws,
                headers: upstream.headers,
                onOpen: (upstream) => {
                  for (const message of pendingClientMessages.splice(0)) {
                    sendUpstreamWebSocketMessage({
                      data: message,
                      upstream,
                    });
                  }
                },
                startedAtMs,
                trustedUpstreamCaCertificates: input.trustedUpstreamCaCertificates,
                upstreamUrl: upstream.url,
              });
              if (ws.readyState !== WebSocket.OPEN) {
                upstreamSocket.terminate();
              }
            })
            .catch((error: unknown) => {
              if (ws.readyState !== WebSocket.OPEN) {
                return;
              }
              logDirectEgressWebSocketEvent({
                admission,
                error: error instanceof Error ? error : new Error(String(error)),
                event: "gateway_direct_egress_websocket_failed",
                outcome: "upstream_resolution_failed",
                pendingClientMessageCount: pendingClientMessages.length,
                startedAtMs,
              });
              ws.close(
                WebSocketCloseCodes.POLICY_VIOLATION,
                error instanceof Error ? error.message : String(error),
              );
            });
        },
        onMessage: (event, ws) => {
          const upstream = upstreamSocket;
          if (upstream === undefined || upstream.readyState === WebSocket.CONNECTING) {
            pendingClientMessages.push(event.data);
            return;
          }
          if (upstream.readyState !== WebSocket.OPEN) {
            ws.close(
              WebSocketCloseCodes.INTERNAL_ERROR,
              "Direct egress upstream websocket is not connected.",
            );
            return;
          }

          sendUpstreamWebSocketMessage({
            data: event.data,
            upstream,
          });
        },
        onClose: (event) => {
          unregisterDrainHandle?.();
          unregisterDrainHandle = undefined;
          logDirectEgressWebSocketEvent({
            admission,
            closeCode: event.code,
            closeReason: event.reason,
            event: "gateway_direct_egress_websocket_client_closed",
            outcome: "client_closed",
            pendingClientMessageCount: pendingClientMessages.length,
            startedAtMs,
          });
          upstreamSocket?.close();
        },
        onError: (event) => {
          unregisterDrainHandle?.();
          unregisterDrainHandle = undefined;
          logDirectEgressWebSocketEvent({
            admission,
            error: event instanceof Error ? event : undefined,
            event: "gateway_direct_egress_websocket_client_error",
            outcome: "client_error",
            pendingClientMessageCount: pendingClientMessages.length,
            startedAtMs,
          });
          upstreamSocket?.terminate();
        },
      };
    }),
  );
}

async function readRequestBody(request: Request): Promise<Uint8Array | undefined> {
  if (request.body === null) {
    return undefined;
  }

  return new Uint8Array(await request.arrayBuffer());
}

function normalizeWebSocketTarget(target: string | null): string | null {
  if (target === null) {
    return null;
  }

  if (target.startsWith("ws://")) {
    return `http://${target.slice("ws://".length)}`;
  }
  if (target.startsWith("wss://")) {
    return `https://${target.slice("wss://".length)}`;
  }

  return target;
}

function connectUpstreamWebSocket(input: {
  admission: DirectEgressAdmission;
  client: WSContext<WebSocket>;
  headers: Record<string, string>;
  onOpen: (upstream: WebSocket) => void;
  startedAtMs: number;
  trustedUpstreamCaCertificates: readonly string[] | undefined;
  upstreamUrl: URL;
}): WebSocket {
  const upstream = new WebSocket(
    input.upstreamUrl,
    createUpstreamWebSocketOptions({
      headers: input.headers,
      trustedUpstreamCaCertificates: input.trustedUpstreamCaCertificates,
    }),
  );
  upstream.on("open", () => {
    if (input.client.readyState !== WebSocket.OPEN) {
      upstream.close();
      return;
    }

    input.onOpen(upstream);
    logDirectEgressWebSocketEvent({
      admission: input.admission,
      event: "gateway_direct_egress_websocket_upstream_opened",
      outcome: "connected",
      startedAtMs: input.startedAtMs,
      upstreamUrl: input.upstreamUrl,
    });
  });
  upstream.on("message", (data, isBinary) => {
    if (input.client.readyState !== WebSocket.OPEN) {
      return;
    }

    input.client.send(toClientWebSocketMessage(data, isBinary));
  });
  upstream.on("close", (code, reason) => {
    const closeReason = reason.toString("utf8");
    logDirectEgressWebSocketEvent({
      admission: input.admission,
      closeCode: code,
      closeReason,
      event: "gateway_direct_egress_websocket_upstream_closed",
      outcome: "upstream_closed",
      startedAtMs: input.startedAtMs,
      upstreamUrl: input.upstreamUrl,
    });
    if (input.client.readyState === WebSocket.OPEN) {
      input.client.close(
        normalizeForwardedDirectEgressWebSocketCloseCode(code),
        normalizeForwardedDirectEgressWebSocketCloseReason(closeReason),
      );
    }
  });
  upstream.on("error", (error) => {
    logDirectEgressWebSocketEvent({
      admission: input.admission,
      error,
      event: "gateway_direct_egress_websocket_upstream_error",
      outcome: "upstream_error",
      startedAtMs: input.startedAtMs,
      upstreamUrl: input.upstreamUrl,
    });
    if (input.client.readyState === WebSocket.OPEN) {
      input.client.close(WebSocketCloseCodes.INTERNAL_ERROR, error.message);
    }
  });

  return upstream;
}

function createUpstreamWebSocketOptions(input: {
  headers: Record<string, string>;
  trustedUpstreamCaCertificates: readonly string[] | undefined;
}): WebSocket.ClientOptions {
  if (
    input.trustedUpstreamCaCertificates === undefined ||
    input.trustedUpstreamCaCertificates.length === 0
  ) {
    return {
      headers: input.headers,
    };
  }

  const trustedCaCertificates = buildDirectEgressTrustedCaCertificates(
    input.trustedUpstreamCaCertificates,
  );

  return trustedCaCertificates === undefined
    ? {
        headers: input.headers,
      }
    : {
        ca: trustedCaCertificates,
        headers: input.headers,
      };
}

function sendUpstreamWebSocketMessage(input: {
  data: WSMessageReceive;
  upstream: WebSocket;
}): void {
  if (typeof input.data === "string") {
    input.upstream.send(input.data);
    return;
  }
  if (input.data instanceof ArrayBuffer) {
    input.upstream.send(Buffer.from(input.data));
    return;
  }
  if (input.data instanceof SharedArrayBuffer) {
    input.upstream.send(Buffer.from(input.data));
    return;
  }

  void input.data.arrayBuffer().then(
    (buffer: ArrayBuffer) => {
      if (input.upstream.readyState === WebSocket.OPEN) {
        input.upstream.send(Buffer.from(buffer));
      }
    },
    (_error: unknown) => {
      input.upstream.terminate();
    },
  );
}

function toClientWebSocketMessage(data: RawData, isBinary: boolean): string | ArrayBuffer {
  if (!isBinary) {
    return toRawDataBuffer(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return copyBytesToArrayBuffer(data);
  }
  if (data instanceof ArrayBuffer) {
    return data;
  }

  return copyBytesToArrayBuffer(Buffer.concat(data));
}

function toRawDataBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }

  return Buffer.concat(data);
}

function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
