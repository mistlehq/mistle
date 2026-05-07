/* eslint-disable jest/no-standalone-expect --
 * The integration harness returns a Vitest fixture-bound `it` function.
 */

import { randomUUID } from "node:crypto";

import { Cache, ValkeyCacheAdapter, closeValkeyClient, createValkeyClient } from "@mistle/cache";
import type { CompiledRuntimePlan } from "@mistle/sandbox-runtime-contract";
import { createIntegrationTest } from "@mistle/test-harness/integration";
import { systemSleeper } from "@mistle/time";
import { describe, expect } from "vitest";

import { ActiveSandboxRuntimePlanCache } from "../src/egress/active-runtime-plan-cache.js";
import { ValkeySandboxKeepaliveStore } from "../src/runtime-state/adapters/valkey-sandbox-keepalive-store.js";
import { ValkeySandboxPresenceStore } from "../src/runtime-state/adapters/valkey-sandbox-presence-store.js";
import { ValkeySandboxRuntimeAttachmentStore } from "../src/runtime-state/adapters/valkey-sandbox-runtime-attachment-store.js";
import { ValkeySandboxRuntimeReadinessStore } from "../src/runtime-state/adapters/valkey-sandbox-runtime-readiness-store.js";

const it = createIntegrationTest({
  services: ["data-plane-gateway"],
});

