/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";

import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { describe, expect } from "vitest";

import { it } from "./test-context.js";
import {
  closeWebSocket,
  connectWebSocket,
  connectWebSocketExpectFailure,
} from "./websocket-test-helpers.js";

const IntegrationTestTimeoutMs = 30_000;

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
    "accepts a valid connection token and records exactly one ack",
    async ({ fixture }) => {
      const jti = randomUUID();
      const token = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti,
        ttlSeconds: 120,
      });
      const socket = await connectWebSocket(
        `${fixture.websocketBaseUrl}/tunnel/sandbox?connect_token=${encodeURIComponent(token)}`,
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
    "rejects requests that include both bootstrap and connection token query params",
    async ({ fixture }) => {
      const bootstrapToken = await mintBootstrapToken({
        config: {
          bootstrapTokenSecret: fixture.config.sandbox.bootstrap.tokenSecret,
          tokenIssuer: fixture.config.sandbox.bootstrap.tokenIssuer,
          tokenAudience: fixture.config.sandbox.bootstrap.tokenAudience,
        },
        jti: randomUUID(),
        ttlSeconds: 120,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: randomUUID(),
        ttlSeconds: 120,
      });

      const failedConnect = await connectWebSocketExpectFailure(
        `${fixture.websocketBaseUrl}/tunnel/sandbox?bootstrap_token=${encodeURIComponent(bootstrapToken)}&connect_token=${encodeURIComponent(connectionToken)}`,
      );

      expect(failedConnect.error).toBeInstanceOf(Error);
      expect(failedConnect.responseStatusCode).toBe(400);
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

  it(
    "rejects reconnect attempts that reuse an acknowledged connection token",
    async ({ fixture }) => {
      const jti = randomUUID();
      const token = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti,
        ttlSeconds: 120,
      });
      const socket = await connectWebSocket(
        `${fixture.websocketBaseUrl}/tunnel/sandbox?connect_token=${encodeURIComponent(token)}`,
      );
      await closeWebSocket(socket);

      const failedConnect = await connectWebSocketExpectFailure(
        `${fixture.websocketBaseUrl}/tunnel/sandbox?connect_token=${encodeURIComponent(token)}`,
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
