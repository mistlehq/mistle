import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { createMutableClock, createManualScheduler } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { DataPlaneApiReconcileSandboxClient } from "../clients/data-plane-api-reconcile-sandbox-client.js";
import { DataPlaneApiStopSandboxClient } from "../clients/data-plane-api-stop-sandbox-client.js";
import { InMemorySandboxActivityStore } from "../runtime-state/adapters/in-memory-sandbox-activity-store.js";
import { InMemorySandboxPresenceStore } from "../runtime-state/adapters/in-memory-sandbox-presence-store.js";
import { InMemorySandboxRuntimeAttachmentStore } from "../runtime-state/adapters/in-memory-sandbox-runtime-attachment-store.js";
import { InMemorySandboxOwnerStore } from "../tunnel/ownership/adapters/in-memory-sandbox-owner-store.js";
import { LocalSandboxIdleController } from "./sandbox-idle-controller.js";

type CapturedSandboxLifecycleRequest = {
  method: string;
  path: string;
  headers: Readonly<Record<string, string | undefined>>;
  body: unknown;
};

type StartedSandboxLifecycleCommandServer = {
  baseUrl: string;
  requests: CapturedSandboxLifecycleRequest[];
  stop(): Promise<void>;
};

async function flushAsyncSchedulerWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error(failureMessage);
}

function readHeaderRecord(request: IncomingMessage): Readonly<Record<string, string | undefined>> {
  const result: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string") {
      result[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      result[key] = value.join(", ");
      continue;
    }

    result[key] = undefined;
  }

  return result;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];

  for await (const chunk of request) {
    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    chunks.push(chunk);
  }

  const bodyText = Buffer.concat(chunks).toString("utf8");
  if (bodyText.length === 0) {
    return undefined;
  }

  return JSON.parse(bodyText);
}

function writeAcceptedJson(response: ServerResponse, body: unknown): void {
  response.statusCode = 200;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

async function startSandboxLifecycleCommandServer(input: {
  host: string;
  serviceToken: string;
}): Promise<StartedSandboxLifecycleCommandServer> {
  const requests: CapturedSandboxLifecycleRequest[] = [];

  const server = createServer(async (request, response) => {
    if (request.headers["x-mistle-service-token"] !== input.serviceToken) {
      response.statusCode = 401;
      response.end("unauthorized");
      return;
    }

    const body = await readJsonBody(request);
    const method = request.method ?? "GET";
    const path = request.url ?? "/";

    requests.push({
      method,
      path,
      headers: readHeaderRecord(request),
      body,
    });

    if (method === "POST" && path.endsWith("/stop")) {
      const sandboxInstanceId = path.split("/")[4];
      writeAcceptedJson(response, {
        status: "accepted",
        sandboxInstanceId,
        workflowRunId: "wr_stop_test_001",
      });
      return;
    }

    if (method === "POST" && path.endsWith("/reconcile")) {
      const sandboxInstanceId = path.split("/")[4];
      writeAcceptedJson(response, {
        status: "accepted",
        sandboxInstanceId,
        workflowRunId: "wr_reconcile_test_001",
      });
      return;
    }

    response.statusCode = 404;
    response.end("not found");
  });

  const address = await new Promise<{ port: number }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, input.host, () => {
      const resolvedAddress = server.address();
      if (resolvedAddress === null || typeof resolvedAddress === "string") {
        reject(new Error("Failed to resolve command server address."));
        return;
      }

      server.off("error", reject);
      resolve({ port: resolvedAddress.port });
    });
  });

  return {
    baseUrl: `http://${input.host}:${String(address.port)}`,
    requests,
    stop: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
  };
}

