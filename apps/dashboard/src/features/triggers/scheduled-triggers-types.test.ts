import { describe, expect, it } from "vitest";

import {
  DeleteScheduledTriggerResultSchema,
  ScheduledTriggerSchema,
} from "./scheduled-triggers-types.js";

describe("scheduled triggers types", () => {
  it("parses recurring scheduled trigger responses with schedule metadata", () => {
    const parsed = ScheduledTriggerSchema.parse({
      id: "trg_recurring",
      kind: "schedule",
      name: "Daily triage",
      enabled: true,
      schedule: {
        id: "sch_recurring",
        kind: "recurring",
        name: "Daily triage",
        cronExpression: "0 9 * * 1-5",
        timezone: "Asia/Singapore",
        enabled: true,
        nextScheduledAt: "2026-05-12T01:00:00.000Z",
        lastScheduledAt: null,
        startAt: null,
      },
      inputTemplate: "Review open work.",
      conversationKeyTemplate: "{{schedule.id}}",
      idempotencyKeyTemplate: null,
      target: {
        id: "tgt_recurring",
        sandboxProfileId: "sbp_recurring",
        sandboxProfileVersion: 3,
        primaryRepositoryId: null,
      },
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-08T00:00:00.000Z",
    });

    expect(parsed.schedule).toMatchObject({
      kind: "recurring",
      cronExpression: "0 9 * * 1-5",
      timezone: "Asia/Singapore",
      startAt: null,
    });
  });

  it("parses one-off scheduled trigger responses with nullable recurring fields", () => {
    const parsed = ScheduledTriggerSchema.parse({
      id: "trg_one_off",
      kind: "schedule",
      name: "One-off triage",
      enabled: true,
      schedule: {
        id: "sch_one_off",
        kind: "one_off",
        name: "One-off triage",
        cronExpression: null,
        timezone: null,
        enabled: true,
        nextScheduledAt: "2026-05-12T01:00:00.000Z",
        lastScheduledAt: null,
        startAt: "2026-05-12T01:00:00.000Z",
      },
      inputTemplate: "Review open work.",
      conversationKeyTemplate: "{{schedule.id}}",
      idempotencyKeyTemplate: null,
      target: {
        id: "tgt_one_off",
        sandboxProfileId: "sbp_one_off",
        sandboxProfileVersion: 3,
        primaryRepositoryId: null,
      },
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-08T00:00:00.000Z",
    });

    expect(parsed.schedule).toMatchObject({
      kind: "one_off",
      cronExpression: null,
      timezone: null,
      startAt: "2026-05-12T01:00:00.000Z",
    });
  });

  it("parses delete responses", () => {
    const parsed = DeleteScheduledTriggerResultSchema.parse({
      triggerId: "trg_123",
    });

    expect(parsed).toEqual({
      triggerId: "trg_123",
    });
  });
});
