/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  DefaultStreamWindowBytes,
  encodeDataFrame,
  PayloadKindRawBytes,
  PayloadKindWebSocketText,
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
const OperationStreamId = 0xffff_fffd;
const PersistencePollIntervalMs = 25;

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
});

describe("sandbox tunnel operation ingress integration", () => {
  it(
    "persists lifecycle and transcript operation records sent over the bootstrap tunnel",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        testId: "gateway_operation_ingress",
      });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });

      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "operation.open",
          streamId: OperationStreamId,
          operationId: "op_gateway_operation_ingress",
          operationKind: "start",
          format: "mistle.sandbox-operation.v1+jsonl",
        }),
      );

      await expect(waitForWebSocketMessage(bootstrapSocket)).resolves.toEqual({
        data: JSON.stringify({
          type: "operation.open.ok",
          streamId: OperationStreamId,
          initialWindowBytes: DefaultStreamWindowBytes,
        }),
        isBinary: false,
      });

      const payload = [
        JSON.stringify({
          kind: "lifecycle",
          observedAt: "2026-05-13T00:00:00.000Z",
          phase: "sandboxd",
          status: "started",
          message: "sandboxd started",
        }),
        JSON.stringify({
          kind: "lifecycle",
          observedAt: "2026-05-13T00:00:00.100Z",
          phase: "operation_stream",
          status: "completed",
          message: "operation stream started",
        }),
        JSON.stringify({
          kind: "lifecycle",
          observedAt: "2026-05-13T00:00:00.200Z",
          phase: "runtime_plan",
          status: "started",
          message: "runtime plan started",
          attributes: {
            commandIndex: "0",
          },
        }),
        JSON.stringify({
          kind: "transcript",
          observedAt: "2026-05-13T00:00:00.300Z",
          phase: "runtime_plan",
          stream: "stdout",
          payloadBase64: "aW5zdGFsbGluZyBkZXBlbmRlbmNpZXM=",
        }),
        JSON.stringify({
          kind: "lifecycle",
          observedAt: "2026-05-13T00:00:00.400Z",
          phase: "setup_script",
          status: "completed",
          message: "setup script completed",
        }),
        JSON.stringify({
          kind: "lifecycle",
          observedAt: "2026-05-13T00:00:00.500Z",
          phase: "ready",
          status: "started",
          message: "runtime readiness wait started",
        }),
        "",
      ].join("\n");

      await sendWebSocketMessage(
        bootstrapSocket,
        Buffer.from(
          encodeDataFrame({
            streamId: OperationStreamId,
            payloadKind: PayloadKindRawBytes,
            payload: Buffer.from(payload, "utf8"),
          }),
        ),
      );

      const persistedEvents = await waitForPersistedOperationEvents({
        env,
        expectedCount: 6,
      });

      expect(persistedEvents).toEqual([
        {
          attributes: {},
          message: "sandboxd started",
          operationId: "op_gateway_operation_ingress",
          payloadBytes: null,
          phase: "sandboxd",
          recordKind: "lifecycle",
          sequence: 1,
          status: "started",
          stream: null,
        },
        {
          attributes: {},
          message: "operation stream started",
          operationId: "op_gateway_operation_ingress",
          payloadBytes: null,
          phase: "operation_stream",
          recordKind: "lifecycle",
          sequence: 2,
          status: "completed",
          stream: null,
        },
        {
          attributes: {
            commandIndex: "0",
          },
          message: "runtime plan started",
          operationId: "op_gateway_operation_ingress",
          payloadBytes: null,
          phase: "runtime_plan",
          recordKind: "lifecycle",
          sequence: 3,
          status: "started",
          stream: null,
        },
        {
          attributes: {},
          message: "",
          operationId: "op_gateway_operation_ingress",
          payloadBytes: Buffer.from("installing dependencies", "utf8"),
          phase: "runtime_plan",
          recordKind: "transcript",
          sequence: 4,
          status: null,
          stream: "stdout",
        },
        {
          attributes: {},
          message: "setup script completed",
          operationId: "op_gateway_operation_ingress",
          payloadBytes: null,
          phase: "setup_script",
          recordKind: "lifecycle",
          sequence: 5,
          status: "completed",
          stream: null,
        },
        {
          attributes: {},
          message: "runtime readiness wait started",
          operationId: "op_gateway_operation_ingress",
          payloadBytes: null,
          phase: "ready",
          recordKind: "lifecycle",
          sequence: 6,
          status: "started",
          stream: null,
        },
      ]);

      const response = await env.dataPlaneApi.http.fetch(
        `/internal/sandbox/instances/${sandboxInstanceId}/operation-events?organizationId=org_gateway_operation_ingress&operationId=op_gateway_operation_ingress`,
        {
          headers: {
            "x-mistle-service-token": "integration-new-internal-service-token",
            [TestEnvironmentIdHeader]: env.id,
          },
        },
      );
      expect(response.status).toBe(200);
      const responseBody: unknown = await response.json();
      expect(responseBody).toMatchObject({
        events: persistedEvents.map((event) => ({
          attributes: event.attributes,
          message: event.message,
          operationId: event.operationId,
          payloadBase64: event.payloadBytes === null ? null : event.payloadBytes.toString("base64"),
          phase: event.phase,
          recordKind: event.recordKind,
          sandboxInstanceId,
          sequence: event.sequence,
          status: event.status,
          stream: event.stream,
          source: "sandboxd",
        })),
      });

      await closeWebSocket(bootstrapSocket);
    },
    TestTimeoutMs,
  );

  it(
    "resets only the operation stream when the operation payload kind is invalid",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        env,
        sandboxInstanceId,
        testId: "gateway_operation_invalid_kind",
      });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });

      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "operation.open",
          streamId: OperationStreamId,
          operationId: "op_gateway_operation_invalid_kind",
          operationKind: "start",
          format: "mistle.sandbox-operation.v1+jsonl",
        }),
      );
      await waitForWebSocketMessage(bootstrapSocket);

      await sendWebSocketMessage(
        bootstrapSocket,
        Buffer.from(
          encodeDataFrame({
            streamId: OperationStreamId,
            payloadKind: PayloadKindWebSocketText,
            payload: Buffer.from("not raw", "utf8"),
          }),
        ),
      );

      await expect(waitForWebSocketMessage(bootstrapSocket)).resolves.toEqual({
        data: JSON.stringify({
          type: "operation.reset",
          streamId: OperationStreamId,
          code: "invalid_operation_payload_kind",
          message: "Operation streams only accept raw-bytes payloads.",
        }),
        isBinary: false,
      });

      expect(bootstrapSocket.readyState).toBe(WebSocket.OPEN);
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

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}

