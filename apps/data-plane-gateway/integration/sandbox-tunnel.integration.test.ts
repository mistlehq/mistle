/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";

import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { describe, expect } from "vitest";
import WebSocket from "ws";

import { it } from "./test-context.js";

const ConnectTimeoutMs = 4_000;
const IntegrationTestTimeoutMs = 30_000;

type FailedWebSocketConnectResult = {
  error: unknown;
  responseStatusCode: number | undefined;
};

type UnexpectedResponse = {
  statusCode?: number;
};

function connectWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      handshakeTimeout: ConnectTimeoutMs,
    });

    const onOpen = (): void => {
      socket.off("error", onError);
      socket.off("unexpected-response", onUnexpectedResponse);
      resolve(socket);
    };

    const onError = (error: Error): void => {
      socket.off("open", onOpen);
      socket.off("unexpected-response", onUnexpectedResponse);
      reject(error);
    };

    const onUnexpectedResponse = (_request: unknown, response: { statusCode?: number }): void => {
      socket.off("open", onOpen);
      socket.off("error", onError);
      reject(
        Object.assign(new Error("Websocket upgrade failed."), {
          statusCode: response.statusCode,
        }),
      );
    };

    socket.once("open", onOpen);
    socket.once("error", onError);
    socket.once("unexpected-response", onUnexpectedResponse);
  });
}

function connectWebSocketExpectFailure(url: string): Promise<FailedWebSocketConnectResult> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      handshakeTimeout: ConnectTimeoutMs,
    });

    socket.once("open", () => {
      socket.close();
      reject(new Error("Expected websocket connection to fail but it opened successfully."));
    });

    socket.once("unexpected-response", (_request: unknown, response: UnexpectedResponse) => {
      resolve({
        error: new Error("Websocket upgrade failed."),
        responseStatusCode: response.statusCode,
      });
    });

    socket.once("error", (error: Error) => {
      resolve({
        error,
        responseStatusCode: undefined,
      });
    });
  });
}

function closeWebSocket(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("close", () => {
      resolve();
    });
    socket.once("error", (error: Error) => {
      reject(error);
    });

    socket.close();
  });
}

describe("sandbox tunnel connect endpoint integration", () => {
  it(
    "accepts a valid bootstrap token and records exactly one ack",
    async ({ fixture }) => {
      const jti = randomUUID();
      const token = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti,
        ttlSeconds: 120,
      });
      const socket = await connectWebSocket(
        `${fixture.websocketBaseUrl}/tunnel/sandbox?bootstrap_token=${encodeURIComponent(token)}`,
      );

      const recordedAck = await fixture.db.query.sandboxTunnelConnectAcks.findFirst({
        where: (table, { eq }) => eq(table.bootstrapTokenJti, jti),
      });

      expect(recordedAck?.bootstrapTokenJti).toBe(jti);

      await closeWebSocket(socket);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "rejects reconnect attempts that reuse an acknowledged bootstrap token",
    async ({ fixture }) => {
      const jti = randomUUID();
      const token = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti,
        ttlSeconds: 120,
      });
      const socket = await connectWebSocket(
        `${fixture.websocketBaseUrl}/tunnel/sandbox?bootstrap_token=${encodeURIComponent(token)}`,
      );
      await closeWebSocket(socket);

      const failedConnect = await connectWebSocketExpectFailure(
        `${fixture.websocketBaseUrl}/tunnel/sandbox?bootstrap_token=${encodeURIComponent(token)}`,
      );
      const recordedAcks = await fixture.db.query.sandboxTunnelConnectAcks.findMany({
        where: (table, { eq }) => eq(table.bootstrapTokenJti, jti),
      });

      expect(failedConnect.error).toBeInstanceOf(Error);
      expect(failedConnect.responseStatusCode).toBe(409);
      expect(recordedAcks).toHaveLength(1);
    },
    IntegrationTestTimeoutMs,
  );
});
