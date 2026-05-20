import { SandboxUsageEventTypes } from "@mistle/db/data-plane";
import { describe, expect, it } from "vitest";

import { createSandboxUsageEventIdempotencyKey } from "./sandbox-usage-events.js";

describe("sandbox usage events", () => {
  it("builds stable idempotency keys for workflow usage events", () => {
    expect(
      createSandboxUsageEventIdempotencyKey({
        sandboxInstanceId: "sbi_usage_key_test",
        computeGeneration: 2,
        eventType: SandboxUsageEventTypes.SANDBOX_READY,
        operationId: "workflow_usage_key_test",
      }),
    ).toBe("usage:sbi_usage_key_test:2:sandbox_ready:workflow_usage_key_test");
  });

  it("includes a discriminator when a workflow can emit more than one event of the same type", () => {
    expect(
      createSandboxUsageEventIdempotencyKey({
        sandboxInstanceId: "sbi_usage_key_test",
        computeGeneration: 2,
        eventType: SandboxUsageEventTypes.SANDBOX_READY,
        operationId: "workflow_usage_key_test",
        discriminator: "replacement-provider",
      }),
    ).toBe("usage:sbi_usage_key_test:2:sandbox_ready:workflow_usage_key_test:replacement-provider");
  });
});
