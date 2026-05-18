import { describe, expect, it } from "vitest";

import { resolveCreateScheduleTriggerIdempotencyKeyTemplate } from "./create-trigger-schedule.js";

describe("resolveCreateScheduleTriggerIdempotencyKeyTemplate", () => {
  it("uses the default when the request omits idempotencyKeyTemplate", () => {
    expect(resolveCreateScheduleTriggerIdempotencyKeyTemplate(undefined)).toBe(
      "{{schedule.scheduledActionId}}",
    );
  });

  it("preserves explicit null idempotencyKeyTemplate", () => {
    expect(resolveCreateScheduleTriggerIdempotencyKeyTemplate(null)).toBeNull();
  });

  it("preserves explicit idempotencyKeyTemplate values", () => {
    expect(resolveCreateScheduleTriggerIdempotencyKeyTemplate("{{schedule.id}}")).toBe(
      "{{schedule.id}}",
    );
  });
});
