import { describe, expect, it } from "vitest";

import { InMemorySandboxRuntimeReadinessStore } from "./in-memory-sandbox-runtime-readiness-store.js";

describe("InMemorySandboxRuntimeReadinessStore", () => {
  it("summarizes readiness only for the current owner lease", async () => {
    const store = new InMemorySandboxRuntimeReadinessStore();

    await store.replaceStateForOwner({
      sandboxInstanceId: "sbi_ready",
      ownerLeaseId: "dtl_ready",
      nodeId: "dpg_ready",
      ready: true,
    });

    await expect(
      store.summarize({
        sandboxInstanceId: "sbi_ready",
        ownerLeaseId: "dtl_ready",
      }),
    ).resolves.toEqual({ ready: true });
    await expect(
      store.summarize({
        sandboxInstanceId: "sbi_ready",
        ownerLeaseId: "dtl_other",
      }),
    ).resolves.toEqual({ ready: false });
    await expect(
      store.summarize({
        sandboxInstanceId: "sbi_ready",
        ownerLeaseId: null,
      }),
    ).resolves.toEqual({ ready: false });
  });

  it("replaces readiness when ownership changes", async () => {
    const store = new InMemorySandboxRuntimeReadinessStore();

    await store.replaceStateForOwner({
      sandboxInstanceId: "sbi_ready",
      ownerLeaseId: "dtl_first",
      nodeId: "dpg_ready",
      ready: true,
    });
    await store.replaceStateForOwner({
      sandboxInstanceId: "sbi_ready",
      ownerLeaseId: "dtl_second",
      nodeId: "dpg_ready",
      ready: false,
    });

    await expect(
      store.summarize({
        sandboxInstanceId: "sbi_ready",
        ownerLeaseId: "dtl_first",
      }),
    ).resolves.toEqual({ ready: false });
    await expect(
      store.summarize({
        sandboxInstanceId: "sbi_ready",
        ownerLeaseId: "dtl_second",
      }),
    ).resolves.toEqual({ ready: false });
  });
});
