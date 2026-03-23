import { randomUUID } from "node:crypto";

import { readTestContext } from "@mistle/test-harness";
import { systemSleeper } from "@mistle/time";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ValkeySandboxActivityStore } from "../src/runtime-state/adapters/valkey-sandbox-activity-store.js";
import { ValkeySandboxPresenceStore } from "../src/runtime-state/adapters/valkey-sandbox-presence-store.js";
import { ValkeySandboxRuntimeAttachmentStore } from "../src/runtime-state/adapters/valkey-sandbox-runtime-attachment-store.js";
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

      await systemSleeper.sleep(100);

      await expect(
        store.hasAnyActiveLease({
          sandboxInstanceId,
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

  it("renews activity leases without losing their stored metadata", async () => {
    const keyPrefix = `mistle:runtime-state:activity-it:${randomUUID()}`;
    const valkeyUrl = await readValkeyUrl();
    const client = createValkeyClient({
      url: valkeyUrl,
    });
    await client.connect();

    try {
      const store = new ValkeySandboxActivityStore(client, keyPrefix);
      const sandboxInstanceId = "sbi_activity_it";
      const leaseId = "sal_first";
      const detailKey = `${keyPrefix}:sandbox-activity:${sandboxInstanceId}:lease:${leaseId}`;

      await store.touchLease({
        sandboxInstanceId,
        leaseId,
        kind: "agent_execution",
        source: "codex",
        externalExecutionId: "turn_123",
        metadata: {
          threadId: "thr_123",
        },
        nodeId: "dpg_it",
        ttlMs: 30_000,
        nowMs: Date.now(),
      });
      await expect(
        store.renewLease({
          sandboxInstanceId,
          leaseId,
          ttlMs: 30_000,
          nowMs: Date.now(),
        }),
      ).resolves.toBe(true);

      const serializedLease = await client.get(detailKey);
      expect(serializedLease).not.toBeNull();
      expect(JSON.parse(serializedLease ?? "null")).toMatchObject({
        sandboxInstanceId,
        leaseId,
        kind: "agent_execution",
        source: "codex",
        externalExecutionId: "turn_123",
        metadata: {
          threadId: "thr_123",
        },
        nodeId: "dpg_it",
      });

      await expect(
        store.renewLease({
          sandboxInstanceId,
          leaseId: "sal_missing",
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
});
