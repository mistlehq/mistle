import { systemClock } from "@mistle/time";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createAttachmentBackedActiveBootstrapSessionStore } from "../../runtime-state/active-bootstrap-session-store.js";
import { InMemorySandboxKeepaliveStore } from "../../runtime-state/adapters/in-memory-sandbox-keepalive-store.js";
import { InMemorySandboxPresenceStore } from "../../runtime-state/adapters/in-memory-sandbox-presence-store.js";
import { InMemorySandboxRuntimeAttachmentStore } from "../../runtime-state/adapters/in-memory-sandbox-runtime-attachment-store.js";
import { InMemorySandboxRuntimeReadinessStore } from "../../runtime-state/adapters/in-memory-sandbox-runtime-readiness-store.js";
import { InMemorySandboxOwnerStore } from "../../tunnel/ownership/adapters/in-memory-sandbox-owner-store.js";
import type { AppContextBindings, DataPlaneGatewayApp } from "../../types.js";
import { registerSandboxRuntimeStateRoute } from "./register-sandbox-runtime-state-route.js";

const InternalServiceToken = "test-internal-service-token";

function createTestApp(): {
  app: DataPlaneGatewayApp;
  sandboxKeepaliveStore: InMemorySandboxKeepaliveStore;
  sandboxPresenceStore: InMemorySandboxPresenceStore;
  sandboxRuntimeReadinessStore: InMemorySandboxRuntimeReadinessStore;
  sandboxRuntimeAttachmentStore: InMemorySandboxRuntimeAttachmentStore;
  sandboxOwnerStore: InMemorySandboxOwnerStore;
} {
  const app = new Hono<AppContextBindings>();
  const sandboxKeepaliveStore = new InMemorySandboxKeepaliveStore(systemClock);
  const sandboxPresenceStore = new InMemorySandboxPresenceStore(systemClock);
  const sandboxRuntimeReadinessStore = new InMemorySandboxRuntimeReadinessStore();
  const sandboxRuntimeAttachmentStore = new InMemorySandboxRuntimeAttachmentStore(systemClock);
  const sandboxOwnerStore = new InMemorySandboxOwnerStore(systemClock);

  registerSandboxRuntimeStateRoute({
    app,
    clock: systemClock,
    internalAuthServiceToken: InternalServiceToken,
    activeBootstrapSessionStore: createAttachmentBackedActiveBootstrapSessionStore(
      sandboxRuntimeAttachmentStore,
    ),
    sandboxKeepaliveStore,
    sandboxPresenceStore,
    sandboxRuntimeReadinessStore,
  });

  return {
    app,
    sandboxKeepaliveStore,
    sandboxPresenceStore,
    sandboxRuntimeReadinessStore,
    sandboxRuntimeAttachmentStore,
    sandboxOwnerStore,
  };
}

describe("registerSandboxRuntimeStateRoute", () => {
  it("rejects requests without the internal service token", async () => {
    const { app } = createTestApp();

    const response = await app.request("/internal/sandbox-instances/sbi_test/runtime-state");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "UNAUTHORIZED",
      message: "Internal service authentication failed.",
    });
  });

  it("returns an empty runtime-state snapshot when no active bootstrap session exists", async () => {
    const { app } = createTestApp();

    const response = await app.request("/internal/sandbox-instances/sbi_test/runtime-state", {
      headers: {
        "x-mistle-service-token": InternalServiceToken,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
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
  });

  it("returns the active bootstrap session as both owner and attachment", async () => {
    const { app, sandboxRuntimeAttachmentStore } = createTestApp();
    const attachedAtMs = systemClock.nowMs();
    await sandboxRuntimeAttachmentStore.upsertAttachment({
      sandboxInstanceId: "sbi_test",
      ownerLeaseId: "dtl_active",
      nodeId: "dpg_test",
      sessionId: "relay_test",
      attachedAtMs,
      ttlMs: 30_000,
      nowMs: systemClock.nowMs(),
    });

    const response = await app.request("/internal/sandbox-instances/sbi_test/runtime-state", {
      headers: {
        "x-mistle-service-token": InternalServiceToken,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ownerLeaseId: "dtl_active",
      attachment: {
        sandboxInstanceId: "sbi_test",
        ownerLeaseId: "dtl_active",
        nodeId: "dpg_test",
        sessionId: "relay_test",
        attachedAtMs,
      },
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
  });

  it("returns presence and keepalive summaries from the current stores", async () => {
    const { app, sandboxKeepaliveStore, sandboxPresenceStore } = createTestApp();

    await sandboxPresenceStore.touchLease({
      sandboxInstanceId: "sbi_test",
      leaseId: "spl_1",
      source: "dashboard",
      sessionId: "session_1",
      ttlMs: 30_000,
      nowMs: systemClock.nowMs(),
    });
    await sandboxPresenceStore.touchLease({
      sandboxInstanceId: "sbi_test",
      leaseId: "spl_2",
      source: "cli",
      sessionId: "session_2",
      ttlMs: 30_000,
      nowMs: systemClock.nowMs(),
    });
    await sandboxKeepaliveStore.touchKeepalive({
      sandboxInstanceId: "sbi_test",
      keepaliveId: "sal_1",
      source: "codex",
      nodeId: "dpg_test",
      ttlMs: 30_000,
      nowMs: systemClock.nowMs(),
    });

    const response = await app.request("/internal/sandbox-instances/sbi_test/runtime-state", {
      headers: {
        "x-mistle-service-token": InternalServiceToken,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ownerLeaseId: null,
      attachment: null,
      presence: {
        activeCount: 2,
      },
      keepalive: {
        active: true,
      },
      runtime: {
        ready: false,
      },
    });
  });

  it("returns runtime readiness fenced to the active bootstrap session lease", async () => {
    const { app, sandboxRuntimeAttachmentStore, sandboxRuntimeReadinessStore } = createTestApp();
    await sandboxRuntimeAttachmentStore.upsertAttachment({
      sandboxInstanceId: "sbi_test",
      ownerLeaseId: "dtl_active",
      nodeId: "dpg_test",
      sessionId: "relay_test",
      attachedAtMs: systemClock.nowMs(),
      ttlMs: 30_000,
      nowMs: systemClock.nowMs(),
    });
    await sandboxRuntimeReadinessStore.replaceStateForOwner({
      sandboxInstanceId: "sbi_test",
      ownerLeaseId: "dtl_active",
      nodeId: "dpg_test",
      ready: true,
    });

    const response = await app.request("/internal/sandbox-instances/sbi_test/runtime-state", {
      headers: {
        "x-mistle-service-token": InternalServiceToken,
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ownerLeaseId: "dtl_active",
      attachment: {
        sandboxInstanceId: "sbi_test",
        ownerLeaseId: "dtl_active",
        nodeId: "dpg_test",
        sessionId: "relay_test",
        attachedAtMs: expect.any(Number),
      },
      presence: {
        activeCount: 0,
      },
      keepalive: {
        active: false,
      },
      runtime: {
        ready: true,
      },
    });
  });
});
