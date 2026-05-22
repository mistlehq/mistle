import { describe, expect, it } from "vitest";

import {
  DefaultScheduledTriggerCronExpression,
  ScheduledTriggerNewConversationEachRunKeyTemplate,
  ScheduledTriggerSameConversationKeyTemplate,
  readBrowserTimezone,
  toCreateScheduledTriggerPayload,
  toScheduledTriggerFormValues,
  toUpdateScheduledTriggerPayload,
  validateScheduledTriggerFormValues,
} from "./scheduled-trigger-form-helpers.js";
import { ScheduledTriggerConversationModes } from "./scheduled-trigger-form-types.js";
import type { ScheduledTriggerFormValues } from "./scheduled-trigger-form-types.js";
import type { ScheduledTrigger } from "./scheduled-triggers-types.js";
import { WebhookTriggerWorkspaceRootRepositoryOptionValue } from "./webhook-trigger-option-builders.js";

const SampleTrigger: ScheduledTrigger = {
  id: "trg_schedule_001",
  kind: "schedule",
  name: "Daily triage",
  enabled: true,
  schedule: {
    id: "sch_001",
    kind: "recurring",
    name: "Daily triage",
    cronExpression: "0 10 * * 1-5",
    timezone: "Asia/Singapore",
    enabled: true,
    nextScheduledAt: "2026-05-01T02:00:00.000Z",
    lastScheduledAt: null,
    startAt: null,
  },
  inputTemplate: "Review the queued issues.",
  conversationKeyTemplate: ScheduledTriggerSameConversationKeyTemplate,
  idempotencyKeyTemplate: "{{schedule.scheduledActionId}}",
  target: {
    id: "tgt_target_001",
    sandboxProfileId: "sbp_001",
    sandboxProfileVersion: 3,
    primaryRepositoryId: "repo_001",
  },
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:00.000Z",
};

const BaseFormValues: ScheduledTriggerFormValues = {
  name: "Daily triage",
  sandboxProfileId: "sbp_001",
  primaryRepositoryId: "repo_001",
  enabled: true,
  cronExpression: "0 10 * * 1-5",
  timezone: "Asia/Singapore",
  conversationMode: ScheduledTriggerConversationModes.SAME,
  inputTemplate: "Review the queued issues.",
};

describe("toScheduledTriggerFormValues", () => {
  it("creates default values for new scheduled triggers", () => {
    expect(toScheduledTriggerFormValues(null)).toEqual({
      name: "",
      sandboxProfileId: "",
      primaryRepositoryId: "",
      enabled: true,
      cronExpression: DefaultScheduledTriggerCronExpression,
      timezone: readBrowserTimezone(),
      conversationMode: ScheduledTriggerConversationModes.SAME,
      inputTemplate: "",
    });
  });

  it("hydrates values from an existing scheduled trigger", () => {
    expect(toScheduledTriggerFormValues(SampleTrigger)).toEqual(BaseFormValues);
  });

  it("hydrates workspace-root repository selection as empty", () => {
    expect(
      toScheduledTriggerFormValues({
        ...SampleTrigger,
        target: {
          ...SampleTrigger.target,
          primaryRepositoryId: null,
        },
      }).primaryRepositoryId,
    ).toBe("");
  });

  it("hydrates new-conversation scheduled triggers", () => {
    expect(
      toScheduledTriggerFormValues({
        ...SampleTrigger,
        conversationKeyTemplate: ScheduledTriggerNewConversationEachRunKeyTemplate,
      }).conversationMode,
    ).toBe(ScheduledTriggerConversationModes.NEW_EACH_RUN);
  });

  it("rejects unsupported conversation templates", () => {
    expect(() =>
      toScheduledTriggerFormValues({
        ...SampleTrigger,
        conversationKeyTemplate: "{{schedule.custom}}",
      }),
    ).toThrow("Unsupported scheduled trigger conversation key template.");
  });
});

