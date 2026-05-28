import { createMutableClock } from "@mistle/time/testing";
import { describe, expect, it } from "vitest";

import { SandboxDeadlineLifecycleCoordinator } from "../deadlines/sandbox-deadline-lifecycle-coordinator.js";
import { createAttachmentBackedActiveBootstrapSessionStore } from "../runtime-state/active-bootstrap-session-store.js";
import { InMemorySandboxRuntimeAttachmentStore } from "../runtime-state/adapters/in-memory-sandbox-runtime-attachment-store.js";
import { InMemorySandboxRuntimeReadinessStore } from "../runtime-state/adapters/in-memory-sandbox-runtime-readiness-store.js";
import { SandboxRuntimeReadinessRepository } from "./sandbox-runtime-readiness-repository.js";

const GatewayNodeId = "dpg_test";
const SandboxInstanceId = "sbi_test";
const FirstOwnerLeaseId = "dtl_first";
const SecondOwnerLeaseId = "dtl_second";

describe("SandboxRuntimeReadinessRepository", () => {
  it("ignores stale readiness messages after bootstrap authority moved to a replacement attachment", async () => {
    const clock = createMutableClock(1_000);
    const attachmentStore = new InMemorySandboxRuntimeAttachmentStore(clock);
    const readinessStore = new InMemorySandboxRuntimeReadinessStore();
    const lifecycleReadinessEvents: boolean[] = [];
    const repository = new SandboxRuntimeReadinessRepository(
      readinessStore,
      createAttachmentBackedActiveBootstrapSessionStore(attachmentStore),
      {
        async handleRuntimeReadiness(input) {
          lifecycleReadinessEvents.push(input.ready);
        },
      },
      new SandboxDeadlineLifecycleCoordinator(),
      clock,
      GatewayNodeId,
    );

    await attachmentStore.upsertAttachment({
      sandboxInstanceId: SandboxInstanceId,
      ownerLeaseId: FirstOwnerLeaseId,
      nodeId: GatewayNodeId,
      sessionId: "dts_first",
      attachedAtMs: clock.nowMs(),
      ttlMs: 60_000,
      nowMs: clock.nowMs(),
    });
    await repository.applyControlMessage({
      message: {
        type: "runtime.ready",
        ready: true,
      },
      sandboxInstanceId: SandboxInstanceId,
      ownerLeaseId: FirstOwnerLeaseId,
    });

    expect(
      await readinessStore.summarize({
        sandboxInstanceId: SandboxInstanceId,
        ownerLeaseId: FirstOwnerLeaseId,
      }),
    ).toEqual({ ready: true });
    expect(lifecycleReadinessEvents).toEqual([true]);

    clock.advanceMs(1_000);
    await attachmentStore.upsertAttachment({
      sandboxInstanceId: SandboxInstanceId,
      ownerLeaseId: SecondOwnerLeaseId,
      nodeId: GatewayNodeId,
      sessionId: "dts_second",
      attachedAtMs: clock.nowMs(),
      ttlMs: 60_000,
      nowMs: clock.nowMs(),
    });

    await repository.applyControlMessage({
      message: {
        type: "runtime.ready",
        ready: true,
      },
      sandboxInstanceId: SandboxInstanceId,
      ownerLeaseId: FirstOwnerLeaseId,
    });

    expect(
      await readinessStore.summarize({
        sandboxInstanceId: SandboxInstanceId,
        ownerLeaseId: SecondOwnerLeaseId,
      }),
    ).toEqual({ ready: false });
    expect(lifecycleReadinessEvents).toEqual([true]);
  });
});
