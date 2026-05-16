/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { SandboxInstanceStatuses } from "@mistle/db/data-plane";
import { mintConnectionToken } from "@mistle/gateway-connection-auth";
import { mintBootstrapToken } from "@mistle/gateway-tunnel-auth";
import {
  SandboxRuntimeStateSnapshotSchema,
  type SandboxRuntimeStateSnapshot,
} from "@mistle/sandbox-runtime-contract";
import {
  TestEnvironmentIdHeader,
  type IntegrationTestEnvironment,
  createIntegrationTest,
} from "@mistle/test-harness/integration";
import { systemSleeper } from "@mistle/time";
import { typeid } from "typeid-js";
import { expect } from "vitest";
import WebSocket from "ws";
import { z } from "zod";

import {
  closeWebSocket,
  connectSandboxTunnelWebSocket,
  sendWebSocketMessage,
  waitForWebSocketClose,
} from "../integration/websocket-test-helpers.js";

const TestTimeoutMs = 40_000;
const RuntimeStateReadTimeoutMs = 5_000;
const RuntimeStateReadPollIntervalMs = 50;
const InternalServiceTokenHeader = "x-mistle-service-token";
const BootstrapTokenSecret = "integration-new-bootstrap-token-secret";
const BootstrapTokenIssuer = "integration-new-data-plane-worker";
const GatewayTokenAudience = "integration-new-data-plane-gateway";
const ConnectionTokenSecret = "integration-new-connection-secret";
const ConnectionTokenIssuer = "integration-new-control-plane-api";
const TerminateBootstrapAttachmentResponseSchema = z
  .object({
    outcome: z.enum(["terminated", "closed", "not_attached", "fence_mismatch"]),
  })
  .strict();

const it = createIntegrationTest({
  services: ["data-plane-api", "data-plane-gateway"],
});

it(
  "reports and clears the active bootstrap runtime attachment",
  async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      env,
      sandboxInstanceId,
      testId: "runtime_state_route_attachment",
    });

    const bootstrapSocket = await connectBootstrapSocket({
      env,
      sandboxInstanceId,
    });

    const attached = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
    });

    expect(attached.ownerLeaseId).not.toBeNull();
    expect(attached.attachment?.sandboxInstanceId).toBe(sandboxInstanceId);
    expect(attached.attachment?.ownerLeaseId).toBe(attached.ownerLeaseId);
    expect(attached.attachment?.nodeId).toMatch(/^dpg_/u);
    expect(attached.attachment?.sessionId).toMatch(/^dts_/u);

    await closeWebSocket(bootstrapSocket);

    const cleared = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) => snapshot.ownerLeaseId === null && snapshot.attachment === null,
    });

    expect(cleared).toEqual({
      ownerLeaseId: null,
      attachment: null,
      presence: {
        activeCount: 0,
      },
      keepalive: {
        active: false,
      },
      runtime: {
        ready: false,
      },
    });
  },
  TestTimeoutMs,
);

it(
  "terminates the active bootstrap attachment through the fenced internal route",
  async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      env,
      sandboxInstanceId,
      testId: "runtime_state_route_terminate",
    });

    const bootstrapSocket = await connectBootstrapSocket({
      env,
      sandboxInstanceId,
    });
    const attached = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
    });
    if (attached.attachment === null) {
      throw new Error("Expected bootstrap attachment before termination.");
    }

    const closeEvent = waitForWebSocketClose(bootstrapSocket);
    const terminated = await terminateBootstrapAttachment({
      env,
      sandboxInstanceId,
      expectedOwnerLeaseId: attached.attachment.ownerLeaseId,
      expectedSessionId: attached.attachment.sessionId,
    });

    expect(["terminated", "closed"]).toContain(terminated.outcome);
    await expect(closeEvent).resolves.toEqual({
      code: 1012,
      reason: "Sandbox stopped.",
    });

    const cleared = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) => snapshot.ownerLeaseId === null && snapshot.attachment === null,
    });

    expect(cleared.ownerLeaseId).toBeNull();
    expect(cleared.attachment).toBeNull();
  },
  TestTimeoutMs,
);

it(
  "leaves the active bootstrap attachment open when termination is fenced to a stale session",
  async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      env,
      sandboxInstanceId,
      testId: "runtime_state_route_terminate_fence",
    });

    const bootstrapSocket = await connectBootstrapSocket({
      env,
      sandboxInstanceId,
    });
    const attached = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
    });
    if (attached.attachment === null) {
      throw new Error("Expected bootstrap attachment before fenced termination.");
    }

    const rejected = await terminateBootstrapAttachment({
      env,
      sandboxInstanceId,
      expectedOwnerLeaseId: attached.attachment.ownerLeaseId,
      expectedSessionId: `${attached.attachment.sessionId}-stale`,
    });
    expect(rejected).toEqual({
      outcome: "fence_mismatch",
    });

    const stillAttached = await readRuntimeState({
      env,
      sandboxInstanceId,
    });
    expect(stillAttached.attachment?.ownerLeaseId).toBe(attached.attachment.ownerLeaseId);
    expect(stillAttached.attachment?.sessionId).toBe(attached.attachment.sessionId);
    expect(bootstrapSocket.readyState).toBe(WebSocket.OPEN);

    await closeWebSocket(bootstrapSocket);
  },
  TestTimeoutMs,
);

