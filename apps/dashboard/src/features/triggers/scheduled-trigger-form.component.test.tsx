// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ScheduledTriggerConversationModes,
  type ScheduledTriggerFormValues,
} from "./scheduled-trigger-form-types.js";
import { ScheduledTriggerForm } from "./scheduled-trigger-form.js";

const SandboxProfileOptions = [
  {
    value: "sbp_repo_maintainer",
    label: "Repo Maintainer v3",
  },
  {
    value: "sbp_finance_investigator",
    label: "Finance Investigator v2",
  },
];

const EmptyCreateValues: ScheduledTriggerFormValues = {
  name: "",
  sandboxProfileId: "",
  primaryRepositoryId: "",
  enabled: true,
  cronExpression: "",
  timezone: "",
  conversationMode: ScheduledTriggerConversationModes.SAME,
  inputTemplate: "",
};

afterEach(() => {
  cleanup();
});

describe("ScheduledTriggerForm", () => {
  it("shows validation errors under each invalid field", () => {
    render(
      <ScheduledTriggerForm
        fieldErrors={{
          name: "Trigger name is required.",
          sandboxProfileId: "Select a sandbox profile.",
          cronExpression: "Cron expression is required.",
          timezone: "Timezone is required.",
          inputTemplate: "User message is required.",
        }}
        formError={null}
        validationSummaryError="Please address the fields highlighted in red."
        isDeleting={false}
        isDuplicating={false}
        isSaving={false}
        mode="create"
        onDelete={null}
        onDuplicate={null}
        onSubmit={() => {}}
        onValueChange={() => {}}
        sandboxProfileOptions={SandboxProfileOptions}
        values={EmptyCreateValues}
      />,
    );

    expect(screen.getByText("Please address the fields highlighted in red.")).toBeDefined();
    expect(screen.getByText("Trigger name is required.")).toBeDefined();
    expect(screen.getByText("Select a sandbox profile.")).toBeDefined();
    expect(screen.getByText("Cron expression is required.")).toBeDefined();
    expect(screen.getByText("Timezone is required.")).toBeDefined();
    expect(screen.getByText("User message is required.")).toBeDefined();
    expect(screen.getAllByRole("status")).toHaveLength(5);
    expect(
      screen.getByRole("textbox", { name: "Cron expression" }).getAttribute("aria-invalid"),
    ).toBe("true");
    expect(screen.getByRole("textbox", { name: "User message" }).getAttribute("aria-invalid")).toBe(
      "true",
    );
  });
});
