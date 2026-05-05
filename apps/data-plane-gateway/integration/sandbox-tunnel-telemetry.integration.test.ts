/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  DefaultStreamWindowBytes,
  encodeDataFrame,
  PayloadKindRawBytes,
} from "@mistle/sandbox-session-protocol";
import {
  TestEnvironmentIdHeader,
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
import { systemSleeper } from "@mistle/time";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";
import WebSocket from "ws";

import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  waitForWebSocketMessage,
} from "../integration/websocket-test-helpers.js";

const TestTimeoutMs = 60_000;
const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";
const ConnectionTokenSecret = "integration-new-connection-secret";
const ConnectionTokenIssuer = "integration-new-control-plane-api";

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
  extraInfra: ["otlp"],
});

describe("sandbox tunnel telemetry integration", () => {
  it(
    "exports gateway tunnel spans with connection token and relay-session correlation keys",
    async ({ env }) => {
      env.otlpCollector.clear();
      const sandboxInstanceId = typeid("sbi").toString();
      const connectionTokenJti = `conn-${randomUUID()}`;
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        testId: "gateway_telemetry_span",
      });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });
      const connectionSocket = await connectConnectionSocket({
        env,
        connectionTokenJti,
        sandboxInstanceId,
      });

      await closeWebSocket(connectionSocket);

      await waitForCondition(
        () =>
          env.otlpCollector.requests.some(
            (request) =>
              request.path === "/v1/traces" &&
              request.body.includes("data_plane_gateway.sandbox_tunnel.connection_session") &&
              request.body.includes(connectionTokenJti) &&
              request.body.includes("mistle.tunnel.relay_session_id"),
          ),
        "Expected a gateway tunnel span export with token and relay-session correlation fields.",
      );

      const otlpRequest = env.otlpCollector.requests.find(
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
    TestTimeoutMs,
  );

  it(
    "forwards sandbox OTLP trace exports to the gateway traces endpoint",
    async ({ env }) => {
      env.otlpCollector.clear();
      const sandboxInstanceId = typeid("sbi").toString();
      const sandboxTraceId = "0123456789abcdef0123456789abcdef";
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        testId: "gateway_telemetry_trace",
      });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
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
          env.otlpCollector.requests.some(
            (request) => request.path === "/v1/traces" && request.body.includes(sandboxTraceId),
          ),
        "Expected a forwarded OTLP trace export request.",
      );

      const otlpRequest = env.otlpCollector.requests.find(
        (request) => request.path === "/v1/traces" && request.body.includes(sandboxTraceId),
      );

      expect(otlpRequest).toEqual({
        body: traceExportBody,
        path: "/v1/traces",
      });

      await closeWebSocket(bootstrapSocket);
    },
    TestTimeoutMs,
  );

  it(
    "forwards sandbox telemetry log lines to OTLP through the gateway sink",
    async ({ env }) => {
      env.otlpCollector.clear();
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        testId: "gateway_telemetry_logs",
      });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
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
        () => env.otlpCollector.requests.some((request) => request.path === "/v1/logs"),
        "Expected a forwarded OTLP log export request.",
      );

      const otlpRequest = env.otlpCollector.requests.find((request) => request.path === "/v1/logs");

      expect(otlpRequest?.body).toContain("@mistle/sandboxd");
      expect(otlpRequest?.body).toContain('"service.name"');
      expect(otlpRequest?.body).toContain('"deployment.environment"');
      expect(otlpRequest?.body).toContain('"integration-new"');
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
    TestTimeoutMs,
  );

  it(
    "resets unknown bootstrap telemetry data streams",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        testId: "gateway_telemetry_reset",
      });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
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
    TestTimeoutMs,
  );
});

async function insertSandboxInstanceRow(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  testId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: `org_${input.testId}`,
    sandboxProfileId: `sbp_${input.testId}`,
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: `workflow_${input.testId}`,
    source: "webhook",
  });
}

async function connectBootstrapSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl),
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "bootstrap",
    token: await mintBootstrapToken({
      config: {
        bootstrapTokenSecret: BootstrapTokenSecret,
        tokenIssuer: BootstrapTokenIssuer,
        tokenAudience: GatewayTokenAudience,
      },
      jti: randomUUID(),
      sandboxInstanceId: input.sandboxInstanceId,
      ttlSeconds: 120,
    }),
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

async function connectConnectionSocket(input: {
  env: IntegrationTestEnvironment;
  connectionTokenJti: string;
  sandboxInstanceId: string;
}): Promise<WebSocket> {
  return connectSandboxTunnelWebSocket({
    websocketBaseUrl: createWebSocketBaseUrl(input.env.dataPlaneGateway.hostBaseUrl),
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "connect",
    token: await mintConnectionToken({
      config: {
        connectionTokenSecret: ConnectionTokenSecret,
        tokenIssuer: ConnectionTokenIssuer,
        tokenAudience: GatewayTokenAudience,
      },
      jti: input.connectionTokenJti,
      sandboxInstanceId: input.sandboxInstanceId,
      ttlSeconds: 120,
    }),
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
  });
}

async function waitForCondition(predicate: () => boolean, failureMessage: string): Promise<void> {
  const deadline = Date.now() + 10_000;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await systemSleeper.sleep(10);
  }

  throw new Error(failureMessage);
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}