async function waitForPersistedOperationEvents(input: {
  env: IntegrationTestEnvironment;
  expectedCount: number;
}): Promise<
  Array<{
    attributes: unknown;
    message: string;
    operationId: string;
    payloadBytes: Buffer | null;
    phase: string | null;
    recordKind: string;
    sequence: number;
    status: string | null;
    stream: string | null;
  }>
> {
  const deadline = Date.now() + TestTimeoutMs;

  while (Date.now() < deadline) {
    const persistedEvents = await input.env.dataPlaneDb
      .select({
        attributes: input.env.dataPlaneTables.sandboxOperationEvents.attributes,
        message: input.env.dataPlaneTables.sandboxOperationEvents.message,
        operationId: input.env.dataPlaneTables.sandboxOperationEvents.operationId,
        payloadBytes: input.env.dataPlaneTables.sandboxOperationEvents.payloadBytes,
        phase: input.env.dataPlaneTables.sandboxOperationEvents.phase,
        recordKind: input.env.dataPlaneTables.sandboxOperationEvents.recordKind,
        sequence: input.env.dataPlaneTables.sandboxOperationEvents.sequence,
        status: input.env.dataPlaneTables.sandboxOperationEvents.status,
        stream: input.env.dataPlaneTables.sandboxOperationEvents.stream,
      })
      .from(input.env.dataPlaneTables.sandboxOperationEvents)
      .orderBy(input.env.dataPlaneTables.sandboxOperationEvents.sequence);

    if (persistedEvents.length === input.expectedCount) {
      return persistedEvents;
    }

    await systemSleeper.sleep(PersistencePollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for ${String(input.expectedCount)} persisted sandbox operation events.`,
  );
}
