import { describe, expect, it } from "vitest";

import {
  DefaultScheduledAutomationCronExpression,
  ScheduledAutomationNewConversationEachRunKeyTemplate,
  ScheduledAutomationSameConversationKeyTemplate,
  readBrowserTimezone,
  toCreateScheduledAutomationPayload,
  toScheduledAutomationFormValues,
  toUpdateScheduledAutomationPayload,
  validateScheduledAutomationFormValues,
} from "./scheduled-automation-form-helpers.js";
import { ScheduledAutomationConversationModes } from "./scheduled-automation-form-types.js";
import type { ScheduledAutomationFormValues } from "./scheduled-automation-form-types.js";
import type { ScheduledAutomation } from "./scheduled-automations-types.js";
import { WebhookAutomationWorkspaceRootRepositoryOptionValue } from "./webhook-automation-option-builders.js";

const SampleAutomation: ScheduledAutomation = {
  id: "aut_schedule_001",
  kind: "schedule",
  name: "Daily triage",
  enabled: true,
  schedule: {
    id: "sch_001",
    name: "Daily triage",
    cronExpression: "0 10 * * 1-5",
    timezone: "Asia/Singapore",
    enabled: true,
    nextScheduledAt: "2026-05-01T02:00:00.000Z",
    lastScheduledAt: null,
  },
  inputTemplate: "Review the queued issues.",
  conversationKeyTemplate: ScheduledAutomationSameConversationKeyTemplate,
  idempotencyKeyTemplate: "{{schedule.scheduledActionId}}",
  target: {
    id: "aut_target_001",
    sandboxProfileId: "sbp_001",
    sandboxProfileVersion: 3,
    primaryRepositoryId: "repo_001",
  },
  createdAt: "2026-04-30T00:00:00.000Z",
  updatedAt: "2026-04-30T00:00:00.000Z",
};

const BaseFormValues: ScheduledAutomationFormValues = {
  name: "Daily triage",
  sandboxProfileId: "sbp_001",
  primaryRepositoryId: "repo_001",
  enabled: true,
  cronExpression: "0 10 * * 1-5",
  timezone: "Asia/Singapore",
  conversationMode: ScheduledAutomationConversationModes.SAME,
  inputTemplate: "Review the queued issues.",
};

describe("toScheduledAutomationFormValues", () => {
  it("creates default values for new scheduled automations", () => {
    expect(toScheduledAutomationFormValues(null)).toEqual({
      name: "",
      sandboxProfileId: "",
      primaryRepositoryId: "",
      enabled: true,
      cronExpression: DefaultScheduledAutomationCronExpression,
      timezone: readBrowserTimezone(),
      conversationMode: ScheduledAutomationConversationModes.SAME,
      inputTemplate: "",
    });
  });

  it("hydrates values from an existing scheduled automation", () => {
    expect(toScheduledAutomationFormValues(SampleAutomation)).toEqual(BaseFormValues);
  });

  it("hydrates workspace-root repository selection as empty", () => {
    expect(
      toScheduledAutomationFormValues({
        ...SampleAutomation,
        target: {
          ...SampleAutomation.target,
          primaryRepositoryId: null,
        },
      }).primaryRepositoryId,
    ).toBe("");
  });

  it("hydrates new-conversation scheduled automations", () => {
    expect(
      toScheduledAutomationFormValues({
        ...SampleAutomation,
        conversationKeyTemplate: ScheduledAutomationNewConversationEachRunKeyTemplate,
      }).conversationMode,
    ).toBe(ScheduledAutomationConversationModes.NEW_EACH_RUN);
  });

  it("rejects unsupported conversation templates", () => {
    expect(() =>
      toScheduledAutomationFormValues({
        ...SampleAutomation,
        conversationKeyTemplate: "{{schedule.custom}}",
      }),
    ).toThrow("Unsupported scheduled automation conversation key template.");
  });
});

describe("validateScheduledAutomationFormValues", () => {
  it("returns no errors for a complete form", () => {
    expect(validateScheduledAutomationFormValues(BaseFormValues)).toEqual({});
  });

  it("requires the persisted scheduled automation fields", () => {
    expect(
      validateScheduledAutomationFormValues({
        name: " ",
        sandboxProfileId: "",
        primaryRepositoryId: "",
        enabled: true,
        cronExpression: "",
        timezone: " ",
        conversationMode: ScheduledAutomationConversationModes.SAME,
        inputTemplate: "",
      }),
    ).toEqual({
      name: "Automation name is required.",
      sandboxProfileId: "Select a sandbox profile.",
      cronExpression: "Cron expression is required.",
      timezone: "Timezone is required.",
      inputTemplate: "User message is required.",
    });
  });
});

describe("toCreateScheduledAutomationPayload", () => {
  it("builds the create request payload", () => {
    expect(
      toCreateScheduledAutomationPayload({
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
      conversationKeyTemplate: ScheduledAutomationSameConversationKeyTemplate,
      target: {
        sandboxProfileId: "sbp_001",
        primaryRepositoryId: "repo_001",
      },
    });
  });

  it("builds a create request for new conversations on each run", () => {
    expect(
      toCreateScheduledAutomationPayload({
        ...BaseFormValues,
        conversationMode: ScheduledAutomationConversationModes.NEW_EACH_RUN,
      }).conversationKeyTemplate,
    ).toBe(ScheduledAutomationNewConversationEachRunKeyTemplate);
  });

  it("stores workspace-root repository selection as null", () => {
    expect(
      toCreateScheduledAutomationPayload({
        ...BaseFormValues,
        primaryRepositoryId: WebhookAutomationWorkspaceRootRepositoryOptionValue,
      }).target.primaryRepositoryId,
    ).toBeNull();
  });
});

describe("toUpdateScheduledAutomationPayload", () => {
  it("builds the update request payload", () => {
    expect(toUpdateScheduledAutomationPayload(BaseFormValues)).toEqual({
      name: "Daily triage",
      enabled: true,
      schedule: {
        name: "Daily triage",
        cronExpression: "0 10 * * 1-5",
        timezone: "Asia/Singapore",
      },
      conversationKeyTemplate: ScheduledAutomationSameConversationKeyTemplate,
      inputTemplate: "Review the queued issues.",
      target: {
        sandboxProfileId: "sbp_001",
        primaryRepositoryId: "repo_001",
      },
    });
  });

  it("omits the target when the persisted target selection did not change", () => {
    expect(
      toUpdateScheduledAutomationPayload(
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
      conversationKeyTemplate: ScheduledAutomationSameConversationKeyTemplate,
      inputTemplate: "Review the queued issues.",
    });
  });

  it("includes the target when the sandbox profile changes", () => {
    expect(
      toUpdateScheduledAutomationPayload(
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
      toUpdateScheduledAutomationPayload({
        ...BaseFormValues,
        primaryRepositoryId: "",
      }).target?.primaryRepositoryId,
    ).toBeNull();
  });
});
