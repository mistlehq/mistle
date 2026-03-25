import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses, sandboxInstances } from "@mistle/db/data-plane";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import { systemSleeper } from "@mistle/time";
import { expect } from "vitest";
import WebSocket from "ws";
import { z } from "zod";

import type { DataPlaneGatewayIntegrationFixture } from "./test-context.js";
import { connectSandboxTunnelWebSocket } from "./websocket-test-helpers.js";

export const RuntimeStateRouteTestTimeoutMs = 40_000;

export const RuntimeStateSnapshotSchema = z
  .object({
    ownerLeaseId: z.string().min(1).nullable(),
    attachment: z
      .object({
        sandboxInstanceId: z.string().min(1),
        ownerLeaseId: z.string().min(1),
        nodeId: z.string().min(1),
        sessionId: z.string().min(1),
        attachedAtMs: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export type RuntimeStateSnapshot = z.infer<typeof RuntimeStateSnapshotSchema>;

const RuntimeStateReadTimeoutMs = 5_000;
const RuntimeStateReadPollIntervalMs = 50;
const InternalServiceTokenHeader = "x-mistle-service-token";

export async function insertSandboxInstanceRow(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  testId: string;
}): Promise<void> {
  await input.fixture.db.insert(sandboxInstances).values({
    id: input.sandboxInstanceId,
    organizationId: `org_${input.testId}`,
    sandboxProfileId: `sbp_${input.testId}`,
    sandboxProfileVersion: 1,
    runtimeProvider: input.fixture.config.sandbox.provider,
    providerSandboxId: `provider-${input.sandboxInstanceId}`,
    status: SandboxInstanceStatuses.STARTING,
    startedByKind: "system",
    startedById: `workflow_${input.testId}`,
    source: "webhook",
  });
}

export async function mintValidBootstrapToken(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<string> {
  return mintBootstrapToken({
    config: {
      bootstrapTokenSecret: input.fixture.config.sandbox.bootstrap.tokenSecret,
      tokenIssuer: input.fixture.config.sandbox.bootstrap.tokenIssuer,
      tokenAudience: input.fixture.config.sandbox.bootstrap.tokenAudience,
    },
    jti: randomUUID(),
    sandboxInstanceId: input.sandboxInstanceId,
    ttlSeconds: 120,
  });
}

export async function readRuntimeState(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
}): Promise<RuntimeStateSnapshot> {
  const response = await fetch(
    `${input.fixture.baseUrl}/internal/sandbox-instances/${encodeURIComponent(input.sandboxInstanceId)}/runtime-state`,
    {
      headers: {
        [InternalServiceTokenHeader]: input.fixture.config.internalAuth.serviceToken,
      },
    },
  );

  expect(response.status).toBe(200);
  return RuntimeStateSnapshotSchema.parse(await response.json());
}

export async function waitForRuntimeState(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  predicate: (snapshot: RuntimeStateSnapshot) => boolean;
}): Promise<RuntimeStateSnapshot> {
  const deadline = Date.now() + RuntimeStateReadTimeoutMs;

  while (Date.now() < deadline) {
    const snapshot = await readRuntimeState({
      fixture: input.fixture,
      sandboxInstanceId: input.sandboxInstanceId,
    });
    if (input.predicate(snapshot)) {
      return snapshot;
    }

    await systemSleeper.sleep(RuntimeStateReadPollIntervalMs);
  }

  throw new Error(
    `Timed out waiting for runtime-state snapshot for sandbox '${input.sandboxInstanceId}'.`,
  );
}

export function connectBootstrapSocket(input: {
  fixture: DataPlaneGatewayIntegrationFixture;
  sandboxInstanceId: string;
  token: string;
  autoPong?: boolean;
}): Promise<WebSocket> {
  return connectSandboxTunnelWebSocket({
    websocketBaseUrl: input.fixture.websocketBaseUrl,
    sandboxInstanceId: input.sandboxInstanceId,
    tokenKind: "bootstrap",
    token: input.token,
    ...(input.autoPong === undefined ? {} : { autoPong: input.autoPong }),
  });
}
