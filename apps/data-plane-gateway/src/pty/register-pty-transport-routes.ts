import type { NodeWebSocket } from "@hono/node-ws";
import type { WSContext } from "hono/ws";
import WebSocket from "ws";

import { logger } from "../logger.js";
import { createGatewayDrainingAdmissionResponse } from "../runtime/gateway-drain-admission.js";
import type { GatewayLifecycle } from "../runtime/gateway-lifecycle.js";
import type { DataPlaneGatewayApp } from "../types.js";
import {
  PtyTransportError,
  PtyTransportTokenQueryParam,
  PtyTransportWebSocketRoutePath,
  type PtyTransportService,
} from "./pty-transport-service.js";

type RegisterPtyTransportRoutesInput = {
  app: DataPlaneGatewayApp;
  lifecycle: GatewayLifecycle;
  ptyTransportService: PtyTransportService;
  testEnvironmentIdQueryParam?: string;
  upgradeWebSocket: NodeWebSocket["upgradeWebSocket"];
};

const WebSocketCloseCodes = {
  INTERNAL_ERROR: 1011,
};

export function registerPtyTransportRoutes(input: RegisterPtyTransportRoutesInput): void {
  input.app.get(PtyTransportWebSocketRoutePath, async (ctx) => {
    if (ctx.req.header("upgrade")?.toLowerCase() !== "websocket") {
      return ctx.text("PTY transport endpoint requires websocket upgrade.", 400);
    }
    const drainRejection = createGatewayDrainingAdmissionResponse({
      lifecycle: input.lifecycle,
      responseKind: "text",
    });
    if (drainRejection !== undefined) {
      return drainRejection;
    }

    try {
      const admission = await input.ptyTransportService.authorize({
        token: readPtyTransportToken(ctx.req.url),
      });
      if (!(await input.ptyTransportService.canAttach({ admission }))) {
        return ctx.text("PTY transport session is not attachable.", 409);
      }
      const testEnvironmentId = ctx.get("testEnvironmentId");

      return input.upgradeWebSocket(ctx, {
        onOpen: (_event, socket) => {
          if (admission.side === "client") {
            input.ptyTransportService.attachClient({
              admission,
              socket,
            });
            return;
          }

          input.ptyTransportService.attachSandbox({
            admission,
            socket,
          });
        },
        onMessage: (event, socket) => {
          if (admission.side === "client") {
            void input.ptyTransportService
              .handleClientMessage({
                admission,
                message: event.data,
                socket,
                testEnvironmentId,
                testEnvironmentIdQueryParam: input.testEnvironmentIdQueryParam,
              })
              .catch((error: unknown) => {
                closeWithError(socket, error);
              });
            return;
          }

          void input.ptyTransportService
            .handleSandboxMessage({
              admission,
              message: event.data,
              socket,
            })
            .catch((error: unknown) => {
              closeWithError(socket, error);
            });
        },
        onClose: (event) => {
          input.ptyTransportService.detach({
            admission,
            closeCode: event.code,
            closeReason: event.reason,
          });
        },
        onError: (event) => {
          input.ptyTransportService.detach({
            admission,
            closeCode: WebSocketCloseCodes.INTERNAL_ERROR,
            closeReason: event instanceof Error ? event.message : "PTY transport websocket error.",
          });
        },
      });
    } catch (error) {
      if (error instanceof PtyTransportError) {
        logger.info(
          {
            event: "gateway_pty_transport_admission_failed",
            failureCode: "admission_rejected",
            status: error.status,
          },
          error.message,
        );
        return new Response(error.message, { status: error.status });
      }

      logger.error(
        {
          err: error,
          event: "gateway_pty_transport_admission_failed",
          failureCode: "internal_error",
        },
        "PTY transport websocket admission failed.",
      );
      throw error;
    }
  });
}

function readPtyTransportToken(requestUrl: string): string | null {
  const values = new URL(requestUrl).searchParams.getAll(PtyTransportTokenQueryParam);
  if (values.length !== 1) {
    return null;
  }

  const token = values[0];
  return token === undefined ? null : token;
}

function closeWithError(socket: WSContext<WebSocket>, error: unknown): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.close(
    WebSocketCloseCodes.INTERNAL_ERROR,
    error instanceof Error ? error.message : "PTY transport request failed.",
  );
}
