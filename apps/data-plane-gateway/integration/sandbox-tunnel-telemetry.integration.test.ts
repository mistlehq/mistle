/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses, sandboxInstances } from "@mistle/db/data-plane";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  DefaultStreamWindowBytes,
  encodeDataFrame,
  PayloadKindRawBytes,
} from "@mistle/sandbox-session-protocol";
import { systemSleeper } from "@mistle/time";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  waitForWebSocketMessage,
} from "./websocket-test-helpers.js";

const IntegrationTestTimeoutMs = 60_000;

async function insertSandboxInstanceRow(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.fixture.db.insert(sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: "org_data_plane_gateway_integration",
    sandboxProfileId: "sbp_data_plane_gateway_integration",
    sandboxProfileVersion: 1,
    runtimeProvider: input.fixture.config.sandbox.provider,
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_data_plane_gateway_integration",
    source: "webhook",
  });
}

async function connectBootstrapSocket(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}) {
  const token = await mintBootstrapToken({
    config: {
      bootstrapTokenSecret: input.fixture.config.sandbox.bootstrap.tokenSecret,
      tokenIssuer: input.fixture.config.sandbox.bootstrap.tokenIssuer,
      tokenAudience: input.fixture.config.sandbox.bootstrap.tokenAudience,
    },
    jti: randomUUID(),
    sandboxInstanceId: input.sandboxInstanceId,
    ttlSeconds: 120,
  });

  return connectSandboxTunnelWebSocket({
    websocketBaseUrl: input.fixture.websocketBaseUrl,
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "bootstrap",
    token,
  });
}

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs: number,
  failureMessage: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await systemSleeper.sleep(10);
  }

  throw new Error(failureMessage);
}