describe.concurrent("runtime-state store integrations", () => {
  it("caches immutable sandbox runtime plans in valkey", async ({ env }) => {
    const keyPrefix = createRuntimeStateKeyPrefix(env.dataPlaneGatewayRuntimeState.keyPrefix);
    const client = createValkeyClient({
      url: env.dataPlaneGatewayRuntimeState.valkeyUrl,
    });
    await client.connect();

    try {
      const cache = new ActiveSandboxRuntimePlanCache(
        new Cache({
          adapter: new ValkeyCacheAdapter(client, keyPrefix),
        }),
      );
      const runtimePlan = createRuntimePlan();

      await cache.set({
        sandboxInstanceId: "sbi_runtime_plan_cache_it",
        runtimePlan: {
          organizationId: "org_runtime_plan_cache_it",
          providerSandboxId: "provider-runtime-plan-cache-it",
          runtimePlan,
          runtimePlanRevision: 1,
          sandboxInstanceStatus: "running",
        },
      });

      await expect(
        cache.get({
          sandboxInstanceId: "sbi_runtime_plan_cache_it",
        }),
      ).resolves.toEqual({
        organizationId: "org_runtime_plan_cache_it",
        providerSandboxId: "provider-runtime-plan-cache-it",
        runtimePlan,
        runtimePlanRevision: 1,
        sandboxInstanceStatus: "running",
      });
    } finally {
      await deleteKeysByPrefix({
        client,
        keyPrefix,
      });
      await closeValkeyClient(client);
    }
  });

  it("expires attachment records when their TTL elapses", async ({ env }) => {
    const keyPrefix = createRuntimeStateKeyPrefix(env.dataPlaneGatewayRuntimeState.keyPrefix);
    const client = createValkeyClient({
      url: env.dataPlaneGatewayRuntimeState.valkeyUrl,
    });
    await client.connect();

    try {
      const attachmentStore = new ValkeySandboxRuntimeAttachmentStore(client, keyPrefix);

      await attachmentStore.upsertAttachment({
        sandboxInstanceId: "sbi_expiry",
        ownerLeaseId: "dtl_expiry",
        nodeId: "dpg_expiry",
        sessionId: "dts_expiry",
        attachedAtMs: Date.now(),
        ttlMs: 50,
        nowMs: Date.now(),
      });

      await systemSleeper.sleep(100);

      await expect(
        attachmentStore.getAttachment({
          sandboxInstanceId: "sbi_expiry",
          nowMs: Date.now(),
        }),
      ).resolves.toBeNull();
    } finally {
      await deleteKeysByPrefix({
        client,
        keyPrefix,
      });
      await closeValkeyClient(client);
    }
  });

  it("fences attachment clears by owner lease id", async ({ env }) => {
    const keyPrefix = createRuntimeStateKeyPrefix(env.dataPlaneGatewayRuntimeState.keyPrefix);
    const client = createValkeyClient({
      url: env.dataPlaneGatewayRuntimeState.valkeyUrl,
    });
    await client.connect();

    try {
      const store = new ValkeySandboxRuntimeAttachmentStore(client, keyPrefix);
      const sandboxInstanceId = "sbi_attachment_it";

      await store.upsertAttachment({
        sandboxInstanceId,
        ownerLeaseId: "dtl_new",
        nodeId: "dpg_new",
        sessionId: "dts_new",
        attachedAtMs: Date.now(),
        ttlMs: 30_000,
        nowMs: Date.now(),
      });

      await expect(
        store.clearAttachment({
          sandboxInstanceId,
          ownerLeaseId: "dtl_old",
        }),
      ).resolves.toBe(false);
      await expect(
        store.clearAttachment({
          sandboxInstanceId,
          ownerLeaseId: "dtl_new",
        }),
      ).resolves.toBe(true);
      await expect(
        store.getAttachment({
          sandboxInstanceId,
          nowMs: Date.now(),
        }),
      ).resolves.toBeNull();
    } finally {
      await deleteKeysByPrefix({
        client,
        keyPrefix,
      });
      await closeValkeyClient(client);
    }
  });

  it("tracks active presence leases until they are released or expire", async ({ env }) => {
    const keyPrefix = createRuntimeStateKeyPrefix(env.dataPlaneGatewayRuntimeState.keyPrefix);
    const client = createValkeyClient({
      url: env.dataPlaneGatewayRuntimeState.valkeyUrl,
    });
    await client.connect();

    try {
      const store = new ValkeySandboxPresenceStore(client, keyPrefix);
      const sandboxInstanceId = "sbi_presence_it";

      await store.touchLease({
        sandboxInstanceId,
        leaseId: "spl_first",
        source: "dashboard",
        sessionId: "session_first",
        ttlMs: 30_000,
        nowMs: Date.now(),
      });
      await store.touchLease({
        sandboxInstanceId,
        leaseId: "spl_second",
        source: "cli",
        sessionId: "session_second",
        ttlMs: 50,
        nowMs: Date.now(),
      });

      await expect(
        store.hasAnyActiveLease({
          sandboxInstanceId,
          nowMs: Date.now(),
        }),
      ).resolves.toBe(true);
      await expect(
        store.countActiveLeases({
          sandboxInstanceId,
          nowMs: Date.now(),
        }),
      ).resolves.toBe(2);
      await expect(
        store.releaseLease({
          sandboxInstanceId,
          leaseId: "spl_first",
        }),
      ).resolves.toBe(true);
      await expect(
        store.hasAnyActiveLease({
          sandboxInstanceId,
          nowMs: Date.now(),
        }),
      ).resolves.toBe(true);
      await expect(
        store.countActiveLeases({
          sandboxInstanceId,
          nowMs: Date.now(),
        }),
      ).resolves.toBe(1);

      await systemSleeper.sleep(100);

      await expect(
        store.hasAnyActiveLease({
          sandboxInstanceId,
          nowMs: Date.now(),
        }),
      ).resolves.toBe(false);
      await expect(
        store.countActiveLeases({
          sandboxInstanceId,
          nowMs: Date.now(),
        }),
      ).resolves.toBe(0);
    } finally {
      await deleteKeysByPrefix({
        client,
        keyPrefix,
      });
      await closeValkeyClient(client);
    }
  });

  it("ignores orphaned presence index entries left by overlapping release and touch operations", async ({
    env,
  }) => {
    const keyPrefix = createRuntimeStateKeyPrefix(env.dataPlaneGatewayRuntimeState.keyPrefix);
    const client = createValkeyClient({
      url: env.dataPlaneGatewayRuntimeState.valkeyUrl,
    });
    await client.connect();

    try {
      const store = new ValkeySandboxPresenceStore(client, keyPrefix);
      const sandboxInstanceId = "sbi_presence_orphan_it";
      const leaseId = "spl_orphan";
      const indexKey = `${keyPrefix}:sandbox-presence:${sandboxInstanceId}`;
      const detailKey = `${keyPrefix}:sandbox-presence:${sandboxInstanceId}:lease:${leaseId}`;

      await store.touchLease({
        sandboxInstanceId,
        leaseId,
        source: "dashboard",
        sessionId: "session_first",
        ttlMs: 30_000,
        nowMs: Date.now(),
      });

      // Reproduces the only durable state a stale release can leave behind:
      // an index member whose TTL-backed detail key is already gone.
      await client.zRem(indexKey, leaseId);
      await store.touchLease({
        sandboxInstanceId,
        leaseId,
        source: "dashboard",
        sessionId: "session_second",
        ttlMs: 30_000,
        nowMs: Date.now(),
      });
      await client.del(detailKey);

      await expect(
        store.countActiveLeases({
          sandboxInstanceId,
          nowMs: Date.now(),
        }),
      ).resolves.toBe(0);
      await expect(
        store.hasAnyActiveLease({
          sandboxInstanceId,
          nowMs: Date.now(),
        }),
      ).resolves.toBe(false);
      await expect(client.zCard(indexKey)).resolves.toBe(0);
    } finally {
      await deleteKeysByPrefix({
        client,
        keyPrefix,
      });
      await closeValkeyClient(client);
    }
  });

  it("renews keepalives without losing their stored metadata", async ({ env }) => {
    const keyPrefix = createRuntimeStateKeyPrefix(env.dataPlaneGatewayRuntimeState.keyPrefix);
    const client = createValkeyClient({
      url: env.dataPlaneGatewayRuntimeState.valkeyUrl,
    });
    await client.connect();

    try {
      const store = new ValkeySandboxKeepaliveStore(client, keyPrefix);
      const sandboxInstanceId = "sbi_keepalive_it";
      const keepaliveId = "skp_first";
      const detailKey = `${keyPrefix}:sandbox-keepalive:${sandboxInstanceId}:record:${keepaliveId}`;

      await store.touchKeepalive({
        sandboxInstanceId,
        keepaliveId,
        source: "codex",
        externalSubjectId: "turn_123",
        metadata: {
          threadId: "thr_123",
        },
        nodeId: "dpg_it",
        ttlMs: 30_000,
        nowMs: Date.now(),
      });
      await expect(
        store.renewKeepalive({
          sandboxInstanceId,
          keepaliveId,
          ttlMs: 30_000,
          nowMs: Date.now(),
        }),
      ).resolves.toBe(true);

      const serializedLease = await client.get(detailKey);
      expect(serializedLease).not.toBeNull();
      expect(JSON.parse(serializedLease ?? "null")).toMatchObject({
        sandboxInstanceId,
        keepaliveId,
        source: "codex",
        externalSubjectId: "turn_123",
        metadata: {
          threadId: "thr_123",
        },
        nodeId: "dpg_it",
      });

      await expect(
        store.renewKeepalive({
          sandboxInstanceId,
          keepaliveId: "skp_missing",
          ttlMs: 30_000,
          nowMs: Date.now(),
        }),
      ).resolves.toBe(false);
    } finally {
      await deleteKeysByPrefix({
        client,
        keyPrefix,
      });
      await closeValkeyClient(client);
    }
  });

  it("ignores orphaned keepalive index entries left by overlapping release and renew operations", async ({
    env,
  }) => {
    const keyPrefix = createRuntimeStateKeyPrefix(env.dataPlaneGatewayRuntimeState.keyPrefix);
    const client = createValkeyClient({
      url: env.dataPlaneGatewayRuntimeState.valkeyUrl,
    });
    await client.connect();

    try {
      const store = new ValkeySandboxKeepaliveStore(client, keyPrefix);
      const sandboxInstanceId = "sbi_keepalive_orphan_it";
      const keepaliveId = "skp_orphan";
      const indexKey = `${keyPrefix}:sandbox-keepalive:${sandboxInstanceId}`;
      const detailKey = `${keyPrefix}:sandbox-keepalive:${sandboxInstanceId}:record:${keepaliveId}`;

      await store.touchKeepalive({
        sandboxInstanceId,
        keepaliveId,
        source: "codex",
        nodeId: "dpg_it",
        ttlMs: 30_000,
        nowMs: Date.now(),
      });

      // Reproduces the only durable state a stale release can leave behind:
      // an index member whose TTL-backed detail key is already gone.
      await client.zRem(indexKey, keepaliveId);
      await expect(
        store.renewKeepalive({
          sandboxInstanceId,
          keepaliveId,
          ttlMs: 30_000,
          nowMs: Date.now(),
        }),
      ).resolves.toBe(true);
      await client.del(detailKey);

      await expect(
        store.summarize({
          sandboxInstanceId,
          nowMs: Date.now(),
          ownerLeaseId: null,
        }),
      ).resolves.toEqual({ active: false });
      await expect(client.zCard(indexKey)).resolves.toBe(0);
    } finally {
      await deleteKeysByPrefix({
        client,
        keyPrefix,
      });
      await closeValkeyClient(client);
    }
  });

  it("summarizes owner-fenced keepalive state from valkey", async ({ env }) => {
    const keyPrefix = createRuntimeStateKeyPrefix(env.dataPlaneGatewayRuntimeState.keyPrefix);
    const client = createValkeyClient({
      url: env.dataPlaneGatewayRuntimeState.valkeyUrl,
    });
    await client.connect();

    try {
      const store = new ValkeySandboxKeepaliveStore(client, keyPrefix);
      const sandboxInstanceId = "sbi_keepalive_state_it";

      await store.replaceStateForOwner({
        sandboxInstanceId,
        ownerLeaseId: "dtl_owner",
        nodeId: "dpg_it",
        ttlMs: 30_000,
        nowMs: Date.now(),
        active: true,
      });

      await expect(
        store.summarize({
          sandboxInstanceId,
          nowMs: Date.now(),
          ownerLeaseId: "dtl_owner",
        }),
      ).resolves.toEqual({ active: true });
      await expect(
        store.summarize({
          sandboxInstanceId,
          nowMs: Date.now(),
          ownerLeaseId: "dtl_other",
        }),
      ).resolves.toEqual({ active: false });

      await store.replaceStateForOwner({
        sandboxInstanceId,
        ownerLeaseId: "dtl_owner_next",
        nodeId: "dpg_it",
        ttlMs: 30_000,
        nowMs: Date.now(),
        active: false,
      });

      await expect(
        store.summarize({
          sandboxInstanceId,
          nowMs: Date.now(),
          ownerLeaseId: "dtl_owner_next",
        }),
      ).resolves.toEqual({ active: false });
    } finally {
      await deleteKeysByPrefix({
        client,
        keyPrefix,
      });
      await closeValkeyClient(client);
    }
  });

  it("summarizes owner-fenced runtime readiness from valkey", async ({ env }) => {
    const keyPrefix = createRuntimeStateKeyPrefix(env.dataPlaneGatewayRuntimeState.keyPrefix);
    const client = createValkeyClient({
      url: env.dataPlaneGatewayRuntimeState.valkeyUrl,
    });
    await client.connect();

    try {
      const store = new ValkeySandboxRuntimeReadinessStore(client, keyPrefix);
      const sandboxInstanceId = "sbi_runtime_ready_it";

      await store.replaceStateForOwner({
        sandboxInstanceId,
        ownerLeaseId: "dtl_owner",
        nodeId: "dpg_it",
        ready: true,
      });

      await expect(
        store.summarize({
          sandboxInstanceId,
          ownerLeaseId: "dtl_owner",
        }),
      ).resolves.toEqual({ ready: true });
      await expect(
        store.summarize({
          sandboxInstanceId,
          ownerLeaseId: "dtl_other",
        }),
      ).resolves.toEqual({ ready: false });

      await store.replaceStateForOwner({
        sandboxInstanceId,
        ownerLeaseId: "dtl_owner_next",
        nodeId: "dpg_it",
        ready: false,
      });

      await expect(
        store.summarize({
          sandboxInstanceId,
          ownerLeaseId: "dtl_owner_next",
        }),
      ).resolves.toEqual({ ready: false });
    } finally {
      await deleteKeysByPrefix({
        client,
        keyPrefix,
      });
      await closeValkeyClient(client);
    }
  });
});

function createRuntimeStateKeyPrefix(environmentKeyPrefix: string): string {
  return `${environmentKeyPrefix}runtime-state-store:${randomUUID()}`;
}

function createRuntimePlan(): CompiledRuntimePlan {
  return {
    sandboxProfileId: "sbp_runtime_plan_cache_it",
    version: 1,
    image: {
      source: "base",
      imageRef: "sandbox-base",
    },
    egressRoutes: [],
    artifacts: [],
    workspaceSources: [],
    runtimeClients: [],
    agentRuntimes: [],
  };
}

async function deleteKeysByPrefix(input: {
  client: ReturnType<typeof createValkeyClient>;
  keyPrefix: string;
}): Promise<void> {
  const keys = await input.client.keys(`${input.keyPrefix}:*`);
  if (keys.length === 0) {
    return;
  }

  await input.client.del(keys);
}
