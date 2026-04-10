import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { createDataPlaneSandboxInstancesClient } from "@mistle/data-plane-internal-client";
import { systemSleeper } from "@mistle/time";
import { createMutableClock, createManualScheduler } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { InMemorySandboxKeepaliveStore } from "../runtime-state/adapters/in-memory-sandbox-keepalive-store.js";
import { InMemorySandboxPresenceStore } from "../runtime-state/adapters/in-memory-sandbox-presence-store.js";
import { InMemorySandboxRuntimeAttachmentStore } from "../runtime-state/adapters/in-memory-sandbox-runtime-attachment-store.js";
import { InMemorySandboxOwnerStore } from "../tunnel/ownership/adapters/in-memory-sandbox-owner-store.js";
import { SandboxKeepaliveRepository } from "../tunnel/sandbox-keepalive-repository.js";
import { SandboxIdleControllerRegistry } from "./sandbox-idle-controller-registry.js";
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

    await systemSleeper.sleep(10);
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

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

async function startSandboxLifecycleCommandServer(input: {
  host: string;
  failFirstReconcileRequest?: boolean;
  failFirstStopRequest?: boolean;
  serviceToken: string;
}): Promise<StartedSandboxLifecycleCommandServer> {
  const requests: CapturedSandboxLifecycleRequest[] = [];
  let hasFailedStopRequest = false;
  let hasFailedReconcileRequest = false;

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
      if (input.failFirstStopRequest === true && !hasFailedStopRequest) {
        hasFailedStopRequest = true;
        writeJson(response, 500, {
          code: "INTERNAL_ERROR",
          message: "Synthetic stop failure.",
        });
        return;
      }

      const sandboxInstanceId = path.split("/")[4];
      writeJson(response, 200, {
        status: "accepted",
        sandboxInstanceId,
        workflowRunId: "wr_stop_test_001",
      });
      return;
    }

    if (method === "POST" && path.endsWith("/reconcile")) {
      if (input.failFirstReconcileRequest === true && !hasFailedReconcileRequest) {
        hasFailedReconcileRequest = true;
        writeJson(response, 500, {
          code: "INTERNAL_ERROR",
          message: "Synthetic reconcile failure.",
        });
        return;
      }

      const sandboxInstanceId = path.split("/")[4];
      writeJson(response, 200, {
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
      const keepaliveStore = new InMemorySandboxKeepaliveStore(clock);
      const presenceStore = new InMemorySandboxPresenceStore(clock);
      const runtimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
      const dataPlaneClient = createDataPlaneSandboxInstancesClient({
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
          requestRetryMs: 1_000,
          clock,
          scheduler,
          ownerStore,
          keepaliveStore,
          presenceStore,
          runtimeAttachmentStore,
          dataPlaneClient,
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
      const keepaliveStore = new InMemorySandboxKeepaliveStore(clock);
      const presenceStore = new InMemorySandboxPresenceStore(clock);
      const runtimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
      const dataPlaneClient = createDataPlaneSandboxInstancesClient({
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
          requestRetryMs: 1_000,
          clock,
          scheduler,
          ownerStore,
          keepaliveStore,
          presenceStore,
          runtimeAttachmentStore,
          dataPlaneClient,
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

  it("retries reconcile after a transient disconnect-grace request failure", async () => {
    const commandServer = await startSandboxLifecycleCommandServer({
      host: "127.0.0.1",
      failFirstReconcileRequest: true,
      serviceToken: "test-service-token",
    });

    try {
      const clock = createMutableClock(1_000);
      const scheduler = createManualScheduler(clock);
      const ownerStore = new InMemorySandboxOwnerStore(clock);
      const keepaliveStore = new InMemorySandboxKeepaliveStore(clock);
      const presenceStore = new InMemorySandboxPresenceStore(clock);
      const runtimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
      const dataPlaneClient = createDataPlaneSandboxInstancesClient({
        baseUrl: commandServer.baseUrl,
        serviceToken: "test-service-token",
      });
      let disposeCount = 0;
      const owner = await ownerStore.claimOwner({
        sandboxInstanceId: "sbi_disconnect_retry",
        nodeId: "dpg_disconnect_retry",
        sessionId: "dts_disconnect_retry",
        ttlMs: 10_000,
      });

      const controller = new LocalSandboxIdleController(
        {
          sandboxInstanceId: "sbi_disconnect_retry",
          ownerLeaseId: owner.leaseId,
          timeoutMs: 5_000,
          disconnectGraceMs: 1_000,
          requestRetryMs: 1_000,
          clock,
          scheduler,
          ownerStore,
          keepaliveStore,
          presenceStore,
          runtimeAttachmentStore,
          dataPlaneClient,
        },
        () => {
          disposeCount += 1;
        },
      );
      await runtimeAttachmentStore.upsertAttachment({
        sandboxInstanceId: "sbi_disconnect_retry",
        ownerLeaseId: owner.leaseId,
        nodeId: "dpg_disconnect_retry",
        sessionId: "dts_disconnect_retry",
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

      clock.advanceMs(1_000);
      expect(scheduler.runDue()).toBe(1);
      await flushAsyncSchedulerWork();
      await waitForCondition(
        () => commandServer.requests.length === 1,
        1_000,
        "Timed out waiting for initial disconnect reconciliation request.",
      );
      await waitForCondition(
        () => scheduler.pendingCount() === 1,
        1_000,
        "Timed out waiting for disconnect reconciliation retry scheduling.",
      );

      expect(disposeCount).toBe(0);
      expect(scheduler.pendingCount()).toBe(1);

      clock.advanceMs(1_000);
      expect(scheduler.runDue()).toBe(1);
      await flushAsyncSchedulerWork();
      await waitForCondition(
        () => commandServer.requests.length === 2 && disposeCount === 1,
        1_000,
        "Timed out waiting for retried disconnect reconciliation request.",
      );

      expect(commandServer.requests).toHaveLength(2);
      expect(commandServer.requests[1]).toEqual({
        method: "POST",
        path: `/internal/sandbox/instances/${encodeURIComponent("sbi_disconnect_retry")}/reconcile`,
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-mistle-service-token": "test-service-token",
        }),
        body: {
          reason: "disconnect_grace_elapsed",
          expectedOwnerLeaseId: owner.leaseId,
          idempotencyKey: `sbi_disconnect_retry:${owner.leaseId}:disconnect_grace_elapsed:reconcile`,
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
      const keepaliveStore = new InMemorySandboxKeepaliveStore(clock);
      const presenceStore = new InMemorySandboxPresenceStore(clock);
      const runtimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
      const dataPlaneClient = createDataPlaneSandboxInstancesClient({
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
          requestRetryMs: 1_000,
          clock,
          scheduler,
          ownerStore,
          keepaliveStore,
          presenceStore,
          runtimeAttachmentStore,
          dataPlaneClient,
        },
        () => {
          disposeCount += 1;
        },
      );

      controller.start({
        nowMs: clock.nowMs(),
      });

      clock.advanceMs(3_000);
      controller.handleActivityTouch({
        nowMs: clock.nowMs(),
      });
      await keepaliveStore.touchKeepalive({
        sandboxInstanceId: "sbi_activity",
        keepaliveId: "sal_reschedule",
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

  it("does not extend the idle deadline for inactive keepalive heartbeats", async () => {
    const commandServer = await startSandboxLifecycleCommandServer({
      host: "127.0.0.1",
      serviceToken: "test-service-token",
    });

    try {
      const clock = createMutableClock(1_000);
      const scheduler = createManualScheduler(clock);
      const ownerStore = new InMemorySandboxOwnerStore(clock);
      const keepaliveStore = new InMemorySandboxKeepaliveStore(clock);
      const presenceStore = new InMemorySandboxPresenceStore(clock);
      const runtimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
      const dataPlaneClient = createDataPlaneSandboxInstancesClient({
        baseUrl: commandServer.baseUrl,
        serviceToken: "test-service-token",
      });
      let disposeCount = 0;
      const owner = await ownerStore.claimOwner({
        sandboxInstanceId: "sbi_inactive_keepalive",
        nodeId: "dpg_inactive_keepalive",
        sessionId: "dts_inactive_keepalive",
        ttlMs: 60_000,
      });
      const registry = new SandboxIdleControllerRegistry((input) => {
        return new LocalSandboxIdleController(
          {
            sandboxInstanceId: input.sandboxInstanceId,
            ownerLeaseId: input.ownerLeaseId,
            timeoutMs: 5_000,
            disconnectGraceMs: 1_000,
            requestRetryMs: 1_000,
            clock,
            scheduler,
            ownerStore,
            keepaliveStore,
            presenceStore,
            runtimeAttachmentStore,
            dataPlaneClient,
          },
          () => {
            disposeCount += 1;
            input.onDisposed();
          },
        );
      });
      const keepaliveRepository = new SandboxKeepaliveRepository(
        keepaliveStore,
        registry,
        clock,
        "dpg_inactive_keepalive",
      );
      const controller = registry.ensureController({
        sandboxInstanceId: "sbi_inactive_keepalive",
        ownerLeaseId: owner.leaseId,
        nowMs: clock.nowMs(),
      });

      controller.start({
        nowMs: clock.nowMs(),
      });

      for (let iteration = 0; iteration < 4; iteration += 1) {
        clock.advanceMs(1_000);
        await keepaliveRepository.applyControlMessage({
          sandboxInstanceId: "sbi_inactive_keepalive",
          ownerLeaseId: owner.leaseId,
          message: {
            type: "keepalive.state",
            ttlMs: 30_000,
            active: false,
          },
        });
        expect(scheduler.runDue()).toBe(0);
      }

      clock.advanceMs(1_000);
      expect(scheduler.runDue()).toBe(1);
      await flushAsyncSchedulerWork();
      await waitForCondition(
        () => commandServer.requests.length === 1 && disposeCount === 1,
        1_000,
        "Timed out waiting for idle stop request after inactive keepalive heartbeats.",
      );

      expect(commandServer.requests[0]).toEqual({
        method: "POST",
        path: `/internal/sandbox/instances/${encodeURIComponent("sbi_inactive_keepalive")}/stop`,
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-mistle-service-token": "test-service-token",
        }),
        body: {
          stopReason: "idle",
          expectedOwnerLeaseId: owner.leaseId,
          idempotencyKey: `sbi_inactive_keepalive:${owner.leaseId}:idle_stop`,
        },
      });
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
      const keepaliveStore = new InMemorySandboxKeepaliveStore(clock);
      const presenceStore = new InMemorySandboxPresenceStore(clock);
      const runtimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
      const dataPlaneClient = createDataPlaneSandboxInstancesClient({
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
          requestRetryMs: 1_000,
          clock,
          scheduler,
          ownerStore,
          keepaliveStore,
          presenceStore,
          runtimeAttachmentStore,
          dataPlaneClient,
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

  it("retries idle stop after a transient request failure", async () => {
    const commandServer = await startSandboxLifecycleCommandServer({
      host: "127.0.0.1",
      failFirstStopRequest: true,
      serviceToken: "test-service-token",
    });

    try {
      const clock = createMutableClock(1_000);
      const scheduler = createManualScheduler(clock);
      const ownerStore = new InMemorySandboxOwnerStore(clock);
      const keepaliveStore = new InMemorySandboxKeepaliveStore(clock);
      const presenceStore = new InMemorySandboxPresenceStore(clock);
      const runtimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
      const dataPlaneClient = createDataPlaneSandboxInstancesClient({
        baseUrl: commandServer.baseUrl,
        serviceToken: "test-service-token",
      });
      let disposeCount = 0;
      const owner = await ownerStore.claimOwner({
        sandboxInstanceId: "sbi_idle_retry",
        nodeId: "dpg_idle_retry",
        sessionId: "dts_idle_retry",
        ttlMs: 10_000,
      });

      const controller = new LocalSandboxIdleController(
        {
          sandboxInstanceId: "sbi_idle_retry",
          ownerLeaseId: owner.leaseId,
          timeoutMs: 5_000,
          disconnectGraceMs: 1_000,
          requestRetryMs: 1_000,
          clock,
          scheduler,
          ownerStore,
          keepaliveStore,
          presenceStore,
          runtimeAttachmentStore,
          dataPlaneClient,
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
        () => commandServer.requests.length === 1,
        1_000,
        "Timed out waiting for initial idle stop request.",
      );

      expect(disposeCount).toBe(0);
      expect(scheduler.pendingCount()).toBe(1);

      clock.advanceMs(1_000);
      expect(scheduler.runDue()).toBe(1);
      await flushAsyncSchedulerWork();
      await waitForCondition(
        () => commandServer.requests.length === 2 && disposeCount === 1,
        1_000,
        "Timed out waiting for retried idle stop request.",
      );

      expect(commandServer.requests).toHaveLength(2);
      expect(commandServer.requests[1]).toEqual({
        method: "POST",
        path: `/internal/sandbox/instances/${encodeURIComponent("sbi_idle_retry")}/stop`,
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-mistle-service-token": "test-service-token",
        }),
        body: {
          stopReason: "idle",
          expectedOwnerLeaseId: owner.leaseId,
          idempotencyKey: `sbi_idle_retry:${owner.leaseId}:idle_stop`,
        },
      });
    } finally {
      await commandServer.stop();
    }
  });
});