describe("LocalSandboxIdleController", () => {
  it("reschedules the idle deadline when presence is touched", async () => {
    const commandServer = await startSandboxLifecycleCommandServer({
      host: "127.0.0.1",
      serviceToken: "test-service-token",
    });

    try {
      const clock = createMutableClock(1_000);
      const scheduler = createManualScheduler(clock);
      const ownerStore = new InMemorySandboxOwnerStore(clock);
      const activityStore = new InMemorySandboxActivityStore(clock);
      const presenceStore = new InMemorySandboxPresenceStore(clock);
      const runtimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
      const stopRequester = new DataPlaneApiStopSandboxClient({
        baseUrl: commandServer.baseUrl,
        serviceToken: "test-service-token",
      });
      const reconcileRequester = new DataPlaneApiReconcileSandboxClient({
        baseUrl: commandServer.baseUrl,
        serviceToken: "test-service-token",
      });
      let disposeCount = 0;
      const owner = await ownerStore.claimOwner({
        sandboxInstanceId: "sbi_idle",
        nodeId: "dpg_idle",
        sessionId: "dts_idle",
        ttlMs: 10_000,
      });

      const controller = new LocalSandboxIdleController(
        {
          sandboxInstanceId: "sbi_idle",
          ownerLeaseId: owner.leaseId,
          timeoutMs: 5_000,
          disconnectGraceMs: 1_000,
          clock,
          scheduler,
          ownerStore,
          activityStore,
          presenceStore,
          runtimeAttachmentStore,
          stopRequester,
          reconcileRequester,
        },
        () => {
          disposeCount += 1;
        },
      );

      controller.start({
        nowMs: clock.nowMs(),
      });

      clock.advanceMs(3_000);
      controller.handlePresenceLeaseTouch({
        leaseId: "spl_reschedule",
        nowMs: clock.nowMs(),
      });
      await presenceStore.touchLease({
        sandboxInstanceId: "sbi_idle",
        leaseId: "spl_reschedule",
        source: "dashboard",
        sessionId: "dts_idle",
        ttlMs: 10_000,
        nowMs: clock.nowMs(),
      });

      clock.advanceMs(2_000);
      expect(scheduler.runDue()).toBe(0);
      expect(scheduler.pendingCount()).toBe(1);
      expect(disposeCount).toBe(0);

      clock.advanceMs(3_000);
      expect(scheduler.runDue()).toBe(1);
      await flushAsyncSchedulerWork();
      expect(scheduler.pendingCount()).toBe(1);
      expect(disposeCount).toBe(0);
      expect(commandServer.requests).toHaveLength(0);
    } finally {
      await commandServer.stop();
    }
  });

  it("requests reconcile after disconnect grace elapses without recovery", async () => {
    const commandServer = await startSandboxLifecycleCommandServer({
      host: "127.0.0.1",
      serviceToken: "test-service-token",
    });

    try {
      const clock = createMutableClock(1_000);
      const scheduler = createManualScheduler(clock);
      const ownerStore = new InMemorySandboxOwnerStore(clock);
      const activityStore = new InMemorySandboxActivityStore(clock);
      const presenceStore = new InMemorySandboxPresenceStore(clock);
      const runtimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
      const stopRequester = new DataPlaneApiStopSandboxClient({
        baseUrl: commandServer.baseUrl,
        serviceToken: "test-service-token",
      });
      const reconcileRequester = new DataPlaneApiReconcileSandboxClient({
        baseUrl: commandServer.baseUrl,
        serviceToken: "test-service-token",
      });
      let disposeCount = 0;
      const owner = await ownerStore.claimOwner({
        sandboxInstanceId: "sbi_disconnect",
        nodeId: "dpg_disconnect",
        sessionId: "dts_disconnect",
        ttlMs: 10_000,
      });

      const controller = new LocalSandboxIdleController(
        {
          sandboxInstanceId: "sbi_disconnect",
          ownerLeaseId: owner.leaseId,
          timeoutMs: 5_000,
          disconnectGraceMs: 1_000,
          clock,
          scheduler,
          ownerStore,
          activityStore,
          presenceStore,
          runtimeAttachmentStore,
          stopRequester,
          reconcileRequester,
        },
        () => {
          disposeCount += 1;
        },
      );
      await runtimeAttachmentStore.upsertAttachment({
        sandboxInstanceId: "sbi_disconnect",
        ownerLeaseId: owner.leaseId,
        nodeId: "dpg_disconnect",
        sessionId: "dts_disconnect",
        attachedAtMs: clock.nowMs(),
        ttlMs: 10_000,
        nowMs: clock.nowMs(),
      });

      controller.start({
        nowMs: clock.nowMs(),
      });
      controller.handleBootstrapDisconnect({
        nowMs: clock.nowMs(),
      });
      await flushAsyncSchedulerWork();

      clock.advanceMs(999);
      expect(scheduler.runDue()).toBe(0);
      expect(disposeCount).toBe(0);
      expect(scheduler.pendingCount()).toBe(1);
      expect(commandServer.requests).toHaveLength(0);

      clock.advanceMs(1);
      expect(scheduler.runDue()).toBe(1);
      await flushAsyncSchedulerWork();
      await waitForCondition(
        () => commandServer.requests.length === 1 && disposeCount === 1,
        1_000,
        "Timed out waiting for disconnect reconciliation request.",
      );

      expect(disposeCount).toBe(1);
      expect(commandServer.requests).toHaveLength(1);
      expect(commandServer.requests[0]).toEqual({
        method: "POST",
        path: `/internal/sandbox/instances/${encodeURIComponent("sbi_disconnect")}/reconcile`,
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-mistle-service-token": "test-service-token",
        }),
        body: {
          reason: "disconnect_grace_elapsed",
          expectedOwnerLeaseId: owner.leaseId,
          idempotencyKey: `sbi_disconnect:${owner.leaseId}:disconnect_grace_elapsed:reconcile`,
        },
      });
    } finally {
      await commandServer.stop();
    }
  });

  it("reschedules the idle deadline when activity is touched", async () => {
    const commandServer = await startSandboxLifecycleCommandServer({
      host: "127.0.0.1",
      serviceToken: "test-service-token",
    });

    try {
      const clock = createMutableClock(1_000);
      const scheduler = createManualScheduler(clock);
      const ownerStore = new InMemorySandboxOwnerStore(clock);
      const activityStore = new InMemorySandboxActivityStore(clock);
      const presenceStore = new InMemorySandboxPresenceStore(clock);
      const runtimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
      const stopRequester = new DataPlaneApiStopSandboxClient({
        baseUrl: commandServer.baseUrl,
        serviceToken: "test-service-token",
      });
      const reconcileRequester = new DataPlaneApiReconcileSandboxClient({
        baseUrl: commandServer.baseUrl,
        serviceToken: "test-service-token",
      });
      let disposeCount = 0;
      const owner = await ownerStore.claimOwner({
        sandboxInstanceId: "sbi_activity",
        nodeId: "dpg_activity",
        sessionId: "dts_activity",
        ttlMs: 10_000,
      });

      const controller = new LocalSandboxIdleController(
        {
          sandboxInstanceId: "sbi_activity",
          ownerLeaseId: owner.leaseId,
          timeoutMs: 5_000,
          disconnectGraceMs: 1_000,
          clock,
          scheduler,
          ownerStore,
          activityStore,
          presenceStore,
          runtimeAttachmentStore,
          stopRequester,
          reconcileRequester,
        },
        () => {
          disposeCount += 1;
        },
      );

      controller.start({
        nowMs: clock.nowMs(),
      });

      clock.advanceMs(3_000);
      controller.handleActivityLeaseTouch({
        leaseId: "sal_reschedule",
        nowMs: clock.nowMs(),
      });
      await activityStore.touchLease({
        sandboxInstanceId: "sbi_activity",
        leaseId: "sal_reschedule",
        kind: "agent_execution",
        source: "webhook",
        nodeId: "dpg_activity",
        ttlMs: 10_000,
        nowMs: clock.nowMs(),
      });

      clock.advanceMs(2_000);
      expect(scheduler.runDue()).toBe(0);
      expect(scheduler.pendingCount()).toBe(1);
      expect(disposeCount).toBe(0);

      clock.advanceMs(3_000);
      expect(scheduler.runDue()).toBe(1);
      await flushAsyncSchedulerWork();
      expect(scheduler.pendingCount()).toBe(1);
      expect(disposeCount).toBe(0);
      expect(commandServer.requests).toHaveLength(0);
    } finally {
      await commandServer.stop();
    }
  });

  it("requests stop when the idle deadline elapses without active leases", async () => {
    const commandServer = await startSandboxLifecycleCommandServer({
      host: "127.0.0.1",
      serviceToken: "test-service-token",
    });

    try {
      const clock = createMutableClock(1_000);
      const scheduler = createManualScheduler(clock);
      const ownerStore = new InMemorySandboxOwnerStore(clock);
      const activityStore = new InMemorySandboxActivityStore(clock);
      const presenceStore = new InMemorySandboxPresenceStore(clock);
      const runtimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
      const stopRequester = new DataPlaneApiStopSandboxClient({
        baseUrl: commandServer.baseUrl,
        serviceToken: "test-service-token",
      });
      const reconcileRequester = new DataPlaneApiReconcileSandboxClient({
        baseUrl: commandServer.baseUrl,
        serviceToken: "test-service-token",
      });
      let disposeCount = 0;
      const owner = await ownerStore.claimOwner({
        sandboxInstanceId: "sbi_idle_expire",
        nodeId: "dpg_idle_expire",
        sessionId: "dts_idle_expire",
        ttlMs: 10_000,
      });

      const controller = new LocalSandboxIdleController(
        {
          sandboxInstanceId: "sbi_idle_expire",
          ownerLeaseId: owner.leaseId,
          timeoutMs: 5_000,
          disconnectGraceMs: 1_000,
          clock,
          scheduler,
          ownerStore,
          activityStore,
          presenceStore,
          runtimeAttachmentStore,
          stopRequester,
          reconcileRequester,
        },
        () => {
          disposeCount += 1;
        },
      );

      controller.start({
        nowMs: clock.nowMs(),
      });

      clock.advanceMs(5_000);
      expect(scheduler.runDue()).toBe(1);
      await flushAsyncSchedulerWork();
      await waitForCondition(
        () => commandServer.requests.length === 1 && disposeCount === 1,
        1_000,
        "Timed out waiting for idle stop request.",
      );

      expect(disposeCount).toBe(1);
      expect(commandServer.requests).toHaveLength(1);
      expect(commandServer.requests[0]).toEqual({
        method: "POST",
        path: `/internal/sandbox/instances/${encodeURIComponent("sbi_idle_expire")}/stop`,
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-mistle-service-token": "test-service-token",
        }),
        body: {
          stopReason: "idle",
          expectedOwnerLeaseId: owner.leaseId,
          idempotencyKey: `sbi_idle_expire:${owner.leaseId}:idle_stop`,
        },
      });
    } finally {
      await commandServer.stop();
    }
  });
});
