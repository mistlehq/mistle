import { randomUUID } from "node:crypto";

import { readTestContext } from "@mistle/test-harness";
import { systemSleeper } from "@mistle/time";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ValkeySandboxKeepaliveStore } from "../src/runtime-state/adapters/valkey-sandbox-keepalive-store.js";
import { ValkeySandboxPresenceStore } from "../src/runtime-state/adapters/valkey-sandbox-presence-store.js";
import { ValkeySandboxRuntimeAttachmentStore } from "../src/runtime-state/adapters/valkey-sandbox-runtime-attachment-store.js";
import { ValkeySandboxRuntimeReadinessStore } from "../src/runtime-state/adapters/valkey-sandbox-runtime-readiness-store.js";
import { createValkeyClient, closeValkeyClient } from "../src/runtime-state/valkey-client.js";
import { ValkeySandboxOwnerStore } from "../src/tunnel/ownership/adapters/valkey-sandbox-owner-store.js";

const TestContextId = "data-plane-gateway.integration";

const SharedInfraConfigSchema = z
  .object({
    valkeyUrl: z.string().min(1),
  })
  .loose();

async function readValkeyUrl(): Promise<string> {
  const testContext = await readTestContext({
    id: TestContextId,
    schema: SharedInfraConfigSchema,
  });

  return testContext.valkeyUrl;
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

describe("runtime-state store integrations", () => {
  it("rejects stale owner renewals and releases after a newer owner claim", async () => {
    const keyPrefix = `mistle:runtime-state:owner-it:${randomUUID()}`;
    const valkeyUrl = await readValkeyUrl();
    const client = createValkeyClient({
      url: valkeyUrl,
    });
    await client.connect();

    try {
      const store = new ValkeySandboxOwnerStore(client, keyPrefix);
      const sandboxInstanceId = "sbi_owner_it";
      const firstOwner = await store.claimOwner({
        sandboxInstanceId,
        nodeId: "dpg_old",
        sessionId: "dts_old",
        ttlMs: 30_000,
      });
      const secondOwner = await store.claimOwner({
        sandboxInstanceId,
        nodeId: "dpg_new",
        sessionId: "dts_new",
        ttlMs: 30_000,
      });

      await expect(
        store.renewOwnerLease({
          sandboxInstanceId,
          leaseId: firstOwner.leaseId,
          ttlMs: 30_000,
        }),
      ).resolves.toBe(false);
      await expect(
        store.releaseOwner({
          sandboxInstanceId,
          leaseId: firstOwner.leaseId,
        }),
      ).resolves.toBe(false);
      await expect(
        store.getOwner({
          sandboxInstanceId,
        }),
      ).resolves.toEqual(secondOwner);
    } finally {
      await deleteKeysByPrefix({
        client,
        keyPrefix,
      });
      await closeValkeyClient(client);
    }
  });

  it("expires owner and attachment records when their TTL elapses", async () => {
    const keyPrefix = `mistle:runtime-state:expiry-it:${randomUUID()}`;
    const valkeyUrl = await readValkeyUrl();
    const client = createValkeyClient({
      url: valkeyUrl,
    });
    await client.connect();

    try {
      const ownerStore = new ValkeySandboxOwnerStore(client, keyPrefix);
      const attachmentStore = new ValkeySandboxRuntimeAttachmentStore(client, keyPrefix);

      await ownerStore.claimOwner({
        sandboxInstanceId: "sbi_expiry",
        nodeId: "dpg_expiry",
        sessionId: "dts_expiry",
        ttlMs: 50,
      });
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
        ownerStore.getOwner({
          sandboxInstanceId: "sbi_expiry",
        }),
      ).resolves.toBeUndefined();
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

  it("fences attachment clears by owner lease id", async () => {
    const keyPrefix = `mistle:runtime-state:attachment-it:${randomUUID()}`;
    const valkeyUrl = await readValkeyUrl();
    const client = createValkeyClient({
      url: valkeyUrl,
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

  it("tracks active presence leases until they are released or expire", async () => {
    const keyPrefix = `mistle:runtime-state:presence-it:${randomUUID()}`;
    const valkeyUrl = await readValkeyUrl();
    const client = createValkeyClient({
      url: valkeyUrl,
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

  it("ignores orphaned presence index entries left by overlapping release and touch operations", async () => {
    const keyPrefix = `mistle:runtime-state:presence-orphan-it:${randomUUID()}`;
    const valkeyUrl = await readValkeyUrl();
    const client = createValkeyClient({
      url: valkeyUrl,
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

      // Emulate an old release interleaving with a concurrent touch on the same lease id:
      // 1. stale release removes the sorted-set member
      // 2. current touch recreates the lease detail + sorted-set member
      // 3. stale release deletes the recreated detail key
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

  it("renews keepalives without losing their stored metadata", async () => {
    const keyPrefix = `mistle:runtime-state:keepalive-it:${randomUUID()}`;
    const valkeyUrl = await readValkeyUrl();
    const client = createValkeyClient({
      url: valkeyUrl,
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

  it("ignores orphaned keepalive index entries left by overlapping release and renew operations", async () => {
    const keyPrefix = `mistle:runtime-state:keepalive-orphan-it:${randomUUID()}`;
    const valkeyUrl = await readValkeyUrl();
    const client = createValkeyClient({
      url: valkeyUrl,
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

      // Emulate an old release interleaving with a current renew on the same keepalive id:
      // 1. stale release removes the sorted-set member
      // 2. renew recreates the sorted-set member + detail key
      // 3. stale release deletes the recreated detail key
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

  it("summarizes owner-fenced keepalive state from valkey", async () => {
    const keyPrefix = `mistle:runtime-state:keepalive-state-it:${randomUUID()}`;
    const valkeyUrl = await readValkeyUrl();
    const client = createValkeyClient({
      url: valkeyUrl,
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

  it("summarizes owner-fenced runtime readiness from valkey", async () => {
    const keyPrefix = `mistle:runtime-state:runtime-ready-it:${randomUUID()}`;
    const valkeyUrl = await readValkeyUrl();
    const client = createValkeyClient({
      url: valkeyUrl,
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