describe("sandbox tunnel telemetry ingress integration", () => {
  it(
    "exports gateway tunnel spans with connection token and relay-session correlation keys",
    async ({ fixture }) => {
      fixture.otlpRequests.length = 0;
      const sandboxInstanceId = typeid("sbi").toString();
      const connectionTokenJti = `conn-${randomUUID()}`;
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
      });
      const connectionToken = await mintConnectionToken({
        config: {
          connectionTokenSecret: fixture.config.sandbox.connect.tokenSecret,
          tokenIssuer: fixture.config.sandbox.connect.tokenIssuer,
          tokenAudience: fixture.config.sandbox.connect.tokenAudience,
        },
        jti: connectionTokenJti,
        sandboxInstanceId,
        ttlSeconds: 120,
      });

      const connectionSocket = await connectSandboxTunnelWebSocket({
        websocketBaseUrl: fixture.websocketBaseUrl,
        sandboxInstanceId,
        tokenKind: "connect",
        token: connectionToken,
      });

      await closeWebSocket(connectionSocket);

      await waitForCondition(
        () =>
          fixture.otlpRequests.some(
            (request) =>
              request.path === "/v1/traces" &&
              request.body.includes("data_plane_gateway.sandbox_tunnel.connection_session") &&
              request.body.includes(connectionTokenJti) &&
              request.body.includes("mistle.tunnel.relay_session_id"),
          ),
        10_000,
        "Expected a gateway tunnel span export with token and relay-session correlation fields.",
      );

      const otlpRequest = fixture.otlpRequests.find(
        (request) =>
          request.path === "/v1/traces" &&
          request.body.includes("data_plane_gateway.sandbox_tunnel.connection_session") &&
          request.body.includes(connectionTokenJti),
      );

      expect(otlpRequest?.body).toContain('"mistle.connection.token_jti"');
      expect(otlpRequest?.body).toContain(connectionTokenJti);
      expect(otlpRequest?.body).toContain('"mistle.tunnel.relay_session_id"');
      expect(otlpRequest?.body).toContain('"mistle.delivery.correlation_scope"');
      expect(otlpRequest?.body).toContain('"join_via_connection_token_jti"');

      await closeWebSocket(bootstrapSocket);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "forwards sandbox OTLP trace exports to the gateway traces endpoint",
    async ({ fixture }) => {
      fixture.otlpRequests.length = 0;
      const sandboxInstanceId = typeid("sbi").toString();
      const sandboxTraceId = "0123456789abcdef0123456789abcdef";
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
      });

      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "telemetry.open",
          streamId: 43,
          signal: "traces",
          format: "otlp.http.traces.v1+json",
        }),
      );

      await expect(waitForWebSocketMessage(bootstrapSocket)).resolves.toEqual({
        data: JSON.stringify({
          type: "telemetry.open.ok",
          streamId: 43,
          initialWindowBytes: DefaultStreamWindowBytes,
        }),
        isBinary: false,
      });

      const traceExportBody = `{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"@mistle/sandbox-runtime"}}]},"scopeSpans":[{"spans":[{"traceId":"${sandboxTraceId}","spanId":"0123456789abcdef","name":"sandbox.runtime.request"}]}]}]}`;

      await sendWebSocketMessage(
        bootstrapSocket,
        Buffer.from(
          encodeDataFrame({
            streamId: 43,
            payloadKind: PayloadKindRawBytes,
            payload: Buffer.from(traceExportBody, "utf8"),
          }),
        ),
      );

      await waitForCondition(
        () =>
          fixture.otlpRequests.some(
            (request) => request.path === "/v1/traces" && request.body.includes(sandboxTraceId),
          ),
        10_000,
        "Expected a forwarded OTLP trace export request.",
      );

      const otlpRequest = fixture.otlpRequests.find(
        (request) => request.path === "/v1/traces" && request.body.includes(sandboxTraceId),
      );

      expect(otlpRequest).toEqual({
        body: traceExportBody,
        path: "/v1/traces",
      });

      await closeWebSocket(bootstrapSocket);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "forwards sandbox telemetry log lines to OTLP through the gateway sink",
    async ({ fixture }) => {
      fixture.otlpRequests.length = 0;
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
      });

      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "telemetry.open",
          streamId: 41,
          signal: "logs",
          format: "mistle.sandbox-runtime.log.v1",
        }),
      );

      await expect(waitForWebSocketMessage(bootstrapSocket)).resolves.toEqual({
        data: JSON.stringify({
          type: "telemetry.open.ok",
          streamId: 41,
          initialWindowBytes: DefaultStreamWindowBytes,
        }),
        isBinary: false,
      });

      await sendWebSocketMessage(
        bootstrapSocket,
        Buffer.from(
          encodeDataFrame({
            streamId: 41,
            payloadKind: PayloadKindRawBytes,
            payload: Buffer.from(
              '{"timestamp":"2026-04-02T09:00:00.000Z","level":"warn","event":"sandbox_runtime_slow_start","elapsedMs":1200,"startupMode":"warm","retryable":false,"reason":null}\n',
              "utf8",
            ),
          }),
        ),
      );

      await waitForCondition(
        () => fixture.otlpRequests.length === 1,
        10_000,
        "Expected a forwarded OTLP log export request.",
      );

      const otlpRequest = fixture.otlpRequests[0];

      expect(otlpRequest).toEqual({
        body: otlpRequest?.body,
        path: "/v1/logs",
      });
      expect(otlpRequest?.body).toContain("@mistle/sandboxd");
      expect(otlpRequest?.body).toContain('"service.name"');
      expect(otlpRequest?.body).toContain('"deployment.environment"');
      expect(otlpRequest?.body).toContain('"integration"');
      expect(otlpRequest?.body).toContain('"mistle.telemetry.ingest"');
      expect(otlpRequest?.body).toContain('"gateway-tunnel"');
      expect(otlpRequest?.body).toContain('"severityNumber":13');
      expect(otlpRequest?.body).toContain('"severityText":"WARN"');
      expect(otlpRequest?.body).toContain('"mistle.sandbox.instance.id"');
      expect(otlpRequest?.body).toContain(sandboxInstanceId);
      expect(otlpRequest?.body).toContain('"mistle.gateway.node.id"');
      expect(otlpRequest?.body).toContain('"mistle.tunnel.relay_session_id"');
      expect(otlpRequest?.body).toContain('"mistle.telemetry.transport"');
      expect(otlpRequest?.body).toContain('"bootstrap_tunnel"');
      expect(otlpRequest?.body).toContain('"mistle.telemetry.signal"');
      expect(otlpRequest?.body).toContain('"logs"');
      expect(otlpRequest?.body).toContain('"mistle.sandbox.log.event"');
      expect(otlpRequest?.body).toContain('"sandbox_runtime_slow_start"');
      expect(otlpRequest?.body).toContain('"mistle.sandbox.log.elapsedMs"');
      expect(otlpRequest?.body).toContain('"intValue":1200');
      expect(otlpRequest?.body).toContain('"mistle.sandbox.log.startupMode"');
      expect(otlpRequest?.body).toContain('"warm"');
      expect(otlpRequest?.body).toContain('"mistle.sandbox.log.retryable"');
      expect(otlpRequest?.body).toContain('"boolValue":false');
      expect(otlpRequest?.body).toContain('"mistle.sandbox.log.reason"');

      await closeWebSocket(bootstrapSocket);
    },
    IntegrationTestTimeoutMs,
  );

  it(
    "resets unknown bootstrap telemetry data streams",
    async ({ fixture }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        fixture,
        sandboxInstanceId,
      });
      const bootstrapSocket = await connectBootstrapSocket({
        fixture,
        sandboxInstanceId,
      });

      await sendWebSocketMessage(
        bootstrapSocket,
        Buffer.from(
          encodeDataFrame({
            streamId: 41,
            payloadKind: PayloadKindRawBytes,
            payload: new Uint8Array([1, 2, 3]),
          }),
        ),
      );

      await expect(waitForWebSocketMessage(bootstrapSocket)).resolves.toEqual({
        data: JSON.stringify({
          type: "telemetry.reset",
          streamId: 41,
          code: "telemetry_stream_not_found",
          message: "Telemetry stream 41 is not open on this bootstrap session.",
        }),
        isBinary: false,
      });

      await closeWebSocket(bootstrapSocket);
    },
    IntegrationTestTimeoutMs,
  );
});
