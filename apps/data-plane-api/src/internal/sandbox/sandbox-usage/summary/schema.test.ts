import { describe, expect, it } from "vitest";

import { SandboxUsageSummaryInputSchema } from "./schema.js";

describe("SandboxUsageSummaryInputSchema", () => {
  it("rejects periods whose end is not after the start", () => {
    const result = SandboxUsageSummaryInputSchema.safeParse({
      organizationId: "org_123",
      periodStart: "2026-06-01T00:00:00.000Z",
      periodEnd: "2026-06-01T00:00:00.000Z",
      requestedAt: "2026-06-29T12:00:00.000Z",
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("Expected invalid usage period to fail schema validation.");
    }
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        message: "Usage period end must be after period start.",
        path: ["periodEnd"],
      }),
    );
  });
});