it(
  "keeps the replacement bootstrap attachment when the stale socket closes",
  async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      env,
      sandboxInstanceId,
      testId: "runtime_state_route_replacement",
    });

    const firstSocket = await connectBootstrapSocket({
      env,
      sandboxInstanceId,
    });
    const firstSnapshot = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
    });
    const firstOwnerLeaseId = firstSnapshot.ownerLeaseId;
    if (firstOwnerLeaseId === null) {
      throw new Error("Expected the first bootstrap connection to establish an owner lease.");
    }

    const firstSocketClose = waitForWebSocketClose(firstSocket);
    const secondSocket = await connectBootstrapSocket({
      env,
      sandboxInstanceId,
    });

    const secondSnapshot = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) =>
        snapshot.ownerLeaseId !== null &&
        snapshot.ownerLeaseId !== firstOwnerLeaseId &&
        snapshot.attachment?.ownerLeaseId === snapshot.ownerLeaseId,
    });

    expect(secondSnapshot.ownerLeaseId).not.toBe(firstOwnerLeaseId);
    expect(secondSnapshot.attachment?.ownerLeaseId).toBe(secondSnapshot.ownerLeaseId);
    await expect(firstSocketClose).resolves.toEqual({
      code: 1012,
      reason: "Replaced by newer sandbox tunnel connection.",
    });

    const stillAttached = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) =>
        snapshot.ownerLeaseId === secondSnapshot.ownerLeaseId &&
        snapshot.attachment?.ownerLeaseId === secondSnapshot.ownerLeaseId,
    });

    expect(stillAttached.ownerLeaseId).toBe(secondSnapshot.ownerLeaseId);
    expect(stillAttached.attachment?.ownerLeaseId).toBe(secondSnapshot.ownerLeaseId);

    await closeWebSocket(secondSocket);
  },
  TestTimeoutMs,
);

it(
  "does not expose stale keepalive state after a replacement bootstrap attaches",
  async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      env,
      sandboxInstanceId,
      testId: "runtime_state_route_keepalive",
    });

    const firstSocket = await connectBootstrapSocket({
      env,
      sandboxInstanceId,
    });
    const firstSnapshot = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) => snapshot.ownerLeaseId !== null && snapshot.attachment !== null,
    });
    const firstOwnerLeaseId = firstSnapshot.ownerLeaseId;
    if (firstOwnerLeaseId === null) {
      throw new Error("Expected the first bootstrap connection to establish an owner lease.");
    }

    await sendWebSocketMessage(
      firstSocket,
      JSON.stringify({
        type: "keepalive.state",
        ttlMs: 30_000,
        active: true,
      }),
    );

    const activeKeepalive = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) =>
        snapshot.ownerLeaseId === firstOwnerLeaseId &&
        snapshot.attachment?.ownerLeaseId === firstOwnerLeaseId &&
        snapshot.keepalive.active,
    });
    expect(activeKeepalive.keepalive.active).toBe(true);

    const firstSocketClose = waitForWebSocketClose(firstSocket);
    const secondSocket = await connectBootstrapSocket({
      env,
      sandboxInstanceId,
    });

    const replacementSnapshot = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) =>
        snapshot.ownerLeaseId !== null &&
        snapshot.ownerLeaseId !== firstOwnerLeaseId &&
        snapshot.attachment?.ownerLeaseId === snapshot.ownerLeaseId &&
        snapshot.keepalive.active === false,
    });

    expect(replacementSnapshot.ownerLeaseId).not.toBe(firstOwnerLeaseId);
    expect(replacementSnapshot.keepalive.active).toBe(false);
    await expect(firstSocketClose).resolves.toEqual({
      code: 1012,
      reason: "Replaced by newer sandbox tunnel connection.",
    });

    await closeWebSocket(secondSocket);
  },
  TestTimeoutMs,
);

