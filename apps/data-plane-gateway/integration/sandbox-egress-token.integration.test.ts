/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintBootstrapToken, verifyEgressToken } from "@mistle/gateway-tunnel-auth";
import {
  TestEnvironmentIdHeader,
  createIntegrationTest,
  type IntegrationTestEnvironment,
} from "@mistle/test-harness/integration";
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
const EgressTokenSecret = "integration-new-egress-token-secret";
const EgressTokenIssuer = "integration-new-data-plane-gateway";
const EgressTokenAudience = "integration-new-gateway-egress";

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
});

describe("sandbox egress token control integration", () => {
  it(
    "returns a short-lived egress token over an active bootstrap tunnel",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        env,
        organizationId: "org_gateway_egress_token",
        sandboxInstanceId,
      });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });

      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "egress.token.request",
          requestId: "egress_token_req_123",
        }),
      );

      const response = await waitForWebSocketMessage(bootstrapSocket);
      expect(response.isBinary).toBe(false);
      const payload: unknown = JSON.parse(String(response.data));
      expect(payload).toMatchObject({
        type: "egress.token.response",
        requestId: "egress_token_req_123",
      });
      const parsedPayload = parseEgressTokenResponse(payload);
      const verified = await verifyEgressToken({
        config: {
          tokenSecret: EgressTokenSecret,
          tokenIssuer: EgressTokenIssuer,
          tokenAudience: EgressTokenAudience,
        },
        token: parsedPayload.token,
      });

      expect(verified).toEqual({
        sub: sandboxInstanceId,
        organizationId: "org_gateway_egress_token",
        bootstrapSessionId: expect.any(String),
        expiresAt: new Date(parsedPayload.expiresAt),
      });
      expect(new Date(parsedPayload.expiresAt).getTime()).toBeGreaterThan(Date.now());
      expect(parsedPayload.ttlMs).toBe(300_000);

      await closeWebSocket(bootstrapSocket);
    },
    TestTimeoutMs,
  );

  it(
    "preserves acting-user context from an egress token request",
    async ({ env }) => {
      const sandboxInstanceId = typeid("sbi").toString();
      await insertSandboxInstanceRow({
        env,
        organizationId: "org_gateway_egress_token_acting_user",
        sandboxInstanceId,
      });
      const bootstrapSocket = await connectBootstrapSocket({
        env,
        sandboxInstanceId,
      });

      await sendWebSocketMessage(
        bootstrapSocket,
        JSON.stringify({
          type: "egress.token.request",
          requestId: "egress_token_req_acting_user",
          actingUserId: "usr_gateway_egress_token",
        }),
      );

      const response = await waitForWebSocketMessage(bootstrapSocket);
      expect(response.isBinary).toBe(false);
      const parsedPayload = parseEgressTokenResponse(JSON.parse(String(response.data)));
      const verified = await verifyEgressToken({
        config: {
          tokenSecret: EgressTokenSecret,
          tokenIssuer: EgressTokenIssuer,
          tokenAudience: EgressTokenAudience,
        },
        token: parsedPayload.token,
      });

      expect(verified).toEqual({
        sub: sandboxInstanceId,
        organizationId: "org_gateway_egress_token_acting_user",
        bootstrapSessionId: expect.any(String),
        actingUserId: "usr_gateway_egress_token",
        expiresAt: new Date(parsedPayload.expiresAt),
      });

      await closeWebSocket(bootstrapSocket);
    },
    TestTimeoutMs,
  );
});

function parseEgressTokenResponse(value: unknown): {
  token: string;
  expiresAt: string;
  ttlMs: number;
} {
  if (
    value === null ||
    typeof value !== "object" ||
    !("token" in value) ||
    typeof value.token !== "string" ||
    !("expiresAt" in value) ||
    typeof value.expiresAt !== "string" ||
    !("ttlMs" in value) ||
    typeof value.ttlMs !== "number"
  ) {
    throw new Error("Expected egress token response payload.");
  }

  return {
    token: value.token,
    expiresAt: value.expiresAt,
    ttlMs: value.ttlMs,
  };
}

async function insertSandboxInstanceRow(input: {
  env: IntegrationTestEnvironment;
  organizationId: string;
  sandboxInstanceId: string;
}): Promise<void> {
  await input.env.dataPlaneDb.insert(input.env.dataPlaneTables.sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: input.organizationId,
    sandboxProfileId: "sbp_gateway_egress_token",
    sandboxProfileVersion: 1,
    runtimeProvider: "docker",
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: "workflow_gateway_egress_token",
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
