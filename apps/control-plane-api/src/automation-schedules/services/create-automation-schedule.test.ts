import { describe, expect, it } from "vitest";

import { resolveCreateScheduleAutomationIdempotencyKeyTemplate } from "./create-automation-schedule.js";

describe("resolveCreateScheduleAutomationIdempotencyKeyTemplate", () => {
  it("uses the default when the request omits idempotencyKeyTemplate", () => {
    expect(resolveCreateScheduleAutomationIdempotencyKeyTemplate(undefined)).toBe(
      "{{schedule.scheduledActionId}}",
    );
  });

  it("preserves explicit null idempotencyKeyTemplate", () => {
    expect(resolveCreateScheduleAutomationIdempotencyKeyTemplate(null)).toBeNull();
  });

  it("preserves explicit idempotencyKeyTemplate values", () => {
    expect(resolveCreateScheduleAutomationIdempotencyKeyTemplate("{{schedule.id}}")).toBe(
      "{{schedule.id}}",
    );
  });
});