it(
  "reports connected client presence until the last connection closes",
  async ({ env }) => {
    const sandboxInstanceId = typeid("sbi").toString();
    await insertSandboxInstanceRow({
      env,
      sandboxInstanceId,
      testId: "runtime_state_route_presence",
    });

    const bootstrapSocket = await connectBootstrapSocket({
      env,
      sandboxInstanceId,
    });
    const firstConnectionSocket = await connectConnectionSocket({
      env,
      sandboxInstanceId,
    });

    const firstPresence = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) => snapshot.presence.activeCount === 1,
    });
    expect(firstPresence.presence.activeCount).toBe(1);

    const secondConnectionSocket = await connectConnectionSocket({
      env,
      sandboxInstanceId,
    });
    const secondPresence = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) => snapshot.presence.activeCount === 2,
    });
    expect(secondPresence.presence.activeCount).toBe(2);

    await closeWebSocket(firstConnectionSocket);
    const afterFirstClose = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) => snapshot.presence.activeCount === 1,
    });
    expect(afterFirstClose.presence.activeCount).toBe(1);

    await closeWebSocket(secondConnectionSocket);
    const afterSecondClose = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) => snapshot.presence.activeCount === 0,
    });
    expect(afterSecondClose.presence.activeCount).toBe(0);

    await closeWebSocket(bootstrapSocket);
    const afterBootstrapClose = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) => snapshot.attachment === null,
    });
    expect(afterBootstrapClose.attachment).toBeNull();
  },
  TestTimeoutMs,
);

it("releases connection presence when the websocket stops responding to health checks", async ({
  env,
}) => {
  const sandboxInstanceId = typeid("sbi").toString();
  await insertSandboxInstanceRow({
    env,
    sandboxInstanceId,
    testId: "runtime_state_route_unresponsive_presence",
  });

  const bootstrapSocket = await connectBootstrapSocket({
    env,
    sandboxInstanceId,
  });
  const connectionSocket = await connectConnectionSocket({
    env,
    sandboxInstanceId,
    autoPong: false,
  });

  try {
    const activePresence = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) => snapshot.presence.activeCount === 1,
    });
    expect(activePresence.presence.activeCount).toBe(1);

    await expect(waitForWebSocketClose(connectionSocket)).resolves.toEqual({
      code: 1011,
      reason: "Sandbox connection websocket stopped responding to ping.",
    });

    const releasedPresence = await waitForRuntimeState({
      env,
      sandboxInstanceId,
      predicate: (snapshot) => snapshot.presence.activeCount === 0,
    });
    expect(releasedPresence.presence.activeCount).toBe(0);
  } finally {
    await Promise.all([closeIfOpen(connectionSocket), closeIfOpen(bootstrapSocket)]);
  }
}, 30_000);

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
  autoPong?: boolean;
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
    ...(input.autoPong === undefined ? {} : { autoPong: input.autoPong }),
  });
}

async function connectConnectionSocket(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  autoPong?: boolean;
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
      jti: randomUUID(),
      sandboxInstanceId: input.sandboxInstanceId,
      ttlSeconds: 120,
    }),
    headers: {
      [TestEnvironmentIdHeader]: input.env.id,
    },
    ...(input.autoPong === undefined ? {} : { autoPong: input.autoPong }),
  });
}

async function readRuntimeState(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
}): Promise<SandboxRuntimeStateSnapshot> {
  const response = await input.env.dataPlaneGateway.http.fetch(
    `/internal/sandbox-instances/${encodeURIComponent(input.sandboxInstanceId)}/runtime-state`,
    {
      headers: {
        [InternalServiceTokenHeader]: "integration-new-internal-service-token",
        [TestEnvironmentIdHeader]: input.env.id,
      },
    },
  );

  expect(response.status).toBe(200);
  return SandboxRuntimeStateSnapshotSchema.parse(await response.json());
}

async function terminateBootstrapAttachment(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  expectedOwnerLeaseId: string;
  expectedSessionId: string;
}): Promise<z.infer<typeof TerminateBootstrapAttachmentResponseSchema>> {
  const response = await input.env.dataPlaneGateway.http.fetch(
    `/internal/sandbox-instances/${encodeURIComponent(input.sandboxInstanceId)}/bootstrap-attachment/terminate`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [InternalServiceTokenHeader]: "integration-new-internal-service-token",
        [TestEnvironmentIdHeader]: input.env.id,
      },
      body: JSON.stringify({
        expectedOwnerLeaseId: input.expectedOwnerLeaseId,
        expectedSessionId: input.expectedSessionId,
      }),
    },
  );

  expect(response.status).toBe(200);
  return TerminateBootstrapAttachmentResponseSchema.parse(await response.json());
}

async function waitForRuntimeState(input: {
  env: IntegrationTestEnvironment;
  sandboxInstanceId: string;
  predicate: (snapshot: SandboxRuntimeStateSnapshot) => boolean;
}): Promise<SandboxRuntimeStateSnapshot> {
  const deadline = Date.now() + RuntimeStateReadTimeoutMs;

  while (Date.now() < deadline) {
    const snapshot = await readRuntimeState({
      env: input.env,
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

async function closeIfOpen(socket: WebSocket | undefined): Promise<void> {
  if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  await closeWebSocket(socket);
}

function createWebSocketBaseUrl(httpBaseUrl: string): string {
  const url = new URL(httpBaseUrl);
  url.protocol = "ws:";
  return url.toString().replace(/\/$/u, "");
}
