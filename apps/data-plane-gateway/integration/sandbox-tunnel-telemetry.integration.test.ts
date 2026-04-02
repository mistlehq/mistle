/* eslint-disable jest/no-standalone-expect --
 * This suite uses an extended integration `it` fixture imported from test context.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses, sandboxInstances } from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { encodeDataFrame, PayloadKindRawBytes } from "@mistle/sandbox-session-protocol";
import { typeid } from "typeid-js";
import { describe, expect } from "vitest";

import { it, type DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  waitForWebSocketMessage,
} from "./websocket-test-helpers.js";

const IntegrationTestTimeoutMs = 30_000;

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

describe("sandbox tunnel telemetry ingress integration", () => {
  it(
    "accepts telemetry.open with the gateway local no-op sink",
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
          initialWindowBytes: 65536,
        }),
        isBinary: false,
      });

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