describe("validateScheduledTriggerFormValues", () => {
  it("returns no errors for a complete form", () => {
    expect(validateScheduledTriggerFormValues(BaseFormValues)).toEqual({});
  });

  it("requires the persisted scheduled trigger fields", () => {
    expect(
      validateScheduledTriggerFormValues({
        name: " ",
        sandboxProfileId: "",
        primaryRepositoryId: "",
        enabled: true,
        cronExpression: "",
        timezone: " ",
        conversationMode: ScheduledTriggerConversationModes.SAME,
        inputTemplate: "",
      }),
    ).toEqual({
      name: "Trigger name is required.",
      sandboxProfileId: "Select a sandbox profile.",
      cronExpression: "Cron expression is required.",
      timezone: "Timezone is required.",
      inputTemplate: "User message is required.",
    });
  });
});

describe("toCreateScheduledTriggerPayload", () => {
  it("builds the create request payload", () => {
    expect(
      toCreateScheduledTriggerPayload({
        ...BaseFormValues,
        name: "  Daily triage  ",
        cronExpression: "  0 10 * * 1-5  ",
        timezone: "  Asia/Singapore  ",
        inputTemplate: "  Review the queued issues.  ",
      }),
    ).toEqual({
      name: "Daily triage",
      enabled: true,
      schedule: {
        name: "Daily triage",
        cronExpression: "0 10 * * 1-5",
        timezone: "Asia/Singapore",
      },
      inputTemplate: "Review the queued issues.",
      conversationKeyTemplate: ScheduledTriggerSameConversationKeyTemplate,
      target: {
        sandboxProfileId: "sbp_001",
        primaryRepositoryId: "repo_001",
      },
    });
  });

  it("builds a create request for new conversations on each run", () => {
    expect(
      toCreateScheduledTriggerPayload({
        ...BaseFormValues,
        conversationMode: ScheduledTriggerConversationModes.NEW_EACH_RUN,
      }).conversationKeyTemplate,
    ).toBe(ScheduledTriggerNewConversationEachRunKeyTemplate);
  });

  it("stores workspace-root repository selection as null", () => {
    expect(
      toCreateScheduledTriggerPayload({
        ...BaseFormValues,
        primaryRepositoryId: WebhookTriggerWorkspaceRootRepositoryOptionValue,
      }).target.primaryRepositoryId,
    ).toBeNull();
  });
});

describe("toUpdateScheduledTriggerPayload", () => {
  it("builds the update request payload", () => {
    expect(toUpdateScheduledTriggerPayload(BaseFormValues)).toEqual({
      name: "Daily triage",
      enabled: true,
      schedule: {
        name: "Daily triage",
        cronExpression: "0 10 * * 1-5",
        timezone: "Asia/Singapore",
      },
      conversationKeyTemplate: ScheduledTriggerSameConversationKeyTemplate,
      inputTemplate: "Review the queued issues.",
      target: {
        sandboxProfileId: "sbp_001",
        primaryRepositoryId: "repo_001",
      },
    });
  });

  it("omits the target when the persisted target selection did not change", () => {
    expect(
      toUpdateScheduledTriggerPayload(
        {
          ...BaseFormValues,
          name: "Renamed triage",
          primaryRepositoryId: "  repo_001  ",
        },
        {
          initialValues: BaseFormValues,
        },
      ),
    ).toEqual({
      name: "Renamed triage",
      enabled: true,
      schedule: {
        name: "Renamed triage",
        cronExpression: "0 10 * * 1-5",
        timezone: "Asia/Singapore",
      },
      conversationKeyTemplate: ScheduledTriggerSameConversationKeyTemplate,
      inputTemplate: "Review the queued issues.",
    });
  });

  it("includes the target when the sandbox profile changes", () => {
    expect(
      toUpdateScheduledTriggerPayload(
        {
          ...BaseFormValues,
          sandboxProfileId: "sbp_002",
          primaryRepositoryId: "",
        },
        {
          initialValues: BaseFormValues,
        },
      ).target,
    ).toEqual({
      sandboxProfileId: "sbp_002",
      primaryRepositoryId: null,
    });
  });

  it("stores an empty repository selection as null", () => {
    expect(
      toUpdateScheduledTriggerPayload({
        ...BaseFormValues,
        primaryRepositoryId: "",
      }).target?.primaryRepositoryId,
    ).toBeNull();
  });
});
